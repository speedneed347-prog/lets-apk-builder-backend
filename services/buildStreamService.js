const { getDb } = require("../firebase/firestore");
const logger = require("../utils/logger");

const COLLECTION = "builds";
const HEARTBEAT_MS = Number(process.env.BUILD_STREAM_HEARTBEAT_MS || 25000);

const { sanitizeBuild, formatEvent } = require("./buildStreamProtocol");

/**
 * Streams build document changes over Server-Sent Events (SSE).
 * The caller owns authorization; this service only manages Firestore + SSE.
 */
async function streamBuild(req, res, buildId, canAccess) {
  if (!buildId) return false;

  const ref = getDb().collection(COLLECTION).doc(buildId);
  const initial = await ref.get();
  if (!initial.exists) return false;

  const initialBuild = { id: initial.id, ...initial.data() };
  if (!canAccess(initialBuild)) {
    res.status(403).json({ error: "Forbidden" });
    return true;
  }

  res.status(200);
  res.set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  let closed = false;
  let unsubscribe = null;

  const close = () => {
    if (closed) return;
    closed = true;
    if (unsubscribe) {
      try { unsubscribe(); } catch (_) {}
      unsubscribe = null;
    }
  };

  req.on("close", close);

  res.write(formatEvent("build", sanitizeBuild(initialBuild)));

  const heartbeat = setInterval(() => {
    if (closed || res.writableEnded) return;
    res.write(`: heartbeat ${Date.now()}\n\n`);
  }, Math.max(5000, HEARTBEAT_MS));

  try {
    unsubscribe = ref.onSnapshot(
      (snap) => {
        if (closed || res.writableEnded) return;
        if (!snap.exists) {
          res.write(formatEvent("error", { error: "Build no longer exists" }));
          clearInterval(heartbeat);
          close();
          res.end();
          return;
        }

        const build = { id: snap.id, ...snap.data() };
        if (!canAccess(build)) {
          res.write(formatEvent("error", { error: "Forbidden" }));
          clearInterval(heartbeat);
          close();
          res.end();
          return;
        }

        res.write(formatEvent("build", sanitizeBuild(build)));

        if (build.status === "completed" || build.status === "failed") {
          res.write(formatEvent("done", {
            buildId: build.id,
            status: build.status,
          }));
          clearInterval(heartbeat);
          close();
          res.end();
        }
      },
      (err) => {
        logger.error("build stream error", buildId, err.message);
        if (!closed && !res.writableEnded) {
          res.write(formatEvent("error", { error: "Build stream unavailable" }));
          clearInterval(heartbeat);
          close();
          res.end();
        }
      }
    );
  } catch (err) {
    clearInterval(heartbeat);
    close();
    if (!res.headersSent) {
      res.status(500).json({ error: "Unable to start build stream" });
    } else if (!res.writableEnded) {
      res.end();
    }
    throw err;
  }

  return true;
}

module.exports = { streamBuild };
