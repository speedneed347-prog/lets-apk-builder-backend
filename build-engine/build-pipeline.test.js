'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { normalizeFormat, readConfig, selectArtifact, safeName } = require('./build-pipeline');

assert.strictEqual(normalizeFormat('apk'), 'apk');
assert.strictEqual(normalizeFormat('AAB'), 'aab');
assert.throws(() => normalizeFormat('ipa'), /Unsupported build format/);
assert.strictEqual(safeName('My App', 'app'), 'My-App');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lets-pipeline-test-'));
try {
  const cfg = path.join(root, 'config.json');
  fs.writeFileSync(cfg, JSON.stringify({ appName: 'Demo', versionName: '1.2.3', buildFormat: 'aab' }));
  assert.strictEqual(readConfig(cfg).buildFormat, 'aab');
  const aab = path.join(root, 'demo.aab');
  const apk = path.join(root, 'demo.apk');
  fs.writeFileSync(aab, 'aab');
  fs.writeFileSync(apk, 'apk');
  assert.strictEqual(selectArtifact([apk, aab], '.aab'), aab);
  assert.strictEqual(selectArtifact([apk, aab], '.apk'), apk);
  assert.throws(() => selectArtifact([], '.aab'), /No AAB artifact/);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('build pipeline tests: OK');
