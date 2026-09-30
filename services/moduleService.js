const { getDb } = require("../firebase/firestore");
const logger = require("../utils/logger");

const COLLECTION = "builds";
const CHUNK_SIZE = 700_000; // ~700 KB per Firestore doc (safe under 1 MB limit)

// ═══════════════════════════════════════════════════════════════
// VALIDATE MODULE STRUCTURE (lightweight, no unzip here)
// The real validation happens in the worker during extraction.
// This is just a sanity check on file names when we can see them.
// ═══════════════════════════════════════════════════════════════
const ALLOWED_EXTENSIONS = [
  ".kt", ".java",           // source
  ".xml",                    // layouts, manifests, drawables
  ".gradle",                 // deps
  ".json",                   // module.json
  ".png", ".jpg", ".jpeg", ".webp",  // images
  ".ttf", ".otf",            // fonts
  ".txt", ".md",             // docs (optional)
];

function validateModuleStructure(fileNames) {
  if (!Array.isArray(fileNames) || fileNames.length === 0) {
    throw new Error("Module contains no files");
  }

  const hasModuleJson = fileNames.some((f) => f === "module.json");
  if (!hasModuleJson) {
    throw new Error("Module must contain module.json at root");
  }

  for (const file of fileNames) {
    const dot = file.lastIndexOf(".");
    if (dot === -1) continue; // skip extension-less files
    const ext = file.slice(dot).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      throw new Error(`File type not allowed: ${file}`);
    }
  }

  return true;
}

// ═══════════════════════════════════════════════════════════════
// SAVE MODULE (chunked into Firestore subcollection)
//
// Structure:
//   builds/{buildId}/modules/{moduleId}/chunks/meta   → { total, name, size }
//   builds/{buildId}/modules/{moduleId}/chunks/{index} → { data, index }
// ═══════════════════════════════════════════════════════════════
async function saveModuleChunks(buildId, moduleId, base64, name, size) {
  if (!buildId) throw new Error("buildId required");
  if (!moduleId) throw new Error("moduleId required");
  if (!base64) throw new Error("module base64 required");

  const db = getDb();
  const total = Math.ceil(base64.length / CHUNK_SIZE) || 1;

  // Firestore batch limit is 500 writes — split if needed
  const batches = [];
  let currentBatch = db.batch();
  let opsInBatch = 0;

  // Chunk docs
  for (let i = 0; i < total; i++) {
    const slice = base64.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    const ref = db
      .collection(COLLECTION)
      .doc(buildId)
      .collection("modules")
      .doc(moduleId)
      .collection("chunks")
      .doc(String(i));

    currentBatch.set(ref, { data: slice, index: i });
    opsInBatch++;

    if (opsInBatch >= 490) {
      batches.push(currentBatch);
      currentBatch = db.batch();
      opsInBatch = 0;
    }
  }

  // Meta doc
  const metaRef = db
    .collection(COLLECTION)
    .doc(buildId)
    .collection("modules")
    .doc(moduleId)
    .collection("chunks")
    .doc("meta");

  currentBatch.set(metaRef, {
    total,
    name: name || "module.zip",
    size: size || 0,
    savedAt: new Date().toISOString(),
  });
  opsInBatch++;

  if (opsInBatch > 0) batches.push(currentBatch);

  // Commit all batches
  for (const batch of batches) {
    await batch.commit();
  }

  // Also update the parent module doc with metadata (for listing)
  await db
    .collection(COLLECTION)
    .doc(buildId)
    .collection("modules")
    .doc(moduleId)
    .set(
      {
        id: moduleId,
        name: name || "module.zip",
        size: size || 0,
        chunks: total,
        savedAt: new Date().toISOString(),
      },
      { merge: true }
    );

  logger.info("module chunks saved", buildId, moduleId, `${total} chunks`);
  return total;
}

// ═══════════════════════════════════════════════════════════════
// GET MODULE (assembled from chunks)
// Returns { base64, name, size } or null if not found
// ═══════════════════════════════════════════════════════════════
async function getModuleChunks(buildId, moduleId) {
  if (!buildId || !moduleId) return null;

  const db = getDb();
  const basePath = db
    .collection(COLLECTION)
    .doc(buildId)
    .collection("modules")
    .doc(moduleId)
    .collection("chunks");

  const metaSnap = await basePath.doc("meta").get();
  if (!metaSnap.exists) return null;

  const { total, name, size } = metaSnap.data();

  const parts = [];
  for (let i = 0; i < total; i++) {
    const snap = await basePath.doc(String(i)).get();
    if (snap.exists) {
      parts.push(snap.data().data);
    } else {
      logger.warn("missing module chunk", buildId, moduleId, i);
    }
  }

  if (parts.length !== total) {
    logger.warn(
      "module chunks incomplete",
      buildId,
      moduleId,
      `${parts.length}/${total}`
    );
  }

  return { base64: parts.join(""), name, size };
}

// ═══════════════════════════════════════════════════════════════
// LIST MODULES for a build
// Returns array of { id, name, size, chunks, savedAt }
// ═══════════════════════════════════════════════════════════════
async function listBuildModules(buildId) {
  if (!buildId) return [];

  const db = getDb();
  const snap = await db
    .collection(COLLECTION)
    .doc(buildId)
    .collection("modules")
    .get();

  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ═══════════════════════════════════════════════════════════════
// DELETE MODULE (cleanup)
// ═══════════════════════════════════════════════════════════════
async function deleteModule(buildId, moduleId) {
  if (!buildId || !moduleId) return false;

  const db = getDb();
  const chunksRef = db
    .collection(COLLECTION)
    .doc(buildId)
    .collection("modules")
    .doc(moduleId)
    .collection("chunks");

  const metaSnap = await chunksRef.doc("meta").get();
  if (metaSnap.exists) {
    const total = metaSnap.data().total || 0;
    const batch = db.batch();
    for (let i = 0; i < total; i++) {
      batch.delete(chunksRef.doc(String(i)));
    }
    batch.delete(chunksRef.doc("meta"));
    await batch.commit();
  }

  await db
    .collection(COLLECTION)
    .doc(buildId)
    .collection("modules")
    .doc(moduleId)
    .delete();

  logger.info("module deleted", buildId, moduleId);
  return true;
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════
module.exports = {
  validateModuleStructure,
  saveModuleChunks,
  getModuleChunks,
  listBuildModules,
  deleteModule,
};
