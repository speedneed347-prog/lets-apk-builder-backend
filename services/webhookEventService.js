'use strict';

const COLLECTION = 'webhookEvents';
const PROCESSING_TTL_MS = Number(process.env.WEBHOOK_EVENT_PROCESSING_TTL_MS || 10 * 60 * 1000);

function normalizeEventId(eventId) {
  const value = String(eventId || '').trim();
  if (!value || value.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(value)) return null;
  return value;
}

async function claimEvent(eventId, buildId) {
  const id = normalizeEventId(eventId);
  if (!id || !buildId) return { claimed: false, invalid: true };
  const { getDb } = require('../firebase/firestore');
  const db = getDb();
  const ref = db.collection(COLLECTION).doc(id);
  const now = Date.now();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const data = snap.data() || {};
      if (data.status === 'done') return { claimed: false, duplicate: true };
      const started = new Date(data.startedAt || 0).getTime();
      if (data.status === 'processing' && Number.isFinite(started) && now - started < PROCESSING_TTL_MS) {
        return { claimed: false, processing: true };
      }
    }

    tx.set(ref, {
      eventId: id,
      buildId: String(buildId),
      status: 'processing',
      startedAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    }, { merge: true });
    return { claimed: true, eventId: id };
  });
}

async function completeEvent(eventId, result = {}) {
  const id = normalizeEventId(eventId);
  if (!id) return;
  const { getDb } = require('../firebase/firestore');
  const db = getDb();
  await db.collection(COLLECTION).doc(id).set({
    status: 'done',
    completedAt: new Date().toISOString(),
    result: {
      accepted: !!result.accepted,
      terminal: !!result.terminal,
    },
  }, { merge: true });
}

module.exports = { normalizeEventId, claimEvent, completeEvent };
