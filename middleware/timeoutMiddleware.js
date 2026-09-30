function requestTimeout(ms) {
  const timeoutMs = Math.max(1000, Number(ms) || 30000);
  return (req, res, next) => {
    if (req.path.includes('/stream')) return next();
    res.setTimeout(timeoutMs, () => {
      if (!res.headersSent) res.status(408).json({ error: 'Request timeout', requestId: req.requestId });
      else res.destroy();
    });
    next();
  };
}

module.exports = { requestTimeout };
