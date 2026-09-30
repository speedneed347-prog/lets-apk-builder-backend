'use strict';

const assert = require('assert');
const { isAllowedTransition, isTerminal, CONTRACT_VERSION } = require('./buildIntegrationContract');

assert.strictEqual(CONTRACT_VERSION, 1);
assert.strictEqual(isAllowedTransition('queued', 'building'), true);
assert.strictEqual(isAllowedTransition('building', 'signing'), true);
assert.strictEqual(isAllowedTransition('signing', 'uploading'), true);
assert.strictEqual(isAllowedTransition('uploading', 'completed'), true);
assert.strictEqual(isAllowedTransition('completed', 'building'), false);
assert.strictEqual(isAllowedTransition('failed', 'uploading'), false);
assert.strictEqual(isTerminal('completed'), true);
assert.strictEqual(isTerminal('failed'), true);
assert.strictEqual(isTerminal('building'), false);
console.log('build integration contract tests: OK');
