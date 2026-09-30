const { verifyHmac, isFreshTimestamp } = require("../utils/helpers");
const { applyWorkerEvent } = require("../services/buildIntegrationService");
const logger = require("../utils/logger");


async function githubWebhook(req, res, next) {
  try {
    const raw = req.rawBody ? req.rawBody : Buffer.from(JSON.stringify(req.body || {}));
    const signature = req.headers["x-hub-signature-256"];

    if (!process.env.WEBHOOK_SECRET) return res.status(503).json({ error: "Webhook security is not configured" });

    if (!verifyHmac(process.env.WEBHOOK_SECRET, raw, signature)) {
      logger.warn("webhook HMAC verification failed", req.ip);
      return res.status(401).json({ error: "Invalid signature" });
    }

    const body = req.body || {};
    if (!body.buildId) return res.status(400).json({ error: "buildId required" });
    if (!body.eventId || String(body.eventId).length > 128) {
      return res.status(400).json({ error: "eventId required" });
    }
    if (!body.timestamp || !isFreshTimestamp(body.timestamp, Number(process.env.WEBHOOK_MAX_AGE_MS || 5 * 60 * 1000))) {
      return res.status(400).json({ error: "stale timestamp" });
    }

    const result = await applyWorkerEvent(body);
    if (!result.accepted) {
      const code = result.reason === "Build not found" ? 404 : 409;
      return res.status(code).json({ ok: false, error: result.reason });
    }

    logger.info("worker webhook processed", body.buildId, body.status || "event");
    return res.status(200).json({
      ok: true,
      accepted: true,
      duplicate: !!result.duplicate,
    });
  } catch (err) {
    next(err);
  }
}
module.exports = { githubWebhook };
