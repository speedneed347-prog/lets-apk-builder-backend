const express = require("express");
const router = express.Router();
const buildRoutes = require("./build.routes");
const webhookRoutes = require("./webhook.routes");
const adminRoutes = require("./admin.routes");
const ctrl = require("../controllers/build.controller");
const { apiLimiter } = require("../middleware/rateLimitMiddleware");
const { optionalAuth } = require("../middleware/authMiddleware");
const { requireInternalSecret } = require("../middleware/internalAuthMiddleware");
const { internalLimiter } = require("../middleware/webhookRateLimit");
const fetch = require("node-fetch");

router.use("/build", buildRoutes);
router.use("/webhook", webhookRoutes);
router.use("/admin", adminRoutes);

router.get("/build/:id/history", apiLimiter, optionalAuth, ctrl.getBuildHistory);
router.get("/build/:id/artifacts", apiLimiter, optionalAuth, ctrl.getBuildArtifacts);
router.get("/build/:id/stream", apiLimiter, optionalAuth, ctrl.streamBuildById);
router.get("/build/:id", apiLimiter, optionalAuth, ctrl.getBuildById);
router.get("/download/:id", apiLimiter, optionalAuth, ctrl.downloadBuild);
router.get("/builds", apiLimiter, optionalAuth, ctrl.listBuildsHandler);

// ═══════════════════════════════════════════════════════════════
// PUBLIC: List common modules from GitHub repo
// ═══════════════════════════════════════════════════════════════
router.get("/common-modules", apiLimiter, async (_req, res) => {
  try {
    const repo = process.env.GITHUB_REPO;
    const ref = process.env.GITHUB_REF || "main";
    if (!repo) return res.json({ modules: [] });

    const url = `https://raw.githubusercontent.com/${repo}/${ref}/templates/common-modules.json`;
    const r = await fetch(url, { timeout: 8000 });

    if (!r.ok) return res.json({ modules: [] });

    const registry = await r.json();
    const modules = (registry.modules || []).map(m => ({
      id: m.id,
      name: m.name,
      description: m.description,
      icon: m.icon,
      default: m.default,
      compatible: m.compatible,
    }));
    res.json({ modules });
  } catch (err) {
    res.json({ modules: [] });
  }
});

// Worker-only internal endpoints
router.use("/internal", internalLimiter, requireInternalSecret);
router.get("/internal/config/:buildId", ctrl.getInternalConfig);
router.get("/internal/zip/:buildId", ctrl.getInternalZip);
router.get("/internal/modules/:buildId", ctrl.getInternalModulesList);
router.get("/internal/module/:buildId/:moduleId", ctrl.getInternalModule);

router.get("/platform", (_req, res) => res.json({
  name: "Let-S APK Builder",
  apiVersion: 1,
  contractVersion: 1,
  status: "production",
  supported: {
    appTypes: ["webview", "file-share"],
    appModes: ["offline", "online", "hybrid", "native"],
    buildFormats: ["apk", "aab"],
    orientations: ["portrait", "landscape", "auto"],
  },
  endpoints: {
    createBuild: "POST /api/build",
    getBuild: "GET /api/build/:id",
    stream: "GET /api/build/:id/stream",
    history: "GET /api/build/:id/history",
    artifacts: "GET /api/build/:id/artifacts",
    download: "GET /api/download/:id",
    commonModules: "GET /api/common-modules",
    health: "GET /api/health",
    readiness: "GET /api/health/ready",
  },
}));

router.get("/health", (_req, res) => res.json({ ok: true, status: "ok", ts: new Date().toISOString() }));

router.get("/health/live", (_req, res) => res.json({ ok: true, status: "live", ts: new Date().toISOString() }));

router.get("/health/ready", async (_req, res, next) => {
  try {
    const { getDb } = require("../firebase/firestore");
    await getDb().collection("system").doc("health").get();
    res.json({ ok: true, status: "ready", ts: new Date().toISOString() });
  } catch (err) {
    next(Object.assign(new Error("Service not ready"), { status: 503, cause: err }));
  }
});

module.exports = router;
