const assert = require('assert');
const { requireInternalSecret } = require('./internalAuthMiddleware');

const old = process.env.INTERNAL_API_SECRET;
process.env.INTERNAL_API_SECRET = 'secret-1234567890';

function run(value) {
  const req = { headers: { 'x-internal-secret': value } };
  let statusCode = 200;
  let body = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(v) { body = v; return this; },
  };
  let nextCalled = false;
  requireInternalSecret(req, res, () => { nextCalled = true; });
  return { statusCode, body, nextCalled };
}

assert.equal(run('secret-1234567890').nextCalled, true);
assert.equal(run('wrong').statusCode, 401);
assert.equal(run('').statusCode, 401);

if (old === undefined) delete process.env.INTERNAL_API_SECRET;
else process.env.INTERNAL_API_SECRET = old;
console.log('internal auth tests: OK');
