#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { TARGETS } = require('./gradle-builder');

assert.strictEqual(TARGETS['debug-apk'], 'assembleDebug');
assert.strictEqual(TARGETS['release-apk'], 'assembleRelease');
assert.strictEqual(TARGETS['release-aab'], 'bundleRelease');
assert.strictEqual(Object.keys(TARGETS).length, 3);
console.log('build-engine tests: OK');
