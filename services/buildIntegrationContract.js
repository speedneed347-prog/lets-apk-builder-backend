'use strict';

const CONTRACT_VERSION = 1;
const TERMINAL = new Set(['completed', 'failed']);
const TRANSITIONS = new Map([
  ['queued', new Set(['queued', 'building', 'failed'])],
  ['building', new Set(['building', 'signing', 'uploading', 'completed', 'failed'])],
  ['signing', new Set(['signing', 'uploading', 'completed', 'failed'])],
  ['uploading', new Set(['uploading', 'completed', 'failed'])],
  ['completed', new Set(['completed'])],
  ['failed', new Set(['failed'])],
]);

function isTerminal(status) {
  return TERMINAL.has(status);
}

function isAllowedTransition(from, to) {
  return !!TRANSITIONS.get(from || 'queued')?.has(to);
}

module.exports = { CONTRACT_VERSION, TERMINAL, TRANSITIONS, isTerminal, isAllowedTransition };
