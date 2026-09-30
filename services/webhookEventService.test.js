const assert = require('assert');
const { normalizeEventId } = require('./webhookEventService');

assert.strictEqual(normalizeEventId('run-123-signing'), 'run-123-signing');
assert.strictEqual(normalizeEventId(''), null);
assert.strictEqual(normalizeEventId('bad id'), null);
assert.strictEqual(normalizeEventId('a'.repeat(129)), null);
console.log('webhook event tests: OK');
