const fetch = require("node-fetch");
const logger = require("../utils/logger");

/**
 * Triggers the GitHub Actions workflow with minimal inputs.
 * The worker fetches full config from backend via /api/internal/config/:buildId
 * This avoids the 65 KB input size limit of workflow_dispatch.
 */
async function triggerBuildWorkflow(buildId, config) {
  const repo = process.env.GITHUB_REPO;
  const workflow = process.env.GITHUB_WORKFLOW_FILE || "build-apk.yml";
  const ref = process.env.GITHUB_REF || "main";
  const token = process.env.GITHUB_TOKEN;
  const publicUrl = process.env.PUBLIC_URL;

  if (!repo || !token || !publicUrl) {
    throw new Error(
      "GitHub integration not configured (GITHUB_REPO / GITHUB_TOKEN / PUBLIC_URL)"
    );
  }

  const url = `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`;

  // ⚡ Only send tiny inputs — worker fetches full config from backend
  const body = {
    ref,
    inputs: {
      buildId,
      webhookUrl: `${publicUrl}/api/webhook/github`,
    },
  };

  logger.info("Dispatching workflow", { buildId, repo, workflow, ref });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "lets-apk-builder-backend",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.error("GitHub dispatch failed", res.status, text);
    throw new Error(`GitHub trigger failed: ${res.status} ${text}`);
  }

  logger.info("GitHub workflow dispatched", buildId);
}

module.exports = { triggerBuildWorkflow };
