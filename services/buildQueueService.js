const { getDb } = require("../firebase/firestore");
const { triggerBuildWorkflow } = require("./githubService");
const { updateBuild, getBuild } = require("./buildService");
const { record } = require("./auditService");
const logger = require("../utils/logger");
const { appendBuildHistory } = require('./buildHistoryService');

const QUEUE_COLLECTION = "system";
const QUEUE_DOC = "buildQueue";
const LEASE_MS = Number(process.env.BUILD_QUEUE_LEASE_MS || 35 * 60 * 1000);
const SCAN_LIMIT = 100;

let pumpRunning = false;
let queueInterval = null;

function queueRef() {
  return getDb().collection(QUEUE_COLLECTION).doc(QUEUE_DOC);
}

function isExpired(value) {
  if (!value) return true;
  const ms = typeof value.toMillis === "function" ? value.toMillis() : new Date(value).getTime();
  return !Number.isFinite(ms) || ms <= Date.now();
}

/**
 * Atomically claims the oldest queued build.
 * Only one backend instance can own the active queue slot at a time.
 */
async function claimNextBuild() {
  const db = getDb();

  return db.runTransaction(async (tx) => {
    const qRef = queueRef();
    const qSnap = await tx.get(qRef);
    const q = qSnap.exists ? qSnap.data() : {};

    let activeNeedsRelease = false;
    let activeToFail = null; // only non-terminal builds may be force-failed
    if (q.activeBuildId) {
      const activeRef = db.collection("builds").doc(q.activeBuildId);
      const activeSnap = await tx.get(activeRef);
      const active = activeSnap.exists ? activeSnap.data() : null;

      if (active && !["completed", "failed"].includes(active.status) && !isExpired(q.leaseUntil)) {
        return null;
      }
      activeNeedsRelease = true;
      if (active && !["completed", "failed"].includes(active.status)) {
        activeToFail = q.activeBuildId;
      }
    }

    // IMPORTANT: every Firestore read happens before any transaction write.
    // Only scan builds that are actually waiting. Scanning ALL builds (oldest first)
    // would starve new jobs once the oldest SCAN_LIMIT builds are finished.
    // Requires composite index: builds(status ASC, createdAt ASC) — see firestore.indexes.json
    const snap = await tx.get(
      db.collection("builds").where("status", "==", "queued").orderBy("createdAt", "asc").limit(SCAN_LIMIT)
    );

    let candidate = null;
    for (const doc of snap.docs) {
      const data = doc.data();
      if (data.status === "queued" && !data.queueDispatchedAt) {
        candidate = { id: doc.id, ...data };
        break;
      }
    }

    if (activeNeedsRelease) {
      if (activeToFail) {
        tx.set(db.collection("builds").doc(activeToFail), {
          status: "failed",
          dispatchStatus: "lease-expired",
          error: "Build queue lease expired before the worker reported completion.",
          completedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      }

      tx.set(qRef, {
        activeBuildId: null,
        leaseUntil: null,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
    }

    if (!candidate) return null;

    const now = Date.now();
    const leaseUntil = new Date(now + LEASE_MS).toISOString();
    const attempts = Number(candidate.dispatchAttempts || 0) + 1;

    tx.set(qRef, {
      activeBuildId: candidate.id,
      leaseUntil,
      updatedAt: new Date(now).toISOString(),
    }, { merge: true });

    tx.set(db.collection("builds").doc(candidate.id), {
      queueClaimedAt: new Date(now).toISOString(),
      dispatchAttempts: attempts,
      queuePosition: null,
      updatedAt: new Date(now).toISOString(),
    }, { merge: true });

    return {
      id: candidate.id,
      config: candidate.config || {},
      attempts,
    };
  });
}

async function releaseBuild(buildId) {
  if (!buildId) return false;
  const db = getDb();

  return db.runTransaction(async (tx) => {
    const qRef = queueRef();
    const snap = await tx.get(qRef);
    if (!snap.exists || snap.data().activeBuildId !== buildId) return false;

    tx.set(qRef, {
      activeBuildId: null,
      leaseUntil: null,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    return true;
  });
}

/**
 * Dispatches at most one new GitHub Actions build at a time.
 * The lock is persisted in Firestore so Render restarts do not create parallel builds.
 */
async function pumpQueue() {
  if (pumpRunning) return { dispatched: false, reason: "pump-running" };
  pumpRunning = true;

  try {
    const job = await claimNextBuild();
    if (!job) return { dispatched: false, reason: "no-job" };

    try {
      await triggerBuildWorkflow(job.id, job.config);
      await updateBuild(job.id, {
        queueDispatchedAt: new Date().toISOString(),
        dispatchStatus: "dispatched",
        updatedAt: new Date().toISOString(),
      });
      await appendBuildHistory(job.id, {
        type: "build.dispatched",
        status: "queued",
        message: `Build dispatched to GitHub Actions (attempt ${job.attempts})`,
        source: "queue",
      });
      await record("build.dispatched", {
        buildId: job.id,
        attempts: job.attempts,
      });

      logger.info("queue dispatched build", job.id, `attempt=${job.attempts}`);
      return { dispatched: true, buildId: job.id };
    } catch (err) {
      await updateBuild(job.id, {
        status: "failed",
        dispatchStatus: "failed",
        error: `Build dispatch failed: ${err.message}`.slice(0, 4000),
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      await releaseBuild(job.id);
      await appendBuildHistory(job.id, {
        type: "build.dispatch_failed",
        status: "failed",
        message: `Build dispatch failed: ${err.message}`.slice(0, 1000),
        source: "queue",
      });
      await record("build.dispatch_failed", {
        buildId: job.id,
        attempts: job.attempts,
        error: err.message,
      });
      logger.error("queue dispatch failed", job.id, err.message);
      return { dispatched: false, reason: "dispatch-failed", buildId: job.id };
    }
  } finally {
    pumpRunning = false;
  }
}

async function enqueueBuild(buildId) {
  if (!buildId) throw new Error("buildId required");

  await updateBuild(buildId, {
    status: "queued",
    queueEnteredAt: new Date().toISOString(),
    queueDispatchedAt: null,
    dispatchStatus: "waiting",
    updatedAt: new Date().toISOString(),
  });

  // Do not make queueing depend on GitHub dispatch succeeding synchronously.
  // The background pump and webhook completion will continue the queue.
  void pumpQueue();

  return { buildId, status: "queued" };
}

async function onBuildFinished(buildId) {
  const released = await releaseBuild(buildId);
  if (released) logger.info("queue slot released", buildId);
  void pumpQueue();
  return released;
}

async function getQueueState() {
  const snap = await queueRef().get();
  if (!snap.exists) {
    return { activeBuildId: null, leaseUntil: null };
  }
  return snap.data();
}

async function startQueuePump() {
  await pumpQueue();
  const intervalMs = Number(process.env.BUILD_QUEUE_POLL_MS || 15000);
  queueInterval = setInterval(() => {
    void pumpQueue();
  }, Math.max(5000, intervalMs));
  return queueInterval;
}

module.exports = {
  enqueueBuild,
  pumpQueue,
  onBuildFinished,
  releaseBuild,
  getQueueState,
  startQueuePump,
  stopQueuePump: () => {
    if (queueInterval) {
      clearInterval(queueInterval);
      queueInterval = null;
    }
  }
};
