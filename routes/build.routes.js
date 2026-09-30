const express = require("express");
const router = express.Router();
const { buildLimiter, apiLimiter } = require("../middleware/rateLimitMiddleware");
const { validateBuildBody } = require("../middleware/validationMiddleware");
const { optionalAuth } = require("../middleware/authMiddleware");
const { optionalAdmin } = require("../middleware/adminMiddleware");
const ctrl = require("../controllers/build.controller");

// ⭐ optionalAdmin added — sets req.admin if valid JWT present
router.post("/", buildLimiter, optionalAdmin, validateBuildBody, ctrl.createBuild);
router.get("/", apiLimiter, optionalAuth, ctrl.listBuildsHandler);

module.exports = router;
