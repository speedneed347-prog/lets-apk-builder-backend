const { verifyCredentials, issueToken } = require("../services/adminService");
const logger = require("../utils/logger");

async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    if (!verifyCredentials(email, password)) {
      logger.warn("admin login failed", req.ip, email);
      // Small delay to slow brute-force
      await new Promise(r => setTimeout(r, 400));
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = issueToken(email);
    logger.info("admin login success", email);

    res.json({
      token,
      user: { email, role: "admin" },
    });
  } catch (err) { next(err); }
}

async function me(req, res) {
  res.json({
    user: { email: req.admin.sub, role: "admin" },
  });
}

module.exports = { login, me };
