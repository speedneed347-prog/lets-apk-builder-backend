const PACKAGE_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// Java/Kotlin reserved words — a package segment like "com.example.in" breaks compilation.
const RESERVED_WORDS = new Set([
  "abstract","assert","boolean","break","byte","case","catch","char","class","const","continue",
  "default","do","double","else","enum","extends","final","finally","float","for","goto","if",
  "implements","import","instanceof","int","interface","long","native","new","package","private",
  "protected","public","return","short","static","strictfp","super","switch","synchronized","this",
  "throw","throws","transient","try","void","volatile","while","true","false","null",
  "fun","val","var","when","object","is","in","as","typealias","typeof",
]);

class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = "ValidationError";
    this.status = 400;
    this.field = field;
  }
}

function assert(cond, message, field) {
  if (!cond) throw new ValidationError(message, field);
}

const PERMISSION_KEYS = [
  "enableJs", "enableNetworkState",
  "enableCamera", "enableMicrophone", "enableAudioSettings", "enableFileUpload",
  "enableGeolocation", "enableCoarseLocation", "enableBackgroundLocation",
  "enableReadMediaImages", "enableReadMediaVideo", "enableReadMediaAudio", "enableStorage",
  "enableBluetooth", "enableBluetoothLegacy", "enableNfc", "enableNearbyWifi",
  "enableWifi", "enableChangeWifi", "enableChangeNetwork",
  "enableVibration", "enableWakeLock", "enableFlashlight", "enableBodySensors", "enableActivityRecognition",
  "enableReadPhoneState", "enableCallPhone", "enableReadContacts", "enableWriteContacts", "enableGetAccounts",
  "enableSendSms", "enableReceiveSms", "enableReadSms",
  "enableReadCalendar", "enableWriteCalendar",
  "enableNotifications", "enableForegroundService", "enableBootCompleted", "enableInstallShortcut",
  "enableSystemAlertWindow", "enableInstallPackages",
  "enableBiometric", "enableFingerprint",
];

// ═══════════════════════════════════════════════════════════════
// MODULE VALIDATION
// ═══════════════════════════════════════════════════════════════
const ALLOWED_MODULE_IDS = /^[a-z0-9][a-z0-9-]{1,40}$/;
const MAX_MODULES = 10;
const MAX_MODULE_BYTES = 5 * 1024 * 1024;
const MAX_OFFLINE_ZIP_BYTES = 3 * 1024 * 1024;

function validateModules(modules) {
  if (!Array.isArray(modules) || modules.length === 0) return [];

  assert(modules.length <= MAX_MODULES, `Max ${MAX_MODULES} modules allowed`, "modules");

  const validated = [];
  for (const mod of modules) {
    assert(mod && typeof mod === "object", "invalid module", "modules");
    assert(ALLOWED_MODULE_IDS.test(mod.id), `invalid module id: ${mod.id}`, "modules");
    if (!mod.base64) continue;

    const raw = String(mod.base64);
    const dm = raw.match(/^data:[^;]+;base64,(.+)$/);
    const b64 = dm ? dm[1] : raw;

    assert(/^[A-Za-z0-9+/=\s]+$/.test(b64), `module ${mod.id}: invalid base64`, "modules");
    const normalized = b64.replace(/\s+/g, "");
    const decodedBytes = Math.floor((normalized.length * 3) / 4) - (normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0);
    assert(decodedBytes <= MAX_MODULE_BYTES, `module ${mod.id} too large (max 5 MB)`, "modules");

    validated.push({
      id: mod.id,
      name: String(mod.name || "module.zip").slice(0, 80),
      isMain: !!mod.isMain,
      base64: normalized,
      size: decodedBytes,
    });
  }

  const mains = validated.filter(m => m.isMain);
  if (validated.length > 0 && mains.length === 0) {
    validated[0].isMain = true;
  }
  if (mains.length > 1) {
    let first = true;
    validated.forEach(m => {
      if (m.isMain) {
        if (first) first = false;
        else m.isMain = false;
      }
    });
  }

  return validated;
}

function validateCommonModules(commonModules) {
  if (!Array.isArray(commonModules)) return [];
  return commonModules
    .filter(id => typeof id === "string" && id.length > 0 && id.length < 60)
    .filter(id => /^[a-z0-9-]+$/.test(id))
    .slice(0, 20);
}

// ═══════════════════════════════════════════════════════════════
// MAIN CONFIG VALIDATOR
// ═══════════════════════════════════════════════════════════════
function validateConfig(body) {
  assert(body && typeof body === "object", "Missing request body");

  // ─── App type ───
  const appType = String(body.appType || "webview");
  assert(
    ["webview", "file-share"].includes(appType),
    "appType must be webview|file-share",
    "appType"
  );

  // ─── Build format ───
  const buildFormat = String(body.buildFormat || body.outputFormat || "apk").toLowerCase();
  assert(
    ["apk", "aab"].includes(buildFormat),
    "buildFormat must be apk|aab",
    "buildFormat"
  );

  // ─── App mode (now includes "native") ───
  const appMode = String(body.appMode || "hybrid");
  assert(
    ["offline", "online", "hybrid", "native"].includes(appMode),
    "appMode must be offline|online|hybrid|native",
    "appMode"
  );

  const appName = String(body.appName || "").trim();
  assert(appName.length >= 1 && appName.length <= 50, "appName must be 1-50 chars", "appName");

  // ─── Website URL ───
  let websiteUrl = String(body.websiteUrl || "").trim();
  if (appMode === "offline" || appMode === "native") {
    // No real URL needed — placeholder for Firestore
    websiteUrl = websiteUrl || "https://example.com";
  } else {
    assert(websiteUrl.length > 0, "websiteUrl is required", "websiteUrl");
    let parsedUrl;
    try { parsedUrl = new URL(websiteUrl); }
    catch { throw new ValidationError("websiteUrl is not a valid URL", "websiteUrl"); }
    assert(parsedUrl.protocol === "https:", "websiteUrl must use https://", "websiteUrl");
  }

  const packageName = String(body.packageName || "").trim();
  assert(PACKAGE_RE.test(packageName), "packageName must match com.example.app", "packageName");
  assert(packageName.length <= 100, "packageName too long", "packageName");
  const badSegment = packageName.split(".").find((seg) => RESERVED_WORDS.has(seg));
  assert(!badSegment, `packageName segment "${badSegment}" is a reserved Java/Kotlin word`, "packageName");

  const versionName = String(body.versionName || "1.0.0").trim();
  assert(SEMVER_RE.test(versionName), "versionName must be semver (e.g. 1.0.0)", "versionName");

  const versionCode = Number(body.versionCode ?? 1);
  assert(
    Number.isInteger(versionCode) && versionCode >= 1 && versionCode <= 2100000000,
    "versionCode must be a positive integer",
    "versionCode"
  );

  let themeColor = String(body.themeColor || "#1f6feb").trim();
  assert(HEX_COLOR_RE.test(themeColor), "themeColor must be a hex color", "themeColor");
  // Expand #abc -> #aabbcc (icon generator only understands 6-digit hex)
  if (themeColor.length === 4) {
    themeColor = "#" + themeColor.slice(1).split("").map((c) => c + c).join("");
  }
  themeColor = themeColor.toLowerCase();

  let iconBase64 = body.iconBase64 ? String(body.iconBase64) : null;
  if (iconBase64) {
    const m = iconBase64.match(/^data:image\/png;base64,(.+)$/);
    assert(m, "iconBase64 must be a PNG data URL", "iconBase64");
    assert(m[1].length <= 700_000, "Icon must be ≤ 500 KB", "iconBase64");
  }

  // ─── Offline ZIP ───
  let offlineZipBase64 = null;
  let offlineZipName = null;
  let offlineZipSize = 0;

  if (body.offlineZipBase64) {
    const raw = String(body.offlineZipBase64);
    const dm = raw.match(/^data:[^;]+;base64,(.+)$/);
    const b64 = dm ? dm[1] : raw;

    assert(/^[A-Za-z0-9+/=\s]+$/.test(b64), "offlineZipBase64: invalid characters", "offlineZipBase64");
    offlineZipBase64 = b64.replace(/\s+/g, "");
    offlineZipSize = Math.floor((offlineZipBase64.length * 3) / 4) - (offlineZipBase64.endsWith("==") ? 2 : offlineZipBase64.endsWith("=") ? 1 : 0);
    assert(offlineZipSize <= MAX_OFFLINE_ZIP_BYTES, "Offline ZIP must be ≤ 3 MB", "offlineZipBase64");
    offlineZipName = String(body.offlineZipName || "site.zip").slice(0, 80);
  }

  // Offline mode REQUIRES ZIP (only for webview app type, NOT native)
  if (appType === "webview" && appMode === "offline") {
    assert(offlineZipBase64, "Offline mode requires an offline ZIP bundle", "offlineZipBase64");
  }

  // ─── Custom modules ───
  const modules = validateModules(body.modules || []);

  // ⭐ Native mode REQUIRES at least one custom module
  if (appMode === "native") {
    assert(
      modules.length > 0,
      "Native mode requires at least one custom module (upload ZIP or write code)",
      "modules"
    );
  }

  // ─── Common modules ───
  const commonModules = validateCommonModules(body.commonModules || []);

  const orientation = String(body.orientation || "portrait");
  assert(
    ["portrait", "landscape", "auto"].includes(orientation),
    "orientation must be portrait|landscape|auto",
    "orientation"
  );

  // ─── Build config ───
  const config = {
    appType,
    appMode,
    buildFormat,
    appName, websiteUrl, packageName, versionName, versionCode,
    themeColor, iconBase64, orientation,
    hasOfflineZip: !!offlineZipBase64,
    offlineZipName,
    offlineZipSize,
    offlineZipBase64,
    modules,
    modulesCount: modules.length,
    commonModules,
  };

  for (const key of PERMISSION_KEYS) {
    config[key] = typeof body[key] === "boolean" ? body[key] : false;
  }
  if (body.enableJs === undefined) config.enableJs = true;
  if (body.enableFileUpload === undefined) config.enableFileUpload = true;
  if (body.enableNetworkState === undefined) config.enableNetworkState = true;

  const serialized = JSON.stringify(config);
  assert(serialized.length <= 15_000_000, "Config too large (max 15 MB)", "body");

  return config;
}

module.exports = { validateConfig, ValidationError, PERMISSION_KEYS };
