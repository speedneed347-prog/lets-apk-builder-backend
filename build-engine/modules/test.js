'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadModule } = require('./module-loader');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lets-module-'));
fs.writeFileSync(path.join(dir, 'module.json'), JSON.stringify({ id:'camera.test', name:'Camera Test', version:'1.0.0' }));
fs.writeFileSync(path.join(dir, 'Test.kt'), 'class Test {}');
const mod = loadModule(dir);
if (mod.metadata.id !== 'camera.test' || !mod.files.includes('module.json')) throw new Error('module test failed');
fs.rmSync(dir, { recursive:true, force:true });
console.log('module tests: OK');
