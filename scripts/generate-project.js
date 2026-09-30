#!/usr/bin/env node
/**
 * Backward-compatible entry point.
 *
 * The Android project generator now lives in build-engine/ so that
 * all APK/AAB build logic can be progressively centralized there.
 */
require("../build-engine/generate-project.js");
