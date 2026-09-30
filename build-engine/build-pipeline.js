#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { build, findArtifacts } = require('./gradle-builder');
const { signApk, signAab } = require('./signing/signing-manager');

const FORMATS = Object.freeze({
  apk: { target: 'release-apk', extension: '.apk' },
  aab: { target: 'release-aab', extension: '.aab' },
});

function safeName(value, fallback = 'app') {
  const name = String(value || fallback)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return name || fallback;
}

function normalizeFormat(value) {
  const format = String(value || 'apk').toLowerCase();
  if (!FORMATS[format]) throw new Error(`Unsupported build format: ${format}; expected apk or aab`);
  return format;
}

function readConfig(configPath) {
  const resolved = path.resolve(configPath);
  if (!fs.existsSync(resolved)) throw new Error(`Config not found: ${resolved}`);
  const config = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  return { ...config, buildFormat: normalizeFormat(config.buildFormat || config.outputFormat) };
}

function selectArtifact(artifacts, extension) {
  const candidates = artifacts.filter((file) => path.extname(file).toLowerCase() === extension);
  if (!candidates.length) throw new Error(`No ${extension.slice(1).toUpperCase()} artifact found after Gradle build`);
  return candidates[0];
}

function buildRelease({ configPath = 'config.json', projectDir = 'android-project', outputDir = '.', resultFile = process.env.BUILD_RESULT_FILE || 'build-result.json' } = {}) {
  const config = readConfig(configPath);
  const format = config.buildFormat;
  const meta = FORMATS[format];
  const project = path.resolve(projectDir);
  const outputRoot = path.resolve(outputDir);

  console.log(`Build format: ${format.toUpperCase()}`);
  console.log(`Gradle target: ${meta.target}`);

  const built = build(meta.target, project);
  const unsigned = selectArtifact(built, meta.extension);
  const app = safeName(config.appName, 'app');
  const version = safeName(config.versionName, '1.0.0');
  const finalName = `${app}-v${version}${meta.extension}`;
  const finalPath = path.join(outputRoot, finalName);

  let signed;
  if (format === 'apk') signed = signApk(unsigned, finalPath);
  else signed = signAab(unsigned, finalPath);

  const result = {
    schemaVersion: 1,
    buildFormat: format,
    artifactType: format,
    fileName: finalName,
    path: finalPath,
    sha256: signed.sha256,
    sizeBytes: signed.sizeBytes,
  };
  fs.writeFileSync(path.resolve(resultFile), JSON.stringify(result, null, 2));
  console.log(`BUILD_RESULT=${JSON.stringify(result)}`);
  return result;
}

function usage() {
  console.log(`Usage:\n  node build-engine/build-pipeline.js [config.json] [projectDir] [outputDir] [resultFile]\n\nThe pipeline reads buildFormat (apk|aab), runs the matching Gradle release task, signs the artifact, and writes build-result.json.`);
}

if (require.main === module) {
  const [configPath, projectDir, outputDir, resultFile] = process.argv.slice(2);
  if (configPath === '--help') { usage(); process.exit(0); }
  try {
    buildRelease({ configPath, projectDir, outputDir, resultFile });
  } catch (err) {
    console.error(`Build pipeline error: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { FORMATS, normalizeFormat, readConfig, selectArtifact, buildRelease, safeName };
