const rateLimit = require("express-rate-limit");

const buildLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_BUILD_MAX || 5),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many build requests. Try again later." },
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_API_MAX || 100),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests." },
});

module.exports = { buildLimiter, apiLimiter };
