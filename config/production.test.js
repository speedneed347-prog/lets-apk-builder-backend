const assert = require('assert');
const { validateRuntimeConfig, generateSecretHex } = require('./production');

const old = { ...process.env };
try {
  process.env.NODE_ENV = 'production';
  process.env.FIREBASE_PROJECT_ID = 'p';
  process.env.FIREBASE_CLIENT_EMAIL = 'x@example.com';
  process.env.FIREBASE_PRIVATE_KEY = 'key';
  process.env.WEBHOOK_SECRET = 'a'.repeat(64);
  process.env.GITHUB_TOKEN = 'token';
  process.env.GITHUB_REPO = 'owner/repo';
  process.env.CORS_ORIGINS = 'https://example.com';
  process.env.JWT_ENABLED = 'false';
  assert.equal(validateRuntimeConfig().ok, true);
  process.env.CORS_ORIGINS = '*';
  assert.equal(validateRuntimeConfig().ok, false);
  assert.equal(generateSecretHex(64).length, 128);
  console.log('production config tests: OK');
} finally {
  for (const k of Object.keys(process.env)) {
    if (!(k in old)) delete process.env[k];
  }
  Object.assign(process.env, old);
}
