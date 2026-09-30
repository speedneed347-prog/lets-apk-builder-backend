const jwt = require("jsonwebtoken");
const crypto = require("crypto");

/**
 * Timing-safe string comparison to prevent timing attacks
 */
function timingSafeEqual(a, b) {
  const aBuf = Buffer.from(String(a));
  const bBuf = Buffer.from(String(b));
  if (aBuf.length !== bBuf.length) {
    // Still do a comparison to keep timing consistent
    crypto.timingSafeEqual(Buffer.alloc(aBuf.length), Buffer.alloc(aBuf.length));
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function verifyCredentials(email, password) {
  const adminEmail = process.env.ADMIN_EMAIL || "";
  const adminPassword = process.env.ADMIN_PASSWORD || "";

  if (!adminEmail || !adminPassword) {
    return false;
  }

  const emailOk = timingSafeEqual(email, adminEmail);
  const passOk = timingSafeEqual(password, adminPassword);

  return emailOk && passOk;
}

function issueToken(email) {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret) throw new Error("ADMIN_JWT_SECRET not configured");

  const expiresIn = process.env.ADMIN_JWT_EXPIRES_IN || "7d";
  return jwt.sign(
    { sub: email, role: "admin" },
    secret,
    { expiresIn }
  );
}

function verifyToken(token) {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret) return null;
  try {
    const payload = jwt.verify(token, secret);
    if (payload.role !== "admin") return null;
    return payload;
  } catch {
    return null;
  }
}

module.exports = { verifyCredentials, issueToken, verifyToken };
