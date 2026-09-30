const rateLimit = require('express-rate-limit');

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_WEBHOOK_MAX || 60),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many webhook requests.' },
});

const internalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_INTERNAL_MAX || 120),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many internal requests.' },
});

module.exports = { webhookLimiter, internalLimiter };
