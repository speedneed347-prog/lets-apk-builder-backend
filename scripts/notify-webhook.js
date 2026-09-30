#!/usr/bin/env node
const crypto = require("crypto");

const status = process.argv[2] || "building";
const errorMsg = process.argv[3] || undefined;

const BUILD_ID = process.env.BUILD_ID;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const SECRET = process.env.WEBHOOK_SECRET;
const APK_URL = process.env.APK_URL;
const ARTIFACT_URL = process.env.ARTIFACT_URL;
const ARTIFACT_TYPE = process.env.ARTIFACT_TYPE;
const LOG_LINE = process.env.LOG_LINE;
const ARTIFACT_FILENAME = process.env.ARTIFACT_FILENAME;
const ARTIFACT_SHA256 = process.env.ARTIFACT_SHA256;
const ARTIFACT_SIZE_BYTES = process.env.ARTIFACT_SIZE_BYTES;

if (!BUILD_ID || !WEBHOOK_URL || !SECRET) {
  console.error("Missing BUILD_ID, WEBHOOK_URL or WEBHOOK_SECRET");
  process.exit(1);
}

const body = {
  buildId: BUILD_ID,
  status,
  eventId: process.env.EVENT_ID || crypto.randomUUID(),
  timestamp: new Date().toISOString(),
};
if (APK_URL) body.apkUrl = APK_URL;
if (ARTIFACT_URL) body.artifactUrl = ARTIFACT_URL;
if (ARTIFACT_TYPE) body.artifactType = ARTIFACT_TYPE;
if (ARTIFACT_FILENAME) body.artifactFileName = ARTIFACT_FILENAME;
if (ARTIFACT_SHA256) body.artifactSha256 = ARTIFACT_SHA256;
if (ARTIFACT_SIZE_BYTES) body.artifactSizeBytes = Number(ARTIFACT_SIZE_BYTES);
if (errorMsg) body.error = errorMsg;
if (LOG_LINE) body.logLine = LOG_LINE.slice(0, 1000);

const payload = JSON.stringify(body);
const sig = "sha256=" + crypto.createHmac("sha256", SECRET).update(payload).digest("hex");

(async () => {
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sig },
      body: payload,
    });
    console.log("Webhook sent", status, res.status);
    if (!res.ok) process.exit(1);
  } catch (e) {
    console.error("Webhook error:", e.message);
    process.exit(1);
  }
})();
