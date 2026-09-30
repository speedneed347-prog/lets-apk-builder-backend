#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

function usage() {
  console.log(`Usage:\n  node build-engine/signing/signing-manager.js apk <unsigned.apk> <signed.apk>\n  node build-engine/signing/signing-manager.js aab <unsigned.aab> <signed.aab>\n\nEnvironment:\n  KEYSTORE_BASE64              Base64 encoded JKS/PKCS12 keystore\n  KEYSTORE_PASSWORD             Keystore password\n  KEY_PASSWORD                  Signing key password\n  KEY_ALIAS                     Signing key alias\n  ANDROID_HOME                  Android SDK root (APK)\n  ANDROID_BUILD_TOOLS_VERSION   Exact build-tools version (APK)\n  ANDROID_BUILD_TOOLS_DIR       Exact build-tools directory (APK)\n  SIGNING_TIMEOUT_MS             Tool timeout (default: 5 minutes)`);
}

function validateSigningConfig(env = process.env) {
  const names = ['KEYSTORE_BASE64', 'KEYSTORE_PASSWORD', 'KEY_PASSWORD', 'KEY_ALIAS'];
  const missing = names.filter((name) => !env[name] || !String(env[name]).trim());
  if (missing.length) throw new Error(`Missing signing configuration: ${missing.join(', ')}`);
  return true;
}

function versionParts(value) {
  return String(value).split('.').map((part) => {
    const n = Number(part);
    return Number.isFinite(n) ? n : 0;
  });
}

function compareVersions(a, b) {
  const pa = versionParts(a);
  const pb = versionParts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

function findBuildToolsDir(env = process.env) {
  if (env.ANDROID_BUILD_TOOLS_DIR) {
    const exact = path.resolve(env.ANDROID_BUILD_TOOLS_DIR);
    if (!fs.existsSync(path.join(exact, 'zipalign'))) throw new Error(`zipalign not found: ${exact}`);
    if (!fs.existsSync(path.join(exact, 'apksigner'))) throw new Error(`apksigner not found: ${exact}`);
    return exact;
  }
  const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT;
  if (!sdk) throw new Error('ANDROID_HOME or ANDROID_SDK_ROOT is required');
  const root = path.join(path.resolve(sdk), 'build-tools');
  if (!fs.existsSync(root)) throw new Error(`Android build-tools directory not found: ${root}`);
  const requested = env.ANDROID_BUILD_TOOLS_VERSION;
  const versions = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => /^\d+(?:\.\d+){1,3}$/.test(name));
  if (!versions.length) throw new Error(`No Android build-tools versions found in ${root}`);
  const selected = requested || versions.sort(compareVersions).at(-1);
  if (!versions.includes(selected)) throw new Error(`Requested Android build-tools version not installed: ${selected}`);
  const dir = path.join(root, selected);
  if (!fs.existsSync(path.join(dir, 'zipalign'))) throw new Error(`zipalign not found: ${dir}`);
  if (!fs.existsSync(path.join(dir, 'apksigner'))) throw new Error(`apksigner not found: ${dir}`);
  return dir;
}

function decodeKeystore(base64, destination) {
  const normalized = String(base64).replace(/\s+/g, '');
  if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) throw new Error('KEYSTORE_BASE64 is not valid base64');
  const data = Buffer.from(normalized, 'base64');
  if (!data.length) throw new Error('Decoded keystore is empty');
  fs.writeFileSync(destination, data, { mode: 0o600 });
  return data.length;
}

function run(file, args, options = {}) {
  return execFileSync(file, args, {
    stdio: options.stdio || 'inherit',
    timeout: options.timeout,
    windowsHide: true,
    env: options.env || process.env,
  });
}

function assertArtifact(file, extension, label) {
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved)) throw new Error(`${label} not found: ${resolved}`);
  if (!fs.statSync(resolved).isFile()) throw new Error(`${label} is not a file: ${resolved}`);
  if (path.extname(resolved).toLowerCase() !== extension) throw new Error(`${label} must be an ${extension} file`);
  return resolved;
}

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function signApk(inputApk, outputApk, options = {}) {
  validateSigningConfig(options.env || process.env);
  const env = options.env || process.env;
  const input = assertArtifact(inputApk, '.apk', 'Unsigned APK');
  const output = path.resolve(outputApk);
  if (input === output) throw new Error('Signed output must be different from unsigned input');
  const buildTools = options.buildToolsDir || findBuildToolsDir(env);
  const zipalign = path.join(buildTools, 'zipalign');
  const apksigner = path.join(buildTools, 'apksigner');
  const timeout = Number(env.SIGNING_TIMEOUT_MS || 5 * 60 * 1000);
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('SIGNING_TIMEOUT_MS must be a positive number');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lets-apk-sign-'));
  const keystore = path.join(tempDir, 'keystore.jks');
  const aligned = path.join(tempDir, 'aligned.apk');
  const ksPass = path.join(tempDir, 'keystore-password.txt');
  const keyPass = path.join(tempDir, 'key-password.txt');
  try {
    decodeKeystore(env.KEYSTORE_BASE64, keystore);
    fs.writeFileSync(ksPass, String(env.KEYSTORE_PASSWORD), { mode: 0o600 });
    fs.writeFileSync(keyPass, String(env.KEY_PASSWORD), { mode: 0o600 });
    console.log(`Signing APK: ${path.basename(input)}`);
    console.log(`Build tools: ${buildTools}`);
    run(zipalign, ['-f', '-p', '4', input, aligned], { timeout });
    run(apksigner, ['sign', '--ks', keystore, '--ks-key-alias', String(env.KEY_ALIAS), '--ks-pass', `file:${ksPass}`, '--key-pass', `file:${keyPass}`, '--out', output, aligned], { timeout });
    run(apksigner, ['verify', '--verbose', output], { timeout });
    const stat = fs.statSync(output);
    if (!stat.size) throw new Error('Signed APK was created but is empty');
    const sha256 = hashFile(output);
    console.log(`✓ Signed APK: ${output}`);
    console.log(`✓ Size: ${stat.size} bytes`);
    console.log(`✓ SHA-256: ${sha256}`);
    return { output, sizeBytes: stat.size, sha256, buildTools, type: 'apk' };
  } catch (err) {
    if (fs.existsSync(output)) fs.rmSync(output, { force: true });
    throw err;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function signAab(inputAab, outputAab, options = {}) {
  validateSigningConfig(options.env || process.env);
  const env = options.env || process.env;
  const input = assertArtifact(inputAab, '.aab', 'Unsigned AAB');
  const output = path.resolve(outputAab);
  if (input === output) throw new Error('Signed output must be different from unsigned input');
  const jarsigner = env.JARSIGNER_BIN || 'jarsigner';
  const timeout = Number(env.SIGNING_TIMEOUT_MS || 5 * 60 * 1000);
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('SIGNING_TIMEOUT_MS must be a positive number');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lets-aab-sign-'));
  const keystore = path.join(tempDir, 'keystore.jks');
  const ksPass = path.join(tempDir, 'keystore-password.txt');
  const keyPass = path.join(tempDir, 'key-password.txt');
  try {
    decodeKeystore(env.KEYSTORE_BASE64, keystore);
    fs.writeFileSync(ksPass, String(env.KEYSTORE_PASSWORD), { mode: 0o600 });
    fs.writeFileSync(keyPass, String(env.KEY_PASSWORD), { mode: 0o600 });
    console.log(`Signing AAB: ${path.basename(input)}`);
    run(jarsigner, ['-keystore', keystore, '-storepass:file', ksPass, '-keypass:file', keyPass, '-signedjar', output, input, String(env.KEY_ALIAS)], { timeout });
    run(jarsigner, ['-verify', '-strict', output], { timeout });
    const stat = fs.statSync(output);
    if (!stat.size) throw new Error('Signed AAB was created but is empty');
    const sha256 = hashFile(output);
    console.log(`✓ Signed AAB: ${output}`);
    console.log(`✓ Size: ${stat.size} bytes`);
    console.log(`✓ SHA-256: ${sha256}`);
    return { output, sizeBytes: stat.size, sha256, type: 'aab' };
  } catch (err) {
    if (fs.existsSync(output)) fs.rmSync(output, { force: true });
    throw err;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const [format, input, output] = process.argv.slice(2);
  if (!format || !input || !output) { usage(); process.exit(1); }
  try {
    if (format === 'apk') signApk(input, output);
    else if (format === 'aab') signAab(input, output);
    else throw new Error(`Unsupported signing format: ${format}`);
  } catch (err) {
    console.error(`Signing engine error: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { validateSigningConfig, findBuildToolsDir, decodeKeystore, signApk, signAab, compareVersions, hashFile };
