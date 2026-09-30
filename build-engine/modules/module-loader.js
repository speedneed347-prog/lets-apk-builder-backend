'use strict';

const fs = require('fs');
const path = require('path');
const { validateMetadata, validateFileName } = require('./module-schema');

const FORBIDDEN_SOURCE_PATTERNS = [
  /Runtime\.getRuntime\(\)\.exec/, /ProcessBuilder/, /System\.exit\s*\(/,
  /System\.getenv\s*\(/, /deleteRecursively\s*\(/,
];

function safeResolve(root, relativePath) {
  const rootAbs = path.resolve(root);
  const target = path.resolve(rootAbs, relativePath);
  if (target !== rootAbs && !target.startsWith(rootAbs + path.sep)) throw new Error(`Path escapes module root: ${relativePath}`);
  return target;
}

function walk(dir, root, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.relative(root, path.join(dir, entry.name)).replace(/\\/g, '/');
    validateFileName(rel);
    if (entry.isDirectory()) walk(path.join(dir, entry.name), root, out);
    else out.push(rel);
  }
  return out;
}

function scanSource(content, file) {
  for (const pattern of FORBIDDEN_SOURCE_PATTERNS) {
    if (pattern.test(content)) throw new Error(`Forbidden pattern in ${file}`);
  }
}

function loadModule(moduleDir) {
  const root = path.resolve(moduleDir);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`Module directory not found: ${moduleDir}`);
  const metaPath = safeResolve(root, 'module.json');
  if (!fs.existsSync(metaPath)) throw new Error('Module must contain module.json at root');

  const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  validateMetadata(metadata);
  const files = walk(root, root);

  for (const rel of files) {
    if (!rel.endsWith('.kt') && !rel.endsWith('.java') && !rel.endsWith('.gradle')) continue;
    scanSource(fs.readFileSync(safeResolve(root, rel), 'utf8'), rel);
  }

  return { root, metadata, files };
}

module.exports = { loadModule, safeResolve, scanSource };
