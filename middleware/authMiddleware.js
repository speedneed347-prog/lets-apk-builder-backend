const jwt = require("jsonwebtoken");

/**
 * Optional JWT auth. Set JWT_ENABLED=true to require tokens on protected routes.
 * Public endpoints (POST /api/build, GET /api/build/:id, webhook) remain open.
 */
function optionalAuth(req, _res, next) {
  if (process.env.JWT_ENABLED !== "true") return next();
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return next();
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    /* ignore invalid — treated as anonymous */
  }
  next();
}

function requireAuth(req, res, next) {
  if (process.env.JWT_ENABLED !== "true") return next();
  if (!req.user) return res.status(401).json({ error: "Authentication required" });
  next();
}

module.exports = { optionalAuth, requireAuth };
