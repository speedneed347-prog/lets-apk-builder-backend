#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const required = [
  'server.js',
  'package.json',
  '.github/workflows/build-apk.yml',
  'build-engine/generate-project.js',
  'build-engine/build-pipeline.js',
  'services/buildQueueService.js',
  'services/buildIntegrationService.js',
  'services/webhookEventService.js',
  'platform/contract.json',
];

const missing = required.filter((p) => !fs.existsSync(path.join(root, p)));
if (missing.length) {
  console.error('Preflight failed. Missing:', missing.join(', '));
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const contract = JSON.parse(fs.readFileSync(path.join(root, 'platform/contract.json'), 'utf8'));

if (!pkg.dependencies || !pkg.dependencies.express || !pkg.dependencies['firebase-admin']) {
  throw new Error('Core production dependencies are missing');
}
if (contract.contractVersion !== 1 || contract.apiVersion !== 1) {
  throw new Error('Unsupported platform contract version');
}

console.log('platform preflight: OK');
console.log(`package: ${pkg.name}@${pkg.version}`);
console.log(`contract: api=${contract.apiVersion}, contract=${contract.contractVersion}`);
console.log(`outputs: ${contract.supportedBuildFormats.join(', ')}`);
