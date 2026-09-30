#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PROJECT_ROOT = path.resolve(process.env.ANDROID_PROJECT_DIR || 'android-project');

const TARGETS = Object.freeze({
  'debug-apk': 'assembleDebug',
  'release-apk': 'assembleRelease',
  'release-aab': 'bundleRelease',
});

function usage() {
  console.log(`Usage:\n  node build-engine/gradle-builder.js <target> [projectDir]\n\nTargets:\n  debug-apk    Build a debug APK\n  release-apk  Build a release APK\n  release-aab  Build a release AAB\n\nEnvironment:\n  GRADLE_BIN            Gradle executable (default: gradle)\n  GRADLE_TIMEOUT_MS     Build timeout (default: 20 minutes)`);
}

function assertProject(projectDir) {
  const root = path.resolve(projectDir || PROJECT_ROOT);
  const buildFile = path.join(root, 'app', 'build.gradle');
  if (!fs.existsSync(root)) throw new Error(`Android project not found: ${root}`);
  if (!fs.existsSync(buildFile)) throw new Error(`Missing app/build.gradle: ${buildFile}`);
  return root;
}

function findArtifacts(projectDir, target) {
  const releaseDir = path.join(projectDir, 'app', 'build', 'outputs');
  const candidates = target === 'release-aab'
    ? [path.join(releaseDir, 'bundle', 'release')]
    : [path.join(releaseDir, 'apk', target === 'debug-apk' ? 'debug' : 'release')];

  const found = [];
  for (const dir of candidates) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const ext = target === 'release-aab' ? '.aab' : '.apk';
      if (name.endsWith(ext)) found.push(path.join(dir, name));
    }
  }
  return found;
}

function build(target, projectDir = PROJECT_ROOT) {
  if (!TARGETS[target]) throw new Error(`Unknown build target: ${target}`);
  const root = assertProject(projectDir);
  const task = TARGETS[target];
  const gradle = process.env.GRADLE_BIN || 'gradle';
  const timeout = Number(process.env.GRADLE_TIMEOUT_MS || 20 * 60 * 1000);

  console.log(`Build target: ${target}`);
  console.log(`Gradle task: ${task}`);
  console.log(`Project: ${root}`);

  const result = spawnSync(gradle, [task, '--no-daemon', '--stacktrace'], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    timeout,
    windowsHide: true,
  });

  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') {
      throw new Error(`Gradle build timed out after ${Math.round(timeout / 60000)} minutes`);
    }
    throw result.error;
  }
  if (result.status !== 0) throw new Error(`Gradle exited with code ${result.status}`);

  const artifacts = findArtifacts(root, target);
  if (!artifacts.length) throw new Error(`Gradle succeeded but no ${target} artifact was found`);

  console.log('Build artifacts:');
  for (const file of artifacts) {
    console.log(`  ${file} (${fs.statSync(file).size} bytes)`);
  }
  return artifacts;
}

if (require.main === module) {
  const [target, projectDir] = process.argv.slice(2);
  if (!target) { usage(); process.exit(1); }
  try {
    build(target, projectDir || PROJECT_ROOT);
  } catch (err) {
    console.error(`Gradle builder error: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { TARGETS, build, findArtifacts };
