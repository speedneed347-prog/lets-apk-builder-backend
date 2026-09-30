const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/webhook.controller");
const { webhookLimiter } = require("../middleware/webhookRateLimit");

router.post("/github", webhookLimiter, ctrl.githubWebhook);

module.exports = router;
