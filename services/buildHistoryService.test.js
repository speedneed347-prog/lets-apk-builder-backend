'use strict';
const assert = require('assert');
const Module = require('module');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === '../firebase/firestore' && parent.filename.endsWith('/services/buildHistoryService.js')) {
    return { getDb: () => { throw new Error('Firestore should not be called by sanitizer tests'); } };
  }
  if (request === '../utils/helpers' && parent.filename.endsWith('/services/buildHistoryService.js')) {
    return { nowIso: () => '2026-09-30T00:00:00.000Z' };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { sanitizeHistoryEvent, sanitizeArtifactRecord, cleanText } = require('./buildHistoryService');
Module._load = originalLoad;

assert.strictEqual(cleanText('x'.repeat(20), 10).length, 10);
const h = sanitizeHistoryEvent({ type: 'status.completed', status: 'completed', stepIndex: 9, message: 'done' });
assert.strictEqual(h.type, 'status.completed');
assert.strictEqual(h.status, 'completed');
assert.strictEqual(h.stepIndex, 9);
assert.ok(h.eventId);
assert.ok(h.at);

const a = sanitizeArtifactRecord({ artifactType: 'APK', artifactFileName: 'app.apk', artifactSha256: 'abc', artifactSizeBytes: 123 });
assert.strictEqual(a.type, 'apk');
assert.strictEqual(a.fileName, 'app.apk');
assert.strictEqual(a.sizeBytes, 123);
assert.ok(a.artifactId);
console.log('build history service tests: OK');
