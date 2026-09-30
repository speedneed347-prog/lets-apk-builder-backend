const { verifyToken } = require("../services/adminService");
const logger = require("../utils/logger");

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Admin authentication required" });
  }

  const payload = verifyToken(token);
  if (!payload) {
    logger.warn("admin auth failed", req.ip);
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  req.admin = payload;
  next();
}

/**
 * Optional admin — sets req.admin if valid token present, else continues.
 */
function optionalAdmin(req, _res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (token) {
    const payload = verifyToken(token);
    if (payload) req.admin = payload;
  }
  next();
}

module.exports = { requireAdmin, optionalAdmin };
