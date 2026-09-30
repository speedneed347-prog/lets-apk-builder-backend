const crypto = require('crypto');

function getInternalSecret() {
  return process.env.INTERNAL_API_SECRET || process.env.WEBHOOK_SECRET || '';
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (!aa.length || aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function requireInternalSecret(req, res, next) {
  const provided = req.headers['x-internal-secret'];
  if (!safeEqual(provided, getInternalSecret())) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

module.exports = { requireInternalSecret, getInternalSecret };
