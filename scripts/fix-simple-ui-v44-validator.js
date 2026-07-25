'use strict';

const fs = require('node:fs');
const path = require('node:path');

const target = path.join(__dirname, 'validate-static.js');
let content = fs.readFileSync(target, 'utf8');
content = content
  .replaceAll('runtime-stability-v43\\.js', 'runtime-stability-v44\\.js')
  .replaceAll('pwa-v43\\.js', 'pwa-v44\\.js');
fs.writeFileSync(target, content.endsWith('\n') ? content : `${content}\n`);
console.log('Riferimenti regex V44 corretti.');
