#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const artifactPath = process.argv[2];
const buildId = process.argv[3];
const artifactType = (process.argv[4] || path.extname(artifactPath || '').slice(1) || 'apk').toLowerCase();

if (!artifactPath || !buildId) {
  console.error('Usage: upload-to-github-release.js <artifactPath> <buildId> [apk|aab]');
  process.exit(1);
}
if (!['apk', 'aab'].includes(artifactType)) {
  console.error(`Unsupported artifact type: ${artifactType}`);
  process.exit(1);
}
if (!fs.existsSync(artifactPath)) {
  console.error(`Artifact file not found: ${artifactPath}`);
  process.exit(1);
}

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
const api = process.env.GH_API_URL || 'https://api.github.com';
if (!token || !repo) {
  console.error('Missing GITHUB_TOKEN or GITHUB_REPOSITORY');
  process.exit(1);
}

const assetName = path.basename(artifactPath);
const tag = `build-${buildId}`;
const releaseName = `Build ${buildId.slice(0, 8)}`;
const mime = artifactType === 'aab' ? 'application/octet-stream' : 'application/vnd.android.package-archive';

(async () => {
  const createRes = await fetch(`${api}/repos/${repo}/releases`, {
    method: 'POST',
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'lets-apk-builder',
    },
    body: JSON.stringify({
      tag_name: tag,
      name: releaseName,
      body: `${artifactType.toUpperCase()} for build \`${buildId}\`.`,
      draft: false,
      prerelease: false,
    }),
  });
  if (!createRes.ok) {
    const t = await createRes.text();
    console.error('Release create failed:', createRes.status, t);
    process.exit(1);
  }
  const release = await createRes.json();
  console.log('Release created:', release.html_url);

  const uploadUrl = `https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(assetName)}`;
  const fileBuffer = fs.readFileSync(artifactPath);
  const sizeMB = (fileBuffer.length / 1024 / 1024).toFixed(2);
  console.log(`Uploading ${assetName} (${sizeMB} MB)...`);
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `token ${token}`,
      'Content-Type': mime,
      'Content-Length': String(fileBuffer.length),
      'User-Agent': 'lets-apk-builder',
    },
    body: fileBuffer,
  });
  if (!uploadRes.ok) {
    const t = await uploadRes.text();
    console.error('Asset upload failed:', uploadRes.status, t);
    process.exit(1);
  }
  const asset = await uploadRes.json();
  console.log(`✓ Uploaded ${artifactType.toUpperCase()}:`, asset.browser_download_url);
  console.log(asset.browser_download_url);
})().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
