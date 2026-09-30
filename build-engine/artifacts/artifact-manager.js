#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function sha256(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function safeName(value, fallback = 'app') {
  const name = String(value || fallback)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return name || fallback;
}

function collectArtifacts(projectDir, kind) {
  const root = path.resolve(projectDir);
  const output = path.join(root, 'app', 'build', 'outputs');
  const dirs = kind === 'aab'
    ? [path.join(output, 'bundle', 'release')]
    : [path.join(output, 'apk', 'release'), path.join(output, 'apk', 'debug')];
  const ext = kind === 'aab' ? '.aab' : '.apk';
  const files = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      if (entry.endsWith(ext)) files.push(path.join(dir, entry));
    }
  }
  return files;
}

function createArtifactManifest({ projectDir, config = {}, kind = 'apk', destination = 'artifacts', sourceFiles = [] }) {
  const files = sourceFiles.length ? sourceFiles.map((file) => path.resolve(file)) : collectArtifacts(projectDir, kind);
  for (const file of files) {
    if (!fs.existsSync(file)) throw new Error(`Artifact source not found: ${file}`);
  }
  if (!files.length) throw new Error(`No ${kind.toUpperCase()} artifact found`);

  const outDir = path.resolve(destination);
  fs.mkdirSync(outDir, { recursive: true });
  const artifacts = files.map((source) => {
    const ext = path.extname(source).toLowerCase();
    const app = safeName(config.appName, 'app');
    const version = safeName(config.versionName, '1.0.0');
    const target = path.join(outDir, `${app}-v${version}${ext}`);
    fs.copyFileSync(source, target);
    const stat = fs.statSync(target);
    return {
      type: ext === '.aab' ? 'aab' : 'apk',
      fileName: path.basename(target),
      path: target,
      sizeBytes: stat.size,
      sha256: sha256(target)
    };
  });

  const manifest = {
    schemaVersion: 1,
    buildId: config.buildId || null,
    appName: config.appName || null,
    packageName: config.packageName || null,
    versionName: config.versionName || null,
    versionCode: config.versionCode || null,
    generatedAt: new Date().toISOString(),
    artifacts
  };
  const manifestPath = path.join(outDir, 'artifact-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return { manifestPath, manifest };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const [projectDir = 'android-project', configPath = 'config.json', kind = 'apk', destination = 'artifacts', ...sourceFiles] = args;
  try {
    const config = JSON.parse(fs.readFileSync(path.resolve(configPath), 'utf8'));
    const result = createArtifactManifest({ projectDir, config, kind, destination, sourceFiles });
    console.log(JSON.stringify(result.manifest, null, 2));
  } catch (err) {
    console.error(`Artifact manager error: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { collectArtifacts, createArtifactManifest, sha256, safeName };
