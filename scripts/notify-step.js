#!/usr/bin/env node
const crypto = require("crypto");

const BUILD_ID = process.env.BUILD_ID;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const SECRET = process.env.WEBHOOK_SECRET;
const STEP_NAME = process.env.STEP_NAME;
const STEP_INDEX = Number(process.env.STEP_INDEX || 0);
const STATUS = process.env.STATUS || "building";

if (!BUILD_ID || !WEBHOOK_URL || !SECRET || !STEP_NAME) {
  console.error("Missing env vars");
  process.exit(1);
}

const body = {
  buildId: BUILD_ID,
  status: STATUS,
  eventId: process.env.EVENT_ID || crypto.randomUUID(),
  currentStep: STEP_NAME,
  stepIndex: STEP_INDEX,
  logLine: `[${new Date().toISOString()}] ${STEP_NAME}`,
  timestamp: new Date().toISOString(),
};

const payload = JSON.stringify(body);
const sig = "sha256=" + crypto.createHmac("sha256", SECRET).update(payload).digest("hex");

(async () => {
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sig },
      body: payload,
    });
    console.log(`Step ${STEP_INDEX}: ${STEP_NAME} → ${res.status}`);
  } catch (e) {
    console.error("Webhook exception:", e.message);
  }
})();
