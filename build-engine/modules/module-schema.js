'use strict';

const ID_RE = /^[a-z][a-z0-9._-]{1,63}$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

const ALLOWED_EXTENSIONS = new Set([
  '.kt', '.java', '.xml', '.gradle', '.json',
  '.png', '.jpg', '.jpeg', '.webp', '.ttf', '.otf', '.txt', '.md'
]);

function assertString(value, field, max = 200) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty string`);
  if (value.length > max) throw new Error(`${field} is too long`);
}

function validateMetadata(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('module.json must contain an object');
  assertString(meta.id, 'id', 64);
  if (!ID_RE.test(meta.id)) throw new Error('module.id must start with a lowercase letter and contain only a-z, 0-9, ., _, -');
  assertString(meta.name, 'name', 120);
  assertString(meta.version, 'version', 80);
  if (!VERSION_RE.test(meta.version)) throw new Error('module.version must use semantic version format, e.g. 1.0.0');

  if (meta.overrideMainActivity !== undefined && typeof meta.overrideMainActivity !== 'boolean') {
    throw new Error('overrideMainActivity must be boolean');
  }

  if (meta.permissions !== undefined && (!Array.isArray(meta.permissions) || meta.permissions.some(x => typeof x !== 'string'))) {
    throw new Error('permissions must be an array of strings');
  }

  if (meta.dependencies !== undefined && (!Array.isArray(meta.dependencies) || meta.dependencies.some(x => typeof x !== 'string'))) {
    throw new Error('dependencies must be an array of strings');
  }

  return true;
}

function validateFileName(fileName) {
  const normalized = String(fileName).replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('../') || normalized === '..' || normalized.includes('/./')) {
    throw new Error(`Unsafe module path: ${fileName}`);
  }
  const base = normalized.split('/').pop();
  const dot = base.lastIndexOf('.');
  if (dot === -1) return true;
  const ext = base.slice(dot).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) throw new Error(`File type not allowed: ${fileName}`);
  return true;
}

module.exports = { ALLOWED_EXTENSIONS, validateMetadata, validateFileName };
