#!/usr/bin/env node
/**
 * Install custom modules from backend.
 *
 * Two modes:
 *   - scan:    `node install-custom-modules.js <buildId> scan`
 *              Collects module metadata (deps, manifest fragments) and
 *              writes module-flags.json for generate-project.js
 *
 *   - install: `node install-custom-modules.js <buildId>`
 *              Copies Kotlin / layouts / drawables / assets into project
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const fetch = require("node-fetch");

const BUILD_ID = process.argv[2];
const MODE = process.argv[3] || "install";
const BACKEND_URL = process.env.BACKEND_URL;
const SECRET = process.env.WEBHOOK_SECRET;
const PROJECT_ROOT = "android-project";

if (!BUILD_ID || !BACKEND_URL || !SECRET) {
  console.error("Missing BUILD_ID, BACKEND_URL or WEBHOOK_SECRET");
  process.exit(1);
}

console.log(`>>> install-custom-modules.js — mode: ${MODE}`);

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════
function findJavaDir(root) {
  const base = path.join(root, "app/src/main/java");
  if (!fs.existsSync(base)) return null;
  const dirs = [];
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { dirs.push(p); walk(p); }
    }
  }
  walk(base);
  return dirs.length > 0 ? dirs[dirs.length - 1] : base;
}

async function fetchModuleList() {
  const url = `${BACKEND_URL}/api/internal/modules/${BUILD_ID}`;
  const res = await fetch(url, { headers: { "X-Internal-Secret": SECRET } });
  if (!res.ok) return [];
  const { modules } = await res.json();
  return modules || [];
}

async function fetchModuleZip(moduleId) {
  const url = `${BACKEND_URL}/api/internal/module/${BUILD_ID}/${moduleId}`;
  const res = await fetch(url, { headers: { "X-Internal-Secret": SECRET } });
  if (!res.ok) return null;
  return res.json();
}

function extractZip(base64, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const zipPath = path.join(destDir, "module.zip");
  fs.writeFileSync(zipPath, Buffer.from(base64, "base64"));
  execSync(`unzip -q -o "${zipPath}" -d "${destDir}/x"`, { stdio: "inherit" });
  fs.unlinkSync(zipPath);
  let srcDir = path.join(destDir, "x");
  const entries = fs.readdirSync(srcDir);
  if (entries.length === 1 && fs.statSync(path.join(srcDir, entries[0])).isDirectory()) {
    srcDir = path.join(srcDir, entries[0]);
  }
  return srcDir;
}

// ═══════════════════════════════════════════════════════════════
// SCAN MODE
// ═══════════════════════════════════════════════════════════════
async function runScan() {
  console.log("Mode: scan — collecting metadata for generate-project.js");

  const modules = await fetchModuleList();
  if (modules.length === 0) {
    console.log("No custom modules for this build");
    fs.writeFileSync("module-flags.json", JSON.stringify({
      overrideMainActivity: false,
      modules: [],
      allDeps: [],
      rootManifest: [],
      appManifest: [],
    }, null, 2));
    return;
  }

  console.log(`Found ${modules.length} module(s): ${modules.map(m => m.id).join(", ")}`);

  const flags = {
    overrideMainActivity: false,
    modules: [],
    allDeps: [],
    rootManifest: [],
    appManifest: [],
  };

  const seenPerms = new Set();
  const seenFeats = new Set();
  const seenDeps = new Set();

  for (const mod of modules) {
    console.log(`\n→ Scanning: ${mod.id}`);
    try {
      const data = await fetchModuleZip(mod.id);
      if (!data) {
        console.warn(`  ✗ No data for ${mod.id}`);
        continue;
      }

      const tmpDir = path.join(process.cwd(), `.scan-${mod.id}`);
      fs.rmSync(tmpDir, { recursive: true, force: true });
      const srcDir = extractZip(data.base64, tmpDir);

      const metaPath = path.join(srcDir, "module.json");
      if (!fs.existsSync(metaPath)) {
        console.warn(`  ✗ ${mod.id}: no module.json`);
        fs.rmSync(tmpDir, { recursive: true, force: true });
        continue;
      }

      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      console.log(`  ✓ ${meta.name} v${meta.version}`);

      flags.modules.push({
        id: mod.id,
        name: meta.name,
        version: meta.version,
        overrideMainActivity: meta.overrideMainActivity === true,
      });

      if (meta.overrideMainActivity === true) {
        flags.overrideMainActivity = true;
        console.log(`  ⚑ "${meta.name}" overrides MainActivity`);
      }

      // ═══ Collect deps.gradle ═══
      const depsFile = path.join(srcDir, "deps.gradle");
      if (fs.existsSync(depsFile)) {
        const content = fs.readFileSync(depsFile, "utf8");
        const deps = content
          .split("\n")
          .map(l => l.trim())
          .filter(l => l && !l.startsWith("//"));
        for (const d of deps) {
          if (!seenDeps.has(d)) {
            seenDeps.add(d);
            flags.allDeps.push(d);
          }
        }
        console.log(`  ✓ ${deps.length} deps collected`);
        for (const d of deps) console.log(`     • ${d}`);
      } else {
        console.log(`  ⚠ No deps.gradle — module has no extra deps`);
      }

      // ═══ Collect manifest.xml ═══
      const manifestFile = path.join(srcDir, "manifest.xml");
      if (fs.existsSync(manifestFile)) {
        const content = fs.readFileSync(manifestFile, "utf8");

        // Root-level: uses-permission and uses-feature
        const rootRegex = /<(uses-permission|uses-feature)\b[^>]*\/>/g;
        let m;
        while ((m = rootRegex.exec(content)) !== null) {
          const elem = m[0].trim();
          const nameM = elem.match(/android:name="([^"]+)"/);
          if (nameM) {
            const name = nameM[1];
            if (m[1] === "uses-permission") {
              if (seenPerms.has(name)) continue;
              seenPerms.add(name);
            } else if (m[1] === "uses-feature") {
              if (seenFeats.has(name)) continue;
              seenFeats.add(name);
            }
          }
          flags.rootManifest.push(elem);
        }

        // App-level: activity, service, receiver, provider
        const appRegex = /<(activity|service|receiver|provider)\b[\s\S]*?<\/\1>|<(activity|service|receiver|provider)\b[^>]*\/>/g;
        while ((m = appRegex.exec(content)) !== null) {
          flags.appManifest.push(m[0].trim());
        }

        console.log(`  ✓ Manifest: ${flags.rootManifest.length} root + ${flags.appManifest.length} app entries`);
      } else {
        console.log(`  ⚠ No manifest.xml — module has no manifest additions`);
      }

      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {
      console.error(`  ✗ Scan ${mod.id} FAILED:`, e.message);
      console.error(`     ${e.stack}`);
    }
  }

  fs.writeFileSync("module-flags.json", JSON.stringify(flags, null, 2));
  console.log(`\n✓ Wrote module-flags.json`);
  console.log(`  overrideMainActivity: ${flags.overrideMainActivity}`);
  console.log(`  modules: ${flags.modules.length}`);
  console.log(`  deps: ${flags.allDeps.length}`);
  console.log(`  root manifest: ${flags.rootManifest.length}`);
  console.log(`  app manifest: ${flags.appManifest.length}`);
}

// ═══════════════════════════════════════════════════════════════
// INSTALL MODE
// ═══════════════════════════════════════════════════════════════
const FORBIDDEN = [
  /Runtime\.getRuntime\(\)\.exec/,
  /ProcessBuilder/,
  /System\.exit/,
  /System\.getenv\(/,
  /\.deleteRecursively\(\)/,
];

function scanForThreats(content, file) {
  for (const p of FORBIDDEN) {
    if (p.test(content)) throw new Error(`Forbidden pattern in ${file}: ${p}`);
  }
}

async function installModuleFiles(modId, cfg, javaDir, resDir, assetsDir) {
  console.log(`\n→ Installing files from: ${modId}`);

  const data = await fetchModuleZip(modId);
  if (!data) {
    console.error(`  ✗ Fetch failed`);
    return false;
  }

  const tmpDir = path.join(process.cwd(), `.install-${modId}`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  const srcDir = extractZip(data.base64, tmpDir);

  // Kotlin files
  const ktFiles = fs.readdirSync(srcDir).filter(f => f.endsWith(".kt"));
  for (const f of ktFiles) {
    let content = fs.readFileSync(path.join(srcDir, f), "utf8");
    scanForThreats(content, f);
    content = content
      .replace(/{PACKAGE_NAME}/g, cfg.packageName)
      .replace(/{APP_NAME}/g, cfg.appName)
      .replace(/{THEME_COLOR}/g, cfg.themeColor);
    fs.writeFileSync(path.join(javaDir, f), content);
    console.log(`  ✓ Kotlin: ${f}`);
  }

  // Layouts
  const layoutSrc = path.join(srcDir, "layout");
  if (fs.existsSync(layoutSrc)) {
    const layoutDest = path.join(resDir, "layout");
    fs.mkdirSync(layoutDest, { recursive: true });
    for (const f of fs.readdirSync(layoutSrc)) {
      let c = fs.readFileSync(path.join(layoutSrc, f), "utf8");
      c = c.replace(/{PACKAGE_NAME}/g, cfg.packageName);
      fs.writeFileSync(path.join(layoutDest, f), c);
    }
    console.log(`  ✓ Layouts`);
  }

  // Drawables
  const drawableSrc = path.join(srcDir, "drawable");
  if (fs.existsSync(drawableSrc)) {
    const drawableDest = path.join(resDir, "drawable");
    fs.mkdirSync(drawableDest, { recursive: true });
    for (const f of fs.readdirSync(drawableSrc)) {
      fs.copyFileSync(path.join(drawableSrc, f), path.join(drawableDest, f));
    }
    console.log(`  ✓ Drawables`);
  }

  // Values
  const valuesSrc = path.join(srcDir, "values");
  if (fs.existsSync(valuesSrc)) {
    const valuesDest = path.join(resDir, "values");
    fs.mkdirSync(valuesDest, { recursive: true });
    for (const f of fs.readdirSync(valuesSrc)) {
      let c = fs.readFileSync(path.join(valuesSrc, f), "utf8");
      c = c.replace(/{PACKAGE_NAME}/g, cfg.packageName);
      fs.writeFileSync(path.join(valuesDest, f), c);
    }
    console.log(`  ✓ Values`);
  }

  // Assets
  const assetsSrc = path.join(srcDir, "assets");
  if (fs.existsSync(assetsSrc)) {
    fs.mkdirSync(assetsDir, { recursive: true });
    for (const f of fs.readdirSync(assetsSrc)) {
      const s = path.join(assetsSrc, f);
      const d = path.join(assetsDir, f);
      if (fs.statSync(s).isDirectory()) {
        execSync(`cp -r "${s}" "${d}"`);
      } else {
        fs.copyFileSync(s, d);
      }
    }
    console.log(`  ✓ Assets`);
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
  return true;
}

async function runInstall() {
  console.log("Mode: install — copying files into generated project");

  if (!fs.existsSync(PROJECT_ROOT)) {
    console.error(`✗ ${PROJECT_ROOT} not found. Run generate-project.js first.`);
    process.exit(1);
  }

  const javaDir = findJavaDir(PROJECT_ROOT);
  if (!javaDir) {
    console.error("✗ Could not find java directory in project");
    process.exit(1);
  }
  console.log("Java dir:", javaDir);

  const resDir = path.join(PROJECT_ROOT, "app/src/main/res");
  const assetsDir = path.join(PROJECT_ROOT, "app/src/main/assets");

  const modules = await fetchModuleList();
  if (modules.length === 0) {
    console.log("No custom modules to install");
    return;
  }

  const cfg = JSON.parse(fs.readFileSync("config.json", "utf8"));

  for (const mod of modules) {
    await installModuleFiles(mod.id, cfg, javaDir, resDir, assetsDir);
  }

  console.log(`\n✅ Installed ${modules.length} module file(s)`);
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════
(async () => {
  try {
    if (MODE === "scan") {
      await runScan();
    } else {
      await runInstall();
    }
  } catch (err) {
    console.error("Failed:", err.message);
    console.error(err.stack);
    process.exit(1);
  }
})();
