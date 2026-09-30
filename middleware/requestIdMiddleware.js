const crypto = require('crypto');

function requestId(req, res, next) {
  const incoming = String(req.headers['x-request-id'] || '').trim();
  const id = /^[A-Za-z0-9._:-]{8,100}$/.test(incoming) ? incoming : crypto.randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}

module.exports = { requestId };
