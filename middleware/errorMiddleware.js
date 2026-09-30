const logger = require("../utils/logger");

function notFound(req, res) {
  res.status(404).json({ error: "Not found", path: req.originalUrl, requestId: req.requestId });
}

function errorHandler(err, req, res, _next) {
  const status = err.status || 500;
  if (status >= 500) logger.error(err.stack || err.message);
  res.status(status).json({
    error: err.message || "Internal server error",
    field: err.field || undefined,
    requestId: req.requestId,
  });
}

module.exports = { notFound, errorHandler };
