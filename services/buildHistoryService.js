'use strict';

const crypto = require('crypto');
const { getDb } = require('../firebase/firestore');
const { nowIso } = require('../utils/helpers');

const BUILDS = 'builds';
const HISTORY = 'history';
const ARTIFACTS = 'artifacts';

function cleanText(value, max = 1000) {
  if (value === undefined || value === null) return null;
  return String(value).slice(0, max);
}

function sanitizeHistoryEvent(event = {}) {
  return {
    eventId: cleanText(event.eventId, 128) || crypto.randomUUID(),
    type: cleanText(event.type, 80) || 'event',
    status: cleanText(event.status, 40),
    previousStatus: cleanText(event.previousStatus, 40),
    currentStep: cleanText(event.currentStep, 200),
    stepIndex: Number.isInteger(event.stepIndex) ? event.stepIndex : null,
    message: cleanText(event.message, 1000),
    source: cleanText(event.source, 40) || 'backend',
    at: cleanText(event.at, 40) || nowIso(),
  };
}

function sanitizeArtifactRecord(artifact = {}) {
  const type = cleanText(artifact.artifactType || artifact.type, 10)?.toLowerCase();
  return {
    artifactId: cleanText(artifact.artifactId, 128) || crypto.randomUUID(),
    type: type || 'unknown',
    fileName: cleanText(artifact.artifactFileName || artifact.fileName, 255),
    url: cleanText(artifact.artifactUrl || artifact.url, 4000),
    sha256: cleanText(artifact.artifactSha256 || artifact.sha256, 128),
    sizeBytes: Number.isFinite(Number(artifact.artifactSizeBytes ?? artifact.sizeBytes))
      ? Math.max(0, Number(artifact.artifactSizeBytes ?? artifact.sizeBytes))
      : null,
    createdAt: cleanText(artifact.createdAt, 40) || nowIso(),
  };
}

async function appendBuildHistory(buildId, event = {}) {
  if (!buildId) throw new Error('buildId required');
  const db = getDb();
  const data = sanitizeHistoryEvent(event);
  await db.collection(BUILDS).doc(buildId).collection(HISTORY).doc(data.eventId).set(data);
  return data;
}

async function listBuildHistory(buildId, limit = 100) {
  if (!buildId) return [];
  const db = getDb();
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 200);
  const snap = await db.collection(BUILDS).doc(buildId).collection(HISTORY)
    .orderBy('at', 'desc').limit(safeLimit).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function saveArtifactRecord(buildId, artifact = {}) {
  if (!buildId) throw new Error('buildId required');
  const db = getDb();
  const data = sanitizeArtifactRecord(artifact);
  await db.collection(BUILDS).doc(buildId).collection(ARTIFACTS).doc(data.artifactId).set(data, { merge: true });
  return data;
}

async function listArtifactRecords(buildId) {
  if (!buildId) return [];
  const db = getDb();
  const snap = await db.collection(BUILDS).doc(buildId).collection(ARTIFACTS)
    .orderBy('createdAt', 'desc').limit(50).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

module.exports = {
  cleanText,
  sanitizeHistoryEvent,
  sanitizeArtifactRecord,
  appendBuildHistory,
  listBuildHistory,
  saveArtifactRecord,
  listArtifactRecords,
};
