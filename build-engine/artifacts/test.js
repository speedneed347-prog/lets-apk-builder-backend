'use strict';
const assert = require('assert');
const { safeName } = require('./artifact-manager');
assert.strictEqual(safeName('My App v1!'), 'My-App-v1');
assert.strictEqual(safeName(''), 'app');
console.log('artifact manager tests: OK');
