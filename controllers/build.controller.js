const { v4: uuidv4 } = require("uuid");
const {
  newBuildRecord, saveBuild, getBuild, listBuilds,
  saveZipChunks, getZipChunks,
} = require("../services/buildService");
const {
  saveModuleChunks, getModuleChunks, listBuildModules,
} = require("../services/moduleService");
const { enqueueBuild } = require("../services/buildQueueService");
const { streamBuild } = require("../services/buildStreamService");
const { record } = require("../services/auditService");
const { listBuildHistory, listArtifactRecords } = require("../services/buildHistoryService");
const logger = require("../utils/logger");

// ═══════════════════════════════════════════════════════════════
// CREATE BUILD
// ═══════════════════════════════════════════════════════════════
async function createBuild(req, res, next) {
  try {
    const config = req.validatedConfig;
    const buildId = uuidv4();

    // ─── Pull offline ZIP out of config (stored separately) ───
    const offlineZipBase64 = config.offlineZipBase64 || null;
    const offlineZipName = config.offlineZipName || null;
    const offlineZipSize = config.offlineZipSize || 0;
    delete config.offlineZipBase64;

    // ─── Pull custom modules out of config (admin-only) ───
    const modules = Array.isArray(config.modules) ? config.modules : [];
    delete config.modules;

    // ⭐ SECURITY: Custom modules require admin
    const isAdmin = !!(req.admin && req.admin.role === "admin");
    if (modules.length > 0 && !isAdmin) {
      logger.warn("non-admin attempted custom modules", {
        ip: req.ip,
        moduleCount: modules.length,
      });
      return res.status(403).json({
        error: "Custom modules require admin access. Please log in at /admin-login.html.",
        code: "ADMIN_REQUIRED",
      });
    }

    // ─── Save build record ───
    const record_ = newBuildRecord({ id: buildId, config, userId: req.user?.uid });
    await saveBuild(record_);
    const { appendBuildHistory } = require("../services/buildHistoryService");
    await appendBuildHistory(buildId, { type: "build.created", status: "queued", message: "Build queued", source: "backend" });

    // ─── Save offline ZIP (chunked) ───
    if (offlineZipBase64) {
      try {
        await saveZipChunks(buildId, offlineZipBase64, offlineZipName, offlineZipSize);
        logger.info("offline ZIP saved", buildId, `${Math.round(offlineZipSize / 1024)} KB`);
      } catch (zipErr) {
        logger.error("offline ZIP chunk save failed", buildId, zipErr.message);
        // Non-fatal — build can still work without offline
      }
    }

    // ─── Save each custom module (chunked) ───
    if (modules.length > 0) {
      for (const mod of modules) {
        try {
          await saveModuleChunks(buildId, mod.id, mod.base64, mod.name, mod.size);
          logger.info("module saved", buildId, mod.id, `${Math.round(mod.size / 1024)} KB`);
        } catch (modErr) {
          logger.error("module chunk save failed", buildId, mod.id, modErr.message);
          // Non-fatal — skip this module, build continues
        }
      }
    }

    // ─── Enqueue build; the queue owns GitHub Actions dispatch ───
    await enqueueBuild(buildId);

    // ─── Audit + response ───
    await record("build.created", {
      buildId,
      ip: req.ip,
      moduleCount: modules.length,
      hasOfflineZip: !!offlineZipBase64,
      isAdmin,
    });
    logger.info("build created", buildId, {
      modules: modules.length,
      offline: !!offlineZipBase64,
      isAdmin,
    });

    res.status(201).json({ buildId, status: "queued" });
  } catch (err) {
    next(err);
  }
}

// ═══════════════════════════════════════════════════════════════
// GET BUILD BY ID
// ═══════════════════════════════════════════════════════════════
async function getBuildById(req, res, next) {
  try {
    const build = await getBuild(req.params.id);
    if (!build) return res.status(404).json({ error: "Build not found" });

    if (
      process.env.JWT_ENABLED === "true" &&
      build.userId &&
      req.user?.uid &&
      build.userId !== req.user.uid
    ) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { config, ...safe } = build;
    res.json({ ...safe, config: { ...config, iconBase64: undefined } });
  } catch (err) {
    next(err);
  }
}


// ═══════════════════════════════════════════════════════════════
// LIVE BUILD STREAM (Server-Sent Events)
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// BUILD HISTORY
// ═══════════════════════════════════════════════════════════════
async function getBuildHistory(req, res, next) {
  try {
    const build = await getBuild(req.params.id);
    if (!build) return res.status(404).json({ error: "Build not found" });
    if (process.env.JWT_ENABLED === "true" && build.userId && build.userId !== req.user?.uid) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const history = await listBuildHistory(req.params.id, req.query.limit);
    res.json({ buildId: req.params.id, history });
  } catch (err) { next(err); }
}

// ═══════════════════════════════════════════════════════════════
// ARTIFACT RECORDS
// ═══════════════════════════════════════════════════════════════
async function getBuildArtifacts(req, res, next) {
  try {
    const build = await getBuild(req.params.id);
    if (!build) return res.status(404).json({ error: "Build not found" });
    if (process.env.JWT_ENABLED === "true" && build.userId && build.userId !== req.user?.uid) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const artifacts = await listArtifactRecords(req.params.id);
    res.json({ buildId: req.params.id, artifacts });
  } catch (err) { next(err); }
}

async function streamBuildById(req, res, next) {
  try {
    const buildId = req.params.id;
    const handled = await streamBuild(
      req,
      res,
      buildId,
      (build) => !(
        process.env.JWT_ENABLED === "true" &&
        build.userId &&
        req.user?.uid &&
        build.userId !== req.user.uid
      )
    );
    if (!handled && !res.headersSent) {
      return res.status(404).json({ error: "Build not found" });
    }
  } catch (err) {
    next(err);
  }
}

// ═══════════════════════════════════════════════════════════════
// LIST BUILDS
// ═══════════════════════════════════════════════════════════════
async function listBuildsHandler(req, res, next) {
  try {
    const limit = Math.min(Number(req.query.limit || 20), 100);
    const userId = process.env.JWT_ENABLED === "true" ? req.user?.uid : null;
    const builds = await listBuilds({ limit, userId });

    res.json({
      builds: builds.map((b) => {
        const { config, ...rest } = b;
        return {
          ...rest,
          config: config ? { ...config, iconBase64: undefined } : null,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
}

// ═══════════════════════════════════════════════════════════════
// DOWNLOAD APK (redirect to GitHub Releases)
// ═══════════════════════════════════════════════════════════════
async function downloadBuild(req, res, next) {
  try {
    const build = await getBuild(req.params.id);
    if (!build) return res.status(404).json({ error: "Build not found" });

    const artifactUrl = build.artifactUrl || build.apkUrl;
    if (build.status !== "completed" || !artifactUrl) {
      return res.status(409).json({
        error: "Build not completed",
        status: build.status,
      });
    }

    if (process.env.JWT_ENABLED === "true" && build.userId && build.userId !== req.user?.uid) {
      return res.status(403).json({ error: "Forbidden" });
    }

    return res.redirect(302, artifactUrl);
  } catch (err) {
    next(err);
  }
}

// ═══════════════════════════════════════════════════════════════
// INTERNAL — worker only
// Returns full config including iconBase64
// ═══════════════════════════════════════════════════════════════
async function getInternalConfig(req, res, next) {
  try {
    const build = await getBuild(req.params.buildId);
    if (!build) return res.status(404).json({ error: "Build not found" });

    res.json({
      contractVersion: 1,
      id: build.id,
      status: build.status,
      config: build.config,
    });
  } catch (err) {
    next(err);
  }
}

// ═══════════════════════════════════════════════════════════════
// INTERNAL — worker only
// Returns the offline ZIP (assembled from chunks) or 404
// ═══════════════════════════════════════════════════════════════
async function getInternalZip(req, res, next) {
  try {
    const zip = await getZipChunks(req.params.buildId);
    if (!zip) return res.status(404).json({ error: "No offline ZIP" });

    res.json(zip);
  } catch (err) {
    next(err);
  }
}

// ═══════════════════════════════════════════════════════════════
// INTERNAL — worker only
// Lists all custom modules for a build
// ═══════════════════════════════════════════════════════════════
async function getInternalModulesList(req, res, next) {
  try {
    const modules = await listBuildModules(req.params.buildId);
    res.json({ modules });
  } catch (err) {
    next(err);
  }
}

// ═══════════════════════════════════════════════════════════════
// INTERNAL — worker only
// Returns a single module's base64 content (assembled from chunks)
// ═══════════════════════════════════════════════════════════════
async function getInternalModule(req, res, next) {
  try {
    const { buildId, moduleId } = req.params;
    const mod = await getModuleChunks(buildId, moduleId);
    if (!mod) return res.status(404).json({ error: "Module not found" });

    res.json(mod);
  } catch (err) {
    next(err);
  }
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════
module.exports = {
  createBuild,
  getBuildById,
  streamBuildById,
  getBuildHistory,
  getBuildArtifacts,
  listBuildsHandler,
  downloadBuild,
  getInternalConfig,
  getInternalZip,
  getInternalModulesList,
  getInternalModule,
};
