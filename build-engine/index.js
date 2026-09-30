'use strict';

const { loadModule } = require('./modules/module-loader');
const { validateMetadata } = require('./modules/module-schema');
const { TARGETS, build, findArtifacts } = require('./gradle-builder');
const { validateSigningConfig, findBuildToolsDir, decodeKeystore, signApk, signAab } = require('./signing/signing-manager');
const { FORMATS, normalizeFormat, readConfig, selectArtifact, buildRelease } = require('./build-pipeline');

module.exports = {
  loadModule,
  validateMetadata,
  TARGETS,
  build,
  findArtifacts,
  validateSigningConfig,
  findBuildToolsDir,
  decodeKeystore,
  signApk,
  signAab,
  FORMATS,
  normalizeFormat,
  readConfig,
  selectArtifact,
  buildRelease,
};
