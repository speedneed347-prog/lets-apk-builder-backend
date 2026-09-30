const crypto = require("crypto");

function nowIso() { return new Date().toISOString(); }

function verifyHmac(secret, payload, signatureHeader) {
  if (!secret || !signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const provided = signatureHeader.slice("sha256=".length);
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  const a = Buffer.from(provided, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function isFreshTimestamp(isoString, maxAgeMs = 5 * 60 * 1000) {
  if (!isoString) return true;
  const t = Date.parse(isoString);
  if (Number.isNaN(t)) return false;
  return Math.abs(Date.now() - t) <= maxAgeMs;
}

module.exports = { nowIso, verifyHmac, isFreshTimestamp };
