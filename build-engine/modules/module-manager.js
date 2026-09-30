#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { loadModule, safeResolve } = require('./module-loader');

function usage() {
  console.log(`Usage:\n  node build-engine/modules/module-manager.js validate <moduleDir>\n  node build-engine/modules/module-manager.js list <moduleDir>\n  node build-engine/modules/module-manager.js install <moduleDir> <androidProject>\n`);
}

function copyRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name); const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyRecursive(s, d); else fs.copyFileSync(s, d);
  }
}

function install(moduleDir, projectDir) {
  const mod = loadModule(moduleDir);
  const root = mod.root;
  const app = path.join(path.resolve(projectDir), 'app/src/main');
  if (!fs.existsSync(app)) throw new Error(`Android project not found: ${projectDir}`);

  const packageName = process.env.PACKAGE_NAME || '';
  const replacements = [
    [/{PACKAGE_NAME}/g, packageName],
    [/{APP_NAME}/g, process.env.APP_NAME || ''],
    [/{THEME_COLOR}/g, process.env.THEME_COLOR || ''],
  ];

  const copyTree = (name, target) => {
    const src = path.join(root, name);
    if (!fs.existsSync(src)) return;
    const dest = path.join(app, target);
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, entry.name); const d = path.join(dest, entry.name);
      if (entry.isDirectory()) copyRecursive(s, d);
      else {
        let buf = fs.readFileSync(s);
        if (/\.(kt|java|xml|gradle)$/.test(entry.name)) {
          let text = buf.toString('utf8');
          for (const [re, value] of replacements) text = text.replace(re, value);
          buf = Buffer.from(text);
        }
        fs.writeFileSync(d, buf);
      }
    }
  };

  const pkgPath = packageName ? packageName.split('.').join('/') : '';
  if (pkgPath && fs.existsSync(path.join(root, 'src'))) copyTree('src', `java/${pkgPath}`);
  else copyTree('kotlin', `java/${pkgPath}`);
  copyTree('layout', 'res/layout');
  copyTree('drawable', 'res/drawable');
  copyTree('values', 'res/values');
  copyTree('assets', 'assets');

  console.log(`Installed module ${mod.metadata.id}@${mod.metadata.version}`);
}

try {
  const [command, moduleDir, projectDir] = process.argv.slice(2);
  if (!command) { usage(); process.exit(1); }
  if (command === 'validate' || command === 'list') {
    const mod = loadModule(moduleDir);
    console.log(JSON.stringify({ metadata: mod.metadata, files: mod.files }, null, 2));
  } else if (command === 'install') {
    install(moduleDir, projectDir);
  } else { usage(); process.exit(1); }
} catch (err) {
  console.error(`Module manager error: ${err.message}`);
  process.exit(1);
}
