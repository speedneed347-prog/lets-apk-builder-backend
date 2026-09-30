'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  validateSigningConfig,
  findBuildToolsDir,
  decodeKeystore,
  compareVersions,
  signApk,
  signAab,
} = require('./signing-manager');

assert.throws(() => validateSigningConfig({}), /Missing signing configuration/);
assert.strictEqual(validateSigningConfig({
  KEYSTORE_BASE64: 'aA==',
  KEYSTORE_PASSWORD: 'ks-pass',
  KEY_PASSWORD: 'key-pass',
  KEY_ALIAS: 'release',
}), true);

assert(compareVersions('35.0.0', '34.0.0') > 0);
assert(compareVersions('34.0.0', '34.0.0') === 0);
assert(compareVersions('33.0.0', '34.0.0') < 0);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lets-sign-test-'));
try {
  const bt = path.join(root, '34.0.0');
  fs.mkdirSync(bt, { recursive: true });
  fs.writeFileSync(path.join(bt, 'zipalign'), '');
  fs.writeFileSync(path.join(bt, 'apksigner'), '');
  assert.strictEqual(findBuildToolsDir({ ANDROID_BUILD_TOOLS_DIR: bt }), bt);

  const keystore = path.join(root, 'test.jks');
  const bytes = decodeKeystore(Buffer.from('test-keystore').toString('base64'), keystore);
  assert.strictEqual(bytes, Buffer.byteLength('test-keystore'));
  assert.strictEqual(fs.readFileSync(keystore, 'utf8'), 'test-keystore');

  assert.throws(
    () => decodeKeystore('%%%not-base64%%%', path.join(root, 'bad.jks')),
    /valid base64/
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}



// End-to-end command wiring test with fake Android build-tools.
const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lets-sign-e2e-'));
try {
  const bt = path.join(fakeRoot, '34.0.0');
  fs.mkdirSync(bt, { recursive: true });
  const zipalign = path.join(bt, 'zipalign');
  const apksigner = path.join(bt, 'apksigner');
  fs.writeFileSync(zipalign, `#!/bin/sh
cp "$4" "$5"
`);
  fs.writeFileSync(apksigner, `#!/bin/sh
if [ "$1" = "sign" ]; then
  shift
  out=""
  input=""
  while [ "$1" != "" ]; do
    if [ "$1" = "--out" ]; then shift; out="$1"; fi
    shift
  done
  input="$(find "$(dirname "$out")/../.." -name aligned.apk 2>/dev/null | head -n1)"
  cp "$input" "$out"
  exit 0
fi
if [ "$1" = "verify" ]; then exit 0; fi
exit 1
`);
  fs.chmodSync(zipalign, 0o755);
  fs.chmodSync(apksigner, 0o755);

  const input = path.join(fakeRoot, 'unsigned.apk');
  const output = path.join(fakeRoot, 'signed.apk');
  fs.writeFileSync(input, 'fake-apk');
  const result = signApk(input, output, {
    buildToolsDir: bt,
    env: {
      KEYSTORE_BASE64: Buffer.from('fake-keystore').toString('base64'),
      KEYSTORE_PASSWORD: 'secret-ks',
      KEY_PASSWORD: 'secret-key',
      KEY_ALIAS: 'release',
      SIGNING_TIMEOUT_MS: '10000',
    },
  });
  assert.strictEqual(fs.readFileSync(output, 'utf8'), 'fake-apk');
  assert.strictEqual(result.sizeBytes, 8);
  assert.strictEqual(result.sha256.length, 64);
  assert(fs.existsSync(output));
} finally {
  fs.rmSync(fakeRoot, { recursive: true, force: true });
}

// End-to-end AAB signing command wiring with a fake jarsigner.
const aabRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lets-aab-e2e-'));
try {
  const jarsigner = path.join(aabRoot, 'jarsigner');
  fs.writeFileSync(jarsigner, `#!/bin/sh
if [ "$1" = "-keystore" ]; then
  out=""
  input=""
  while [ "$1" != "" ]; do
    if [ "$1" = "-signedjar" ]; then shift; out="$1"; fi
    shift
  done
  input="$(find "$(dirname "$out")/../.." -name unsigned.aab 2>/dev/null | head -n1)"
  cp "$input" "$out"
  exit 0
fi
if [ "$1" = "-verify" ]; then exit 0; fi
exit 1
`);
  fs.chmodSync(jarsigner, 0o755);
  const input = path.join(aabRoot, 'unsigned.aab');
  const output = path.join(aabRoot, 'signed.aab');
  fs.writeFileSync(input, 'fake-aab');
  const result = signAab(input, output, {
    env: {
      KEYSTORE_BASE64: Buffer.from('fake-keystore').toString('base64'),
      KEYSTORE_PASSWORD: 'secret-ks',
      KEY_PASSWORD: 'secret-key',
      KEY_ALIAS: 'release',
      JARSIGNER_BIN: jarsigner,
      SIGNING_TIMEOUT_MS: '10000',
    },
  });
  assert.strictEqual(fs.readFileSync(output, 'utf8'), 'fake-aab');
  assert.strictEqual(result.type, 'aab');
  assert.strictEqual(result.sha256.length, 64);
} finally {
  fs.rmSync(aabRoot, { recursive: true, force: true });
}


console.log('signing engine tests: OK');
