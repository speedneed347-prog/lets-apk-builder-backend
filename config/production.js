const crypto = require('crypto');

function has(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateRuntimeConfig() {
  const production = process.env.NODE_ENV === 'production';
  const errors = [];

  if (!has(process.env.FIREBASE_PROJECT_ID)) errors.push('FIREBASE_PROJECT_ID');
  if (!has(process.env.FIREBASE_CLIENT_EMAIL)) errors.push('FIREBASE_CLIENT_EMAIL');
  if (!has(process.env.FIREBASE_PRIVATE_KEY)) errors.push('FIREBASE_PRIVATE_KEY');
  if (!has(process.env.WEBHOOK_SECRET) || process.env.WEBHOOK_SECRET.length < 32) errors.push('WEBHOOK_SECRET(>=32 chars)');
  if (!has(process.env.GITHUB_TOKEN)) errors.push('GITHUB_TOKEN');
  if (!has(process.env.GITHUB_REPO)) errors.push('GITHUB_REPO');

  const origins = String(process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (production && (!origins.length || origins.includes('*'))) {
    errors.push('CORS_ORIGINS(non-wildcard)');
  }

  if (process.env.JWT_ENABLED === 'true' && (!has(process.env.JWT_SECRET) || process.env.JWT_SECRET.length < 32)) {
    errors.push('JWT_SECRET(>=32 chars)');
  }

  return { ok: errors.length === 0, errors };
}

function generateSecretHex(bytes = 64) {
  return crypto.randomBytes(bytes).toString('hex');
}

module.exports = { validateRuntimeConfig, generateSecretHex };
