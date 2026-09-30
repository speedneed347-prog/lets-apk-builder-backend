const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/admin.controller");
const { requireAdmin } = require("../middleware/adminMiddleware");
const rateLimit = require("express-rate-limit");

// Very strict rate limit for login attempts
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per 15 min
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Try again later." },
});

router.post("/login", loginLimiter, ctrl.login);
router.get("/me", requireAdmin, ctrl.me);

module.exports = router;
