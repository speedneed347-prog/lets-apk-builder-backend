'use strict';

const { getBuild, updateBuild, appendLog, cleanupBuildInputs } = require('./buildService');
const { onBuildFinished } = require('./buildQueueService');
const { record } = require('./auditService');
const { nowIso } = require('../utils/helpers');
const logger = require('../utils/logger');
const { appendBuildHistory, saveArtifactRecord } = require('./buildHistoryService');
const { claimEvent, completeEvent } = require('./webhookEventService');

const { CONTRACT_VERSION, TERMINAL, TRANSITIONS, isAllowedTransition } = require('./buildIntegrationContract');

function sanitizeArtifact(body) {
  const out = {};
  if (body.artifactUrl) out.artifactUrl = String(body.artifactUrl).slice(0, 4000);
  if (body.apkUrl) out.apkUrl = String(body.apkUrl).slice(0, 4000);
  if (body.artifactType) out.artifactType = String(body.artifactType).toLowerCase().slice(0, 10);
  if (body.artifactFileName) out.artifactFileName = String(body.artifactFileName).slice(0, 255);
  if (body.artifactSha256) out.artifactSha256 = String(body.artifactSha256).slice(0, 128);
  if (Number.isFinite(Number(body.artifactSizeBytes))) {
    out.artifactSizeBytes = Math.max(0, Number(body.artifactSizeBytes));
  }
  return out;
}

async function getWorkerConfig(buildId) {
  const build = await getBuild(buildId);
  if (!build) return null;
  return {
    contractVersion: CONTRACT_VERSION,
    id: build.id,
    status: build.status,
    config: build.config || {},
  };
}

async function applyWorkerEvent(body) {
  const buildId = String(body.buildId || '').trim();
  if (!buildId) return { accepted: false, reason: 'buildId required' };

  const build = await getBuild(buildId);
  if (!build) return { accepted: false, reason: 'Build not found' };

  const nextStatus = body.status ? String(body.status) : null;
  if (nextStatus && !isAllowedTransition(build.status || 'queued', nextStatus)) {
    logger.warn('invalid build status transition', buildId, `${build.status}->${nextStatus}`);
    return { accepted: false, reason: `Invalid status transition: ${build.status} -> ${nextStatus}` };
  }

  // A late retry must never resurrect a terminal build.
  if (TERMINAL.has(build.status) && nextStatus === build.status) {
    return { accepted: true, duplicate: true, terminal: true, build };
  }
  if (TERMINAL.has(build.status) && nextStatus && nextStatus !== build.status) {
    return { accepted: false, reason: 'Build is already terminal' };
  }

  const eventClaim = await claimEvent(body.eventId, buildId);
  if (eventClaim.invalid) return { accepted: false, reason: 'eventId required' };
  if (eventClaim.duplicate) return { accepted: true, duplicate: true, terminal: TERMINAL.has(build.status), buildId };
  if (eventClaim.processing) return { accepted: false, reason: 'Webhook event is already being processed' };

  const patch = { updatedAt: nowIso() };
  const previousStatus = build.status || 'queued';
  if (nextStatus) patch.status = nextStatus;
  if (body.error) patch.error = String(body.error).slice(0, 4000);
  if (body.currentStep) patch.currentStep = String(body.currentStep).slice(0, 200);
  if (typeof body.stepIndex === 'number' && Number.isInteger(body.stepIndex)) patch.stepIndex = body.stepIndex;
  if (nextStatus === 'completed' || nextStatus === 'failed') {
    patch.completedAt = nowIso();
    const start = build.createdAt ? new Date(build.createdAt).getTime() : NaN;
    if (Number.isFinite(start)) patch.durationMs = Math.max(0, Date.now() - start);
  }

  Object.assign(patch, sanitizeArtifact(body));
  if (patch.artifactUrl && !patch.apkUrl && patch.artifactType === 'apk') patch.apkUrl = patch.artifactUrl;

  const updated = await updateBuild(buildId, patch);
  const historyMessage = body.logLine || body.currentStep || nextStatus || 'Build event';
  await appendBuildHistory(buildId, {
    eventId: body.eventId || undefined,
    type: body.eventType || (nextStatus ? `status.${nextStatus}` : 'worker.event'),
    status: nextStatus || previousStatus,
    previousStatus: nextStatus && nextStatus !== previousStatus ? previousStatus : null,
    currentStep: body.currentStep,
    stepIndex: body.stepIndex,
    message: historyMessage,
    source: 'worker',
    at: body.timestamp || nowIso(),
  });

  if (body.logLine) await appendLog(buildId, String(body.logLine));
  else if (body.currentStep) await appendLog(buildId, `[${nowIso()}] ${String(body.currentStep).slice(0, 200)}`);

  const artifactUrl = patch.artifactUrl || patch.apkUrl;
  if (artifactUrl && patch.artifactType) {
    await saveArtifactRecord(buildId, {
      artifactId: body.artifactId || body.eventId || undefined,
      artifactUrl,
      artifactType: patch.artifactType,
      artifactFileName: patch.artifactFileName,
      artifactSha256: patch.artifactSha256,
      artifactSizeBytes: patch.artifactSizeBytes,
    });
  }

  if (nextStatus === 'completed' || nextStatus === 'failed') {
    await onBuildFinished(buildId);
    try {
      await cleanupBuildInputs(buildId);
    } catch (cleanupErr) {
      logger.warn('build input cleanup failed', buildId, cleanupErr.message);
    }
  }

  await record('build.worker_event', {
    buildId,
    status: nextStatus,
    eventId: body.eventId || null,
    artifactType: body.artifactType || null,
  });

  await completeEvent(body.eventId, { accepted: true, terminal: TERMINAL.has(nextStatus) });
  return { accepted: true, duplicate: false, terminal: TERMINAL.has(nextStatus), buildId };
}

module.exports = {
  CONTRACT_VERSION,
  TRANSITIONS,
  getWorkerConfig,
  applyWorkerEvent,
};
