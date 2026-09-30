const { getDb } = require("../firebase/firestore");
const { nowIso } = require("../utils/helpers");
const logger = require("../utils/logger");

const COLLECTION = "builds";
const CHUNK_SIZE = 700_000; // ~700 KB per Firestore doc

async function saveBuild(build) {
  const db = getDb();
  await db.collection(COLLECTION).doc(build.id).set(build, { merge: true });
  return build;
}

async function getBuild(id) {
  const db = getDb();
  const snap = await db.collection(COLLECTION).doc(id).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

async function updateBuild(id, patch) {
  const db = getDb();
  await db.collection(COLLECTION).doc(id).set(patch, { merge: true });
  logger.info("build updated", id, patch.status || "");
  return getBuild(id);
}

async function listBuilds({ limit = 20, userId = null } = {}) {
  const db = getDb();
  let q = db.collection(COLLECTION).orderBy("createdAt", "desc").limit(Math.min(limit, 100));
  if (userId) q = q.where("userId", "==", userId);
  const snap = await q.get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function appendLog(id, line) {
  if (!id || !line) return;
  const db = getDb();
  const safeLine = String(line).slice(0, 1000);
  await db.collection(COLLECTION).doc(id).set(
    { logs: require("firebase-admin").firestore.FieldValue.arrayUnion(safeLine), updatedAt: nowIso() },
    { merge: true }
  );
}

function newBuildRecord({ id, config, userId }) {
  return {
    id,
    userId: userId || null,
    status: "queued",
    config,
    apkUrl: null,
    artifactUrl: null,
    artifactType: null,
    artifactFileName: null,
    artifactSha256: null,
    artifactSizeBytes: null,
    error: null,
    logs: [`[${nowIso()}] Build queued`],
    createdAt: nowIso(),
    updatedAt: nowIso(),
    completedAt: null,
    durationMs: null,
    currentStep: "Queued",
    stepIndex: 0,
    queueEnteredAt: null,
    queueClaimedAt: null,
    queueDispatchedAt: null,
    dispatchStatus: null,
    dispatchAttempts: 0,
  };
}

// ═══════════════════════════════════════════════
// OFFLINE ZIP — chunked storage
// ═══════════════════════════════════════════════
async function saveZipChunks(buildId, base64, name, size) {
  const db = getDb();
  const total = Math.ceil(base64.length / CHUNK_SIZE) || 1;
  const batch = db.batch();

  for (let i = 0; i < total; i++) {
    const slice = base64.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    const ref = db.collection(COLLECTION).doc(buildId).collection("zipchunks").doc(String(i));
    batch.set(ref, { data: slice, index: i });
  }
  batch.set(
    db.collection(COLLECTION).doc(buildId).collection("zipchunks").doc("meta"),
    { total, name: name || "site.zip", size: size || 0 }
  );

  await batch.commit();
  logger.info("zip chunks saved", buildId, `${total} chunks`);
  return total;
}

async function getZipChunks(buildId) {
  const db = getDb();
  const metaSnap = await db.collection(COLLECTION).doc(buildId)
    .collection("zipchunks").doc("meta").get();
  if (!metaSnap.exists) return null;

  const { total, name, size } = metaSnap.data();
  const parts = [];
  for (let i = 0; i < total; i++) {
    const snap = await db.collection(COLLECTION).doc(buildId)
      .collection("zipchunks").doc(String(i)).get();
    if (snap.exists) parts.push(snap.data().data);
  }
  return { base64: parts.join(""), name, size };
}


async function deleteSubcollection(db, parentRef, collectionName, batchSize = 450) {
  let deleted = 0;
  while (true) {
    const snap = await parentRef.collection(collectionName).limit(batchSize).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    deleted += snap.size;
    if (snap.size < batchSize) break;
  }
  return deleted;
}

/**
 * Remove build inputs that are no longer needed after a terminal build.
 * The main build document, history, artifacts and logs are retained.
 */
async function cleanupBuildInputs(buildId) {
  if (!buildId) return { deleted: 0 };
  if (process.env.CLEANUP_BUILD_INPUTS === "false") return { deleted: 0, skipped: true };
  const db = getDb();
  const parent = db.collection(COLLECTION).doc(buildId);
  let deleted = 0;
  deleted += await deleteSubcollection(db, parent, "zipchunks");

  const modules = await parent.collection("modules").limit(200).get();
  for (const moduleDoc of modules.docs) {
    deleted += await deleteSubcollection(db, moduleDoc.ref, "chunks");
    await moduleDoc.ref.delete();
    deleted += 1;
  }
  logger.info("build input cleanup complete", buildId, `deleted=${deleted}`);
  return { deleted };
}

module.exports = {
  saveBuild, getBuild, updateBuild, listBuilds, appendLog, newBuildRecord,
  saveZipChunks, getZipChunks, cleanupBuildInputs,
};
