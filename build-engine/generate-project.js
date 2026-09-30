#!/usr/bin/env node
/**
 * Generates a complete Android project from config.json.
 *
 * Readsd module-flags.json (written by install-custom-modules.js scan) and:
 *   - Merges module deps into app/build.gradle
 *   - Merges module manifest fragments into AndroidManifest.xml
 *   - Skips default MainActivity if native mode or a custom module overrides it
 *   - Generates adaptive icons for Android 8+
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const configPath = process.argv || "config.json";
if (!fs.existsSync(configPath)) {
  console.error(`Config file not found at: ${configPath}`);
  process.exit(1);
}

const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));

// ─── SAFE CONFIG DEFAULTS ───
cfg.packageName = (cfg.packageName || "com.example.myapp").trim();
cfg.appName = cfg.appName || "My App";
cfg.versionCode = parseInt(cfg.versionCode, 10) || 1;
cfg.versionName = cfg.versionName || "1.0.0";
cfg.appMode = cfg.appMode || "hybrid";
cfg.websiteUrl = cfg.websiteUrl || "https://example.com";

// Safe Theme Color (Ensures leading '#' exists and prevents crashes)
const themeColor = (cfg.themeColor && String(cfg.themeColor).trim().startsWith("#"))
  ? String(cfg.themeColor).trim()
  : (cfg.themeColor ? `#${String(cfg.themeColor).trim()}` : "#1f6feb");

const ROOT = path.resolve("android-project");
const pkgPath = cfg.packageName.split(".").join("/");
const javaDir = path.join(ROOT, "app/src/main/java", pkgPath);
const resDir = path.join(ROOT, "app/src/main/res");
const assetsDir = path.join(ROOT, "app/src/main/assets");

// ═══════════════════════════════════════════════════════════════
// LOAD MODULE FLAGS
// ═══════════════════════════════════════════════════════════════
let moduleFlags = {
  overrideMainActivity: false,
  modules: [],
  allDeps: [],
  rootManifest: [],
  appManifest: [],
};

try {
  const flagsPath = path.join(process.cwd(), "module-flags.json");
  if (fs.existsSync(flagsPath)) {
    moduleFlags = JSON.parse(fs.readFileSync(flagsPath, "utf8"));
    console.log("✓ Loaded module-flags.json");
    console.log("  overrideMainActivity:", moduleFlags.overrideMainActivity);
    console.log("  deps:", (moduleFlags.allDeps || []).length);
    console.log("  root manifest:", (moduleFlags.rootManifest || []).length);
    console.log("  app manifest:", (moduleFlags.appManifest || []).length);
  } else {
    console.log("No module-flags.json — using defaults");
  }
} catch (e) {
  console.warn("Failed to read module-flags.json:", e.message);
}

const moduleDeps = moduleFlags.allDeps || [];
const moduleRootManifest = moduleFlags.rootManifest || [];
const moduleAppManifest = moduleFlags.appManifest || [];
const moduleOverridesMainActivity = moduleFlags.overrideMainActivity === true;
const isNativeMode = cfg.appMode === "native";

// Check if a custom module provides its own MAIN/LAUNCHER intent filter
const moduleHasLauncherActivity = (moduleAppManifest || []).some((entry) =>
  /android\:name\s*=/.test(entry) &&
  /android\.intent\.action\.MAIN/.test(entry) &&
  /android\.intent\.category\.LAUNCHER/.test(entry)
);

// FIX: Native mode-এ অথবা Custom module থাকলে ডিফল্ট WebView MainActivity বাদ দেওয়া হবে
const skipDefaultMainActivity = isNativeMode || (moduleOverridesMainActivity && moduleHasLauncherActivity);

console.log("appMode:", cfg.appMode);
console.log("isNativeMode:", isNativeMode);
console.log("moduleOverridesMainActivity:", moduleOverridesMainActivity);
console.log("moduleHasLauncherActivity:", moduleHasLauncherActivity);
console.log("skipDefaultMainActivity:", skipDefaultMainActivity);

// Clean previous project build
fs.rmSync(ROOT, { recursive: true, force: true });

// Create required directories
for (const d of [
  javaDir,
  path.join(resDir, "values"),
  path.join(resDir, "xml"),
  path.join(resDir, "layout"),
  path.join(resDir, "drawable"),
  path.join(resDir, "mipmap-hdpi"),
  path.join(resDir, "mipmap-mdpi"),
  path.join(resDir, "mipmap-xhdpi"),
  path.join(resDir, "mipmap-xxhdpi"),
  path.join(resDir, "mipmap-xxxhdpi"),
  path.join(resDir, "mipmap-anydpi-v26"),
  assetsDir,
]) fs.mkdirSync(d, { recursive: true });

// ═══════════════════════════════════════════════════════════════
// OFFLINE ZIP EXTRACTION
// ═══════════════════════════════════════════════════════════════
const offlineZipB64Path = path.join(process.cwd(), "offline.zip.b64");
let hasOffline = false;

if (fs.existsSync(offlineZipB64Path)) {
  const b64 = fs.readFileSync(offlineZipB64Path, "utf8").trim();
  if (b64) {
    try {
      const zipBuffer = Buffer.from(b64, "base64");
      const zipPath = path.join(process.cwd(), "offline.zip");
      fs.writeFileSync(zipPath, zipBuffer);
      console.log("Extracting offline ZIP:", zipBuffer.length, "bytes");

      const tmpDir = path.join(process.cwd(), "offline-extracted");
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.mkdirSync(tmpDir, { recursive: true });

      execSync(`unzip -q -o "${zipPath}" -d "${tmpDir}"`, { stdio: "inherit" });
      fs.unlinkSync(zipPath);

      function findIndexHtml(dir, depth = 0) {
        if (depth > 6) return null;
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
        catch { return null; }
        for (const e of entries) {
          if (e.isFile() && e.name.toLowerCase() === "index.html") return dir;
        }
        for (const e of entries) {
          if (e.isDirectory() && e.name !== "__MACOSX" && !e.name.startsWith(".")) {
            const found = findIndexHtml(path.join(dir, e.name), depth + 1);
            if (found) return found;
          }
        }
        return null;
      }

      const indexDir = findIndexHtml(tmpDir);
      if (!indexDir) {
        console.warn("⚠ No index.html found in ZIP");
      } else {
        console.log("Found index.html at:", indexDir);
        function copyRecursive(src, dest) {
          const entries = fs.readdirSync(src, { withFileTypes: true });
          for (const e of entries) {
            const s = path.join(src, e.name);
            const d = path.join(dest, e.name);
            if (e.isDirectory()) {
              fs.mkdirSync(d, { recursive: true });
              copyRecursive(s, d);
            } else {
              fs.copyFileSync(s, d);
            }
          }
        }
        fs.rmSync(assetsDir, { recursive: true, force: true });
        fs.mkdirSync(assetsDir, { recursive: true });
        copyRecursive(indexDir, assetsDir);

        function cleanJunk(dir) {
          if (!fs.existsSync(dir)) return;
          for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.name === "__MACOSX" || e.name === ".DS_Store" || e.name.startsWith("._")) {
              if (e.isDirectory()) fs.rmSync(p, { recursive: true, force: true });
              else fs.unlinkSync(p);
            } else if (e.isDirectory()) cleanJunk(p);
          }
        }
        cleanJunk(assetsDir);

        if (fs.existsSync(path.join(assetsDir, "index.html"))) {
          hasOffline = true;
          console.log("✓ Offline assets extracted");
        }
      }
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {
      console.warn("Offline ZIP extraction failed:", e.message);
    }
  }
}
console.log("hasOffline:", hasOffline);

// ═══════════════════════════════════════════════════════════════
// Root build.gradle
// ═══════════════════════════════════════════════════════════════
fs.writeFileSync(path.join(ROOT, "build.gradle"),
`plugins {
  id 'com.android.application' version '8.5.2' apply false
  id 'org.jetbrains.kotlin.android' version '1.9.24' apply false
}
`);

// settings.gradle
fs.writeFileSync(path.join(ROOT, "settings.gradle"),
`pluginManagement {
  repositories { google(); mavenCentral(); gradlePluginPortal() }
}
dependencyResolutionManagement {
  repositoriesMode.set(RepositoriesMode.PREFER_SETTINGS)
  repositories { google(); mavenCentral() }
}
rootProject.name = "LetsApkBuilder"
include ':app'
`);

// gradle.properties
fs.writeFileSync(path.join(ROOT, "gradle.properties"),
`org.gradle.jvmargs=-Xmx3g -Dfile.encoding=UTF-8
android.useAndroidX=true
android.nonTransitiveRClass=true
kotlin.code.style=official
`);

// local.properties
const sdkDir = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || "/usr/local/lib/android/sdk";
fs.writeFileSync(path.join(ROOT, "local.properties"), `sdk.dir=${sdkDir}\n`);

// ═══════════════════════════════════════════════════════════════
// app/build.gradle — with module deps
// ═══════════════════════════════════════════════════════════════
const minSdk = 21;
const targetSdk = 34;

const moduleDepsBlock = moduleDeps.length > 0
  ? `\n\n  // ─── Module dependencies ───\n  ${moduleDeps.join("\n  ")}`
  : "";

fs.writeFileSync(path.join(ROOT, "app/build.gradle"),
`plugins {
  id 'com.android.application'
  id 'org.jetbrains.kotlin.android'
}

android {
  namespace '${cfg.packageName}'
  compileSdk ${targetSdk}

  defaultConfig {
    applicationId "${cfg.packageName}"
    minSdk ${minSdk}
    targetSdk ${targetSdk}
    versionCode ${cfg.versionCode}
    versionName "${cfg.versionName}"
  }

  buildTypes {
    release {
      minifyEnabled false
      crunchPngs false
      proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
    }
  }

  aaptOptions { cruncherEnabled = false }

  compileOptions {
    sourceCompatibility JavaVersion.VERSION_17
    targetCompatibility JavaVersion.VERSION_17
  }
  kotlinOptions { jvmTarget = '17' }
}

dependencies {
  implementation 'androidx.core:core-ktx:1.13.1'
  implementation 'androidx.appcompat:appcompat:1.7.0'
  implementation 'androidx.webkit:webkit:1.11.0'
  implementation 'com.google.android.material:material:1.12.0'${moduleDepsBlock}
}
`);

if (moduleDeps.length > 0) {
  console.log(`✓ Added ${moduleDeps.length} module deps to app/build.gradle`);
}

fs.writeFileSync(path.join(ROOT, "app/proguard-rules.pro"),
`-keep class ${cfg.packageName}.** { *; }
-dontwarn android.webkit.**
`);

// ═══════════════════════════════════════════════════════════════
// MANIFEST
// ═══════════════════════════════════════════════════════════════
const mp = [];
const mf = [];
const rp = [];

mp.push(`<uses-permission android:name="android.permission.INTERNET" />`);

if (cfg.enableNetworkState) mp.push(`<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />`);
if (cfg.enableChangeNetwork) mp.push(`<uses-permission android:name="android.permission.CHANGE_NETWORK_STATE" />`);

if (cfg.enableCamera) {
  mp.push(`<uses-permission android:name="android.permission.CAMERA" />`);
  mf.push(`<uses-feature android:name="android.hardware.camera" android:required="false" />`);
  rp.push("android.permission.CAMERA");
}
if (cfg.enableMicrophone) {
  mp.push(`<uses-permission android:name="android.permission.RECORD_AUDIO" />`);
  rp.push("android.permission.RECORD_AUDIO");
}
if (cfg.enableAudioSettings) mp.push(`<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />`);

if (cfg.enableGeolocation) {
  mp.push(`<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />`);
  rp.push("android.permission.ACCESS_FINE_LOCATION");
}
if (cfg.enableCoarseLocation) {
  mp.push(`<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />`);
  rp.push("android.permission.ACCESS_COARSE_LOCATION");
}
if (cfg.enableBackgroundLocation) mp.push(`<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />`);

if (cfg.enableReadMediaImages) {
  mp.push(`<uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />`);
  rp.push("android.permission.READ_MEDIA_IMAGES");
}
if (cfg.enableReadMediaVideo) {
  mp.push(`<uses-permission android:name="android.permission.READ_MEDIA_VIDEO" />`);
  rp.push("android.permission.READ_MEDIA_VIDEO");
}
if (cfg.enableReadMediaAudio) {
  mp.push(`<uses-permission android:name="android.permission.READ_MEDIA_AUDIO" />`);
  rp.push("android.permission.READ_MEDIA_AUDIO");
}
if (cfg.enableStorage || cfg.enableFileUpload) {
  mp.push(`<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />`);
  mp.push(`<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29" />`);
  // Android 13+ storage support
  mp.push(`<uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />`);
  rp.push("android.permission.READ_EXTERNAL_STORAGE");
}

if (cfg.enableBluetooth) {
  mp.push(`<uses-permission android:name="android.permission.BLUETOOTH_SCAN" android:usesPermissionFlags="neverForLocation" />`);
  mp.push(`<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />`);
  mp.push(`<uses-permission android:name="android.permission.BLUETOOTH_ADVERTISE" />`);
  rp.push("android.permission.BLUETOOTH_SCAN", "android.permission.BLUETOOTH_CONNECT");
}
if (cfg.enableBluetoothLegacy) {
  mp.push(`<uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />`);
  mp.push(`<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />`);
}
if (cfg.enableNfc) {
  mp.push(`<uses-permission android:name="android.permission.NFC" />`);
  mf.push(`<uses-feature android:name="android.hardware.nfc" android:required="false" />`);
}
if (cfg.enableNearbyWifi) {
  mp.push(`<uses-permission android:name="android.permission.NEARBY_WIFI_DEVICES" android:usesPermissionFlags="neverForLocation" />`);
  rp.push("android.permission.NEARBY_WIFI_DEVICES");
}

if (cfg.enableWifi) mp.push(`<uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />`);
if (cfg.enableChangeWifi) mp.push(`<uses-permission android:name="android.permission.CHANGE_WIFI_STATE" />`);
if (cfg.enableVibration) mp.push(`<uses-permission android:name="android.permission.VIBRATE" />`);
if (cfg.enableWakeLock) mp.push(`<uses-permission android:name="android.permission.WAKE_LOCK" />`);
if (cfg.enableFlashlight) mf.push(`<uses-feature android:name="android.hardware.camera.flash" android:required="false" />`);

if (cfg.enableBodySensors) {
  mp.push(`<uses-permission android:name="android.permission.BODY_SENSORS" />`);
  rp.push("android.permission.BODY_SENSORS");
}
if (cfg.enableActivityRecognition) {
  mp.push(`<uses-permission android:name="android.permission.ACTIVITY_RECOGNITION" />`);
  rp.push("android.permission.ACTIVITY_RECOGNITION");
}
if (cfg.enableReadPhoneState) {
  mp.push(`<uses-permission android:name="android.permission.READ_PHONE_STATE" />`);
  rp.push("android.permission.READ_PHONE_STATE");
}
if (cfg.enableCallPhone) {
  mp.push(`<uses-permission android:name="android.permission.CALL_PHONE" />`);
  rp.push("android.permission.CALL_PHONE");
}
if (cfg.enableReadContacts) {
  mp.push(`<uses-permission android:name="android.permission.READ_CONTACTS" />`);
  rp.push("android.permission.READ_CONTACTS");
}
if (cfg.enableWriteContacts) {
  mp.push(`<uses-permission android:name="android.permission.WRITE_CONTACTS" />`);
  rp.push("android.permission.WRITE_CONTACTS");
}
if (cfg.enableGetAccounts) {
  mp.push(`<uses-permission android:name="android.permission.GET_ACCOUNTS" />`);
  rp.push("android.permission.GET_ACCOUNTS");
}
if (cfg.enableSendSms) {
  mp.push(`<uses-permission android:name="android.permission.SEND_SMS" />`);
  rp.push("android.permission.SEND_SMS");
}
if (cfg.enableReceiveSms) {
  mp.push(`<uses-permission android:name="android.permission.RECEIVE_SMS" />`);
  rp.push("android.permission.RECEIVE_SMS");
}
if (cfg.enableReadSms) {
  mp.push(`<uses-permission android:name="android.permission.READ_SMS" />`);
  rp.push("android.permission.READ_SMS");
}
if (cfg.enableReadCalendar) {
  mp.push(`<uses-permission android:name="android.permission.READ_CALENDAR" />`);
  rp.push("android.permission.READ_CALENDAR");
}
if (cfg.enableWriteCalendar) {
  mp.push(`<uses-permission android:name="android.permission.WRITE_CALENDAR" />`);
  rp.push("android.permission.WRITE_CALENDAR");
}
if (cfg.enableNotifications) {
  mp.push(`<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />`);
  rp.push("android.permission.POST_NOTIFICATIONS");
}
if (cfg.enableForegroundService) mp.push(`<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />`);
if (cfg.enableBootCompleted) mp.push(`<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />`);
if (cfg.enableInstallShortcut) mp.push(`<uses-permission android:name="android.permission.INSTALL_SHORTCUT" />`);
if (cfg.enableSystemAlertWindow) mp.push(`<uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" />`);
if (cfg.enableInstallPackages) mp.push(`<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />`);
if (cfg.enableBiometric) {
  mp.push(`<uses-permission android:name="android.permission.USE_BIOMETRIC" />`);
  rp.push("android.permission.USE_BIOMETRIC");
}
if (cfg.enableFingerprint) {
  mp.push(`<uses-permission android:name="android.permission.USE_FINGERPRINT" />`);
  rp.push("android.permission.USE_FINGERPRINT");
}

console.log("Base manifest permissions:", mp.length);
console.log("Base manifest features:", mf.length);

const orientationAttr =
  cfg.orientation === "landscape" ? 'android:screenOrientation="landscape"'
  : cfg.orientation === "portrait" ? 'android:screenOrientation="portrait"'
  : 'android:screenOrientation="unspecified"';

let launcherBlock;
if (moduleHasLauncherActivity) {
  launcherBlock = `<!-- Launcher activity comes from custom module -->`;
} else {
  launcherBlock = `
      <activity
          android:name=".MainActivity"
          android:exported="true"
          android:configChanges="orientation|screenSize|keyboardHidden|screenLayout|smallestScreenSize"
          android:hardwareAccelerated="true"
          ${orientationAttr}>
          <intent-filter>
              <action android:name="android.intent.action.MAIN" />
              <category android:name="android.intent.category.LAUNCHER" />
          </intent-filter>
      </activity>`;
}

const basePermNames = new Set();
for (const p of mp) {
  const m = p.match(/android:name="([^"]+)"/);
  if (m) basePermNames.add(m);
}
const baseFeatNames = new Set();
for (const f of mf) {
  const m = f.match(/android:name="([^"]+)"/);
  if (m) baseFeatNames.add(m);
}

const extraRoot = [];
for (const elem of moduleRootManifest) {
  const nameM = elem.match(/android:name="([^"]+)"/);
  if (!nameM) { extraRoot.push(elem); continue; }
  const name = nameM;
  if (elem.startsWith("<uses-permission")) {
    if (basePermNames.has(name)) continue;
    basePermNames.add(name);
    extraRoot.push(elem);
  } else if (elem.startsWith("<uses-feature")) {
    if (baseFeatNames.has(name)) continue;
    baseFeatNames.add(name);
    extraRoot.push(elem);
  } else {
    extraRoot.push(elem);
  }
}

const rootManifestBlock = extraRoot.length > 0
  ? "\n  " + extraRoot.join("\n  ")
  : "";

const appManifestBlock = moduleAppManifest.length > 0
  ? "\n      " + moduleAppManifest.join("\n      ")
  : "";

// FIX: Enable usesCleartextTraffic by default or per config so non-https links are not blocked
const cleartextTraffic = cfg.cleartextTraffic !== false ? "true" : "false";

const manifest =
`<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
${rootManifestBlock}

  ${mp.join("\n  ")}

  ${mf.join("\n  ")}

  <application
      android:allowBackup="true"
      android:icon="@mipmap/ic_launcher"
      android:label="@string/app_name"
      android:roundIcon="@mipmap/ic_launcher_round"
      android:supportsRtl="true"
      android:usesCleartextTraffic="${cleartextTraffic}"
      android:hardwareAccelerated="true"
      android:theme="@style/AppTheme">
      ${launcherBlock}
${appManifestBlock}
  </application>
</manifest>
`;
fs.writeFileSync(path.join(ROOT, "app/src/main/AndroidManifest.xml"), manifest);

console.log(`✓ Manifest written`);
console.log(`  Total permissions: ${mp.length + extraRoot.filter(e => e.startsWith("<uses-permission")).length}`);

const manifestContent = fs.readFileSync(
  path.join(ROOT, "app/src/main/AndroidManifest.xml"),
  "utf8"
);
if (!manifestContent.includes("android.intent.category.LAUNCHER")) {
  console.error("❌ Generated manifest has NO MAIN/LAUNCHER activity.");
  process.exit(1);
}
console.log("✓ Launcher activity present");

// ═══════════════════════════════════════════════════════════════
// Resources
// ═══════════════════════════════════════════════════════════════
fs.writeFileSync(path.join(resDir, "values/strings.xml"),
`<?xml version="1.0" encoding="utf-8"?>
<resources>
  <string name="app_name">${escapeXml(cfg.appName)}</string>
</resources>
`);

fs.writeFileSync(path.join(resDir, "values/colors.xml"),
`<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="theme_color">${themeColor}</color>
  <color name="theme_color_dark">${themeColor}</color>
  <color name="ic_launcher_background">${themeColor}</color>
</resources>
`);

fs.writeFileSync(path.join(resDir, "values/styles.xml"),
`<?xml version="1.0" encoding="utf-8"?>
<resources>
  <style name="AppTheme" parent="Theme.AppCompat.Light.NoActionBar">
    <item name="colorPrimary">@color/theme_color</item>
    <item name="colorPrimaryDark">@color/theme_color_dark</item>
    <item name="colorAccent">@color/theme_color</item>
    <item name="android:windowBackground">@android:color/white</item>
  </style>
</resources>
`);

// ═══════════════════════════════════════════════════════════════
// ICONS — Adaptive icon support (Android 8+)
// ═══════════════════════════════════════════════════════════════
const iconSizes = {
  "mipmap-mdpi": 48, "mipmap-hdpi": 72, "mipmap-xhdpi": 96,
  "mipmap-xxhdpi": 144, "mipmap-xxxhdpi": 192,
};

const foregroundSizes = {
  "mipmap-mdpi": 108, "mipmap-hdpi": 162, "mipmap-xhdpi": 216,
  "mipmap-xxhdpi": 324, "mipmap-xxxhdpi": 432,
};

let userIconPath = null;
if (cfg.iconBase64) {
  // Support png, jpeg, webp or raw base64 string
  const m = cfg.iconBase64.match(/^data:image\/[a-zA-Z+]+;base64,([\s\S]+)$/) || [null, cfg.iconBase64];
  if (m && m) {
    userIconPath = path.join(ROOT, ".user-icon.png");
    try {
      fs.writeFileSync(userIconPath, Buffer.from(m.replace(/\s/g, ""), "base64"));
      console.log("User icon saved:", fs.statSync(userIconPath).size, "bytes");
    } catch (e) {
      console.warn("Failed to parse iconBase64:", e.message);
      userIconPath = null;
    }
  }
}

let magickCmd = null;
try { execSync("which convert", { stdio: "pipe" }); magickCmd = "convert"; } catch {}
if (!magickCmd) {
  try { execSync("which magick", { stdio: "pipe" }); magickCmd = "magick"; } catch {}
}

// Main ic_launcher.png (all densities)
for (const [dir, size] of Object.entries(iconSizes)) {
  const dest = path.join(resDir, dir, "ic_launcher.png");
  let done = false;
  if (userIconPath && magickCmd) {
    try {
      execSync(
        `${magickCmd} "${userIconPath}" -background none -resize ${size}x${size} ` +
        `-gravity center -extent ${size}x${size} -strip ` +
        `-define png:color-type=6 -depth 8 PNG32:"${dest}"`,
        { stdio: "pipe" }
      );
      done = true;
    } catch (e) { console.warn(`Icon ${dir} failed: ${e.message}`); }
  }
  if (!done) fs.writeFileSync(dest, generateSolidPng(themeColor, size));
}

// Round version (same image)
for (const [dir] of Object.entries(iconSizes)) {
  const src = path.join(resDir, dir, "ic_launcher.png");
  const dst = path.join(resDir, dir, "ic_launcher_round.png");
  fs.copyFileSync(src, dst);
}

// Foreground layer (larger canvas, icon centered at ~66%)
for (const [dir, size] of Object.entries(foregroundSizes)) {
  const dest = path.join(resDir, dir, "ic_launcher_foreground.png");
  let done = false;
  if (userIconPath && magickCmd) {
    try {
      const innerSize = Math.round(size * 0.66);
      execSync(
        `${magickCmd} -size ${size}x${size} xc:none ` +
        `\\( "${userIconPath}" -resize ${innerSize}x${innerSize} \\) ` +
        `-gravity center -composite -strip ` +
        `-define png:color-type=6 -depth 8 PNG32:"${dest}"`,
        { stdio: "pipe" }
      );
      done = true;
    } catch (e) { console.warn(`Foreground ${dir} failed: ${e.message}`); }
  }
  if (!done) fs.writeFileSync(dest, generateSolidPng(themeColor, size));
}

// Adaptive icon XML (Android 8+)
fs.writeFileSync(
  path.join(resDir, "mipmap-anydpi-v26/ic_launcher.xml"),
`<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`
);

fs.writeFileSync(
  path.join(resDir, "mipmap-anydpi-v26/ic_launcher_round.xml"),
`<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`
);

if (userIconPath && fs.existsSync(userIconPath)) fs.unlinkSync(userIconPath);
console.log("✓ Icons generated (main + round + adaptive foreground)");

// ═══════════════════════════════════════════════════════════════
// config.json (only for WebView mode)
// ═══════════════════════════════════════════════════════════════
if (!isNativeMode) {
  fs.writeFileSync(path.join(assetsDir, "config.json"),
    JSON.stringify({
      appMode: cfg.appMode || "hybrid",
      websiteUrl: cfg.websiteUrl,
      themeColor: themeColor,
      enableJs: cfg.enableJs,
      enableFileUpload: cfg.enableFileUpload,
      enableCamera: cfg.enableCamera,
      enableMicrophone: cfg.enableMicrophone,
      enableGeolocation: cfg.enableGeolocation,
      orientation: cfg.orientation,
      hasOffline: hasOffline,
    }, null, 2)
  );
}

// ═══════════════════════════════════════════════════════════════
// MainActivity (only if not skipped)
// ═══════════════════════════════════════════════════════════════
const permsArrayKt = rp.length > 0 ? rp.map(p => `"${p}"`).join(", ") : "";
const hasOfflineStr = hasOffline ? "true" : "false";
const appModeStr = JSON.stringify(cfg.appMode || "hybrid");

// Safely escape website URL so quotes, backslashes, or $ won't break Kotlin syntax
const safeLiveUrl = (cfg.websiteUrl || "https://example.com")
  .replace(/\\/g, "\\\\")
  .replace(/"/g, '\\"')
  .replace(/\$/g, "\\$");

const mainActivity =
`package ${cfg.packageName}

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.*
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private val fileChooserRequestCode = 1001
    private val permissionRequestCode = 2001

    private val startupPermissions = arrayOf(${permsArrayKt})
    private val HAS_OFFLINE = ${hasOfflineStr}
    private val APP_MODE = ${appModeStr}
    private val LIVE_URL = "${safeLiveUrl}"
    private val OFFLINE_URL = "file:///android_asset/index.html"

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Native mode guard: If MainActivity is ever reached in native mode, do not load webview
        if (APP_MODE == "native") {
            return
        }

        val config = readConfig()

        when (config.optString("orientation", "portrait")) {
            "portrait" -> requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
            "landscape" -> requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
            else -> requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        }

        webView = WebView(this)
        setContentView(webView)

        webView.settings.apply {
            javaScriptEnabled = config.optBoolean("enableJs", true)
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            allowFileAccessFromFileURLs = true
            allowUniversalAccessFromFileURLs = true
            mediaPlaybackRequiresUserGesture = false
            loadWithOverviewMode = true
            useWideViewPort = true
            setSupportZoom(false)
            builtInZoomControls = false
            javaScriptCanOpenWindowsAutomatically = true
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                // Handle standard HTTP, HTTPS and local asset files inside WebView
                if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("file:")) {
                    return false
                }
                // Handle external custom schemes (tel, mailto, whatsapp, sms, upi, intent)
                return try {
                    val intent = Intent(Intent.ACTION_VIEW, request.url)
                    view?.context?.startActivity(intent)
                    true
                } catch (e: Exception) {
                    true
                }
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                this@MainActivity.filePathCallback?.onReceiveValue(null)
                this@MainActivity.filePathCallback = filePathCallback
                val intent = fileChooserParams?.createIntent()
                return try {
                    if (intent != null) {
                        startActivityForResult(intent, fileChooserRequestCode)
                        true
                    } else {
                        this@MainActivity.filePathCallback = null
                        false
                    }
                } catch (e: Exception) {
                    this@MainActivity.filePathCallback = null
                    false
                }
            }

            override fun onPermissionRequest(request: PermissionRequest?) {
                request?.grant(request.resources)
            }

            override fun onGeolocationPermissionsShowPrompt(
                origin: String?,
                callback: GeolocationPermissions.Callback?
            ) {
                if (config.optBoolean("enableGeolocation", false)) {
                    callback?.invoke(origin, true, false)
                } else {
                    super.onGeolocationPermissionsShowPrompt(origin, callback)
                }
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (::webView.isInitialized && webView.canGoBack()) webView.goBack() else finish()
            }
        })

        if (startupPermissions.isNotEmpty()) {
            requestStartupPermissions()
        }

        loadBestUrl()
    }

    private fun isOnline(): Boolean {
        return try {
            val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val n = cm.activeNetwork ?: return false
                val caps = cm.getNetworkCapabilities(n) ?: return false
                caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            } else {
                @Suppress("DEPRECATION")
                cm.activeNetworkInfo?.isConnected == true
            }
        } catch (e: Exception) { false }
    }

    private fun loadBestUrl() {
        val url: String? = when (APP_MODE) {
            "native" -> null
            "offline" -> if (HAS_OFFLINE) OFFLINE_URL else null
            "online" -> LIVE_URL
            else -> {
                if (isOnline()) LIVE_URL
                else if (HAS_OFFLINE) OFFLINE_URL
                else null
            }
        }

        if (url != null) {
            webView.loadUrl(url)
        } else if (APP_MODE != "native") {
            webView.loadDataWithBaseURL(null, noInternetHtml(), "text/html", "UTF-8", null)
        }
    }

    private fun noInternetHtml(): String {
        return """
            <!DOCTYPE html>
            <html><head><meta name="viewport" content="width=device-width,initial-scale=1">
            <style>
              body { font-family: sans-serif; text-align: center; padding: 40px 20px; color: #444; }
              h1 { font-size: 20px; }
              p { font-size: 14px; color: #666; }
              button { margin-top: 20px; padding: 12px 24px; font-size: 15px; background: #1f6feb; color: white; border: none; border-radius: 8px; }
            </style></head>
            <body>
              <h1>📡 Content unavailable</h1>
              <p>Please check your connection and try again.</p>
              <button onclick="location.reload()">Retry</button>
            </body></html>
        """.trimIndent()
    }

    private fun requestStartupPermissions() {
        val missing = startupPermissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, missing.toTypedArray(), permissionRequestCode)
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: android.content.Intent?) {
        if (requestCode == fileChooserRequestCode) {
            filePathCallback?.onReceiveValue(
                WebChromeClient.FileChooserParams.parseResult(resultCode, data)
            )
            filePathCallback = null
        } else {
            super.onActivityResult(requestCode, resultCode, data)
        }
    }

    private fun readConfig(): JSONObject {
        return try {
            val text = assets.open("config.json").bufferedReader().use { it.readText() }
            JSONObject(text)
        } catch (e: Exception) {
            JSONObject().put("websiteUrl", LIVE_URL)
        }
    }
}
`;

if (skipDefaultMainActivity) {
  console.log("⚑ Skipping default WebView MainActivity.kt (Native mode or Custom module provided)");
} else {
  fs.writeFileSync(path.join(javaDir, "MainActivity.kt"), mainActivity);
  console.log("✓ Wrote default WebView MainActivity.kt");
}

console.log("✅ Android project generated at", ROOT);

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
function escapeXml(s) {
  if (!s) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "\\'")
    .replace(/@/g, "\\@")
    .replace(/\?/g, "\\?");
}

function generateSolidPng(hex, size = 192) {
  const { deflateSync } = require("zlib");
  const safeHex = (hex && String(hex).startsWith("#")) ? hex : (hex ? `#${hex}` : "#1f6feb");
  const r = parseInt(safeHex.slice(1, 3), 16) || 0x1f;
  const g = parseInt(safeHex.slice(3, 5), 16) || 0x6f;
  const b = parseInt(safeHex.slice(5, 7), 16) || 0xeb;

  const width = size, height = size;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 6;
  const ihdr = chunk("IHDR", ihdrData);

  const rowSize = 1 + width * 4;
  const raw = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    const off = y * rowSize;
    for (let x = 0; x < width; x++) {
      raw[off + 1 + x * 4] = r;
      raw[off + 2 + x * 4] = g;
      raw[off + 3 + x * 4] = b;
      raw[off + 4 + x * 4] = 255;
    }
  }
  const idat = chunk("IDAT", deflateSync(raw));
  const iend = chunk("IEND", Buffer.alloc(0));
  return Buffer.concat([sig, ihdr, idat, iend]);

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, "ascii");
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }
  function crc32(buf) {
    let c = ~0;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
    }
    return ~c;
  }
}

