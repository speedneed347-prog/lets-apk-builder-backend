'use strict';

const assert = require('assert');
const Module = require('module');

const state = {
  build: { id: 'test-build', status: 'building', config: { appName: 'Demo' } },
  patches: [],
  logs: [],
  history: [],
  artifacts: [],
  released: [],
  audits: [],
};

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === './buildService' && parent.filename.endsWith('/services/buildIntegrationService.js')) {
    return {
      getBuild: async () => ({ ...state.build }),
      updateBuild: async (_id, patch) => {
        state.patches.push(patch);
        Object.assign(state.build, patch);
        return { ...state.build };
      },
      appendLog: async (_id, line) => state.logs.push(line),
    };
  }
  if (request === './buildQueueService' && parent.filename.endsWith('/services/buildIntegrationService.js')) {
    return { onBuildFinished: async (id) => { state.released.push(id); return true; } };
  }
  if (request === './auditService' && parent.filename.endsWith('/services/buildIntegrationService.js')) {
    return { record: async (...args) => state.audits.push(args) };
  }
  if (request === './buildHistoryService' && parent.filename.endsWith('/services/buildIntegrationService.js')) {
    return { appendBuildHistory: async (...args) => state.history = (state.history || []).concat([args]), saveArtifactRecord: async (...args) => state.artifacts = (state.artifacts || []).concat([args]) };
  }
  if (request === './webhookEventService' && parent.filename.endsWith('/services/buildIntegrationService.js')) {
    return { claimEvent: async () => ({ claimed: true }), completeEvent: async () => {} };
  }
  if (request === '../utils/helpers' && parent.filename.endsWith('/services/buildIntegrationService.js')) {
    return { nowIso: () => '2026-09-30T00:00:00.000Z' };
  }
  if (request === '../utils/logger' && parent.filename.endsWith('/services/buildIntegrationService.js')) {
    return { info() {}, warn() {}, error() {} };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { applyWorkerEvent, CONTRACT_VERSION } = require('./buildIntegrationService');
Module._load = originalLoad;

(async () => {
  assert.strictEqual(CONTRACT_VERSION, 1);

  let result = await applyWorkerEvent({
    buildId: 'test-build',
    eventId: 'event-signing',
    status: 'signing',
    currentStep: 'Signing APK',
    stepIndex: 5,
    logLine: '[time] Signing APK',
    timestamp: '2026-09-30T00:00:00.000Z',
  });
  assert.strictEqual(result.accepted, true);
  assert.strictEqual(state.build.status, 'signing');

  result = await applyWorkerEvent({
    buildId: 'test-build',
    eventId: 'event-completed',
    status: 'completed',
    artifactUrl: 'https://example.invalid/app.apk',
    artifactType: 'apk',
    artifactFileName: 'app-v1.0.0.apk',
    artifactSha256: 'abc123',
    artifactSizeBytes: 1234,
    timestamp: '2026-09-30T00:00:01.000Z',
  });
  assert.strictEqual(result.accepted, true);
  assert.strictEqual(state.build.status, 'completed');
  assert.strictEqual(state.build.apkUrl, 'https://example.invalid/app.apk');
  assert.strictEqual(state.build.artifactSha256, 'abc123');
  assert.deepStrictEqual(state.released, ['test-build']);
  assert.ok(state.history.length >= 2);
  assert.strictEqual(state.artifacts.length, 1);
  assert.strictEqual(state.artifacts[0][1].artifactType, 'apk');

  result = await applyWorkerEvent({
    buildId: 'test-build',
    eventId: 'event-late',
    status: 'building',
    timestamp: '2026-09-30T00:00:02.000Z',
  });
  assert.strictEqual(result.accepted, false);

  console.log('build integration service tests: OK');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
