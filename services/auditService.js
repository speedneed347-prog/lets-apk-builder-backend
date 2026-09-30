const logger = require("../utils/logger");
const { getDb } = require("../firebase/firestore");
const { nowIso } = require("../utils/helpers");

async function record(action, meta = {}) {
  try {
    const db = getDb();
    await db.collection("audit").add({ action, meta, at: nowIso() });
  } catch (e) {
    logger.warn("audit write failed", e.message);
  }
}

module.exports = { record };
