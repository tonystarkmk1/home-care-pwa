'use strict';

const fs = require('node:fs');
const path = require('node:path');

const target = path.join(__dirname, 'validate-static.js');
let content = fs.readFileSync(target, 'utf8');
content = content
  .replaceAll('runtime-stability-v43', 'runtime-stability-v44')
  .replaceAll('pwa-v43', 'pwa-v44');
fs.writeFileSync(target, content.endsWith('\n') ? content : `${content}\n`);
console.log('Riferimenti V44 del validatore corretti.');
