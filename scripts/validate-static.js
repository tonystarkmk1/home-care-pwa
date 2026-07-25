'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const required = [
  'server3.js', 'schema.sql', 'public/index.html', 'public/app.css', 'public/app.js',
  'public/install-app.js', 'public/sw.js', 'public/manifest.json', 'public/offline.html',
  'scripts/migrate.js', 'scripts/seed.js', 'scripts/start-stable.js',
];
required.forEach((file) => assert.ok(fs.existsSync(path.join(root, file)), `${file} mancante`));

const index = read('public/index.html');
const app = read('public/app.js');
const installer = read('public/install-app.js');
const worker = read('public/sw.js');
const server = read('server3.js');
const start = read('scripts/start-stable.js');
const packageJson = JSON.parse(read('package.json'));
const manifest = JSON.parse(read('public/manifest.json'));

assert.doesNotMatch(index, /<script(?![^>]*\bsrc=)[^>]*>/i, 'index.html contiene script inline');
assert.doesNotMatch(index, /\son[a-z]+\s*=/i, 'index.html contiene event handler inline');
assert.doesNotMatch(index, /\sstyle\s*=/i, 'index.html contiene stile inline');
assert.doesNotMatch(index, /javascript:/i, 'index.html contiene URL javascript');
assert.match(index, /viewport-fit=cover/);
assert.match(index, /data-apply-update/);
assert.match(index, /install-app\.js/);

assert.doesNotMatch(app, /localStorage\.setItem\([^)]*(token|session)/i, 'il token non deve essere salvato in localStorage');
assert.doesNotMatch(app, /\sonclick=/i, 'app.js non deve generare onclick inline');
assert.doesNotMatch(app, /\sstyle=/i, 'app.js non deve generare style inline');
assert.match(app, /data-install-app/);
assert.match(app, /esc\(/);
assert.match(installer, /beforeinstallprompt/);
assert.match(installer, /iphone\|ipad\|ipod/i);
assert.match(installer, /samsungbrowser/i);
assert.match(installer, /controllerchange/);
assert.match(worker, /\/api\//);
assert.match(worker, /cache:\s*'no-store'/);

assert.equal(packageJson.dependencies.multer, '2.2.0');
assert.match(packageJson.scripts.check, /validate:static/);
assert.match(packageJson.scripts.test, /node --test/);
assert.equal(packageJson.engines.node, '>=20.11');

assert.doesNotMatch(start, /patch-/i, 'start-stable non deve applicare patch runtime');
assert.match(start, /start\(\)/);
assert.match(server, /httpOnly:\s*true/);
assert.match(server, /contentSecurityPolicy/);
assert.match(server, /STRIPE_WEBHOOK_SECRET è obbligatorio/);
assert.match(server, /stripe\.webhooks\.constructEvent|stripeClient\.webhooks\.constructEvent/);
assert.match(server, /check_photos/);
assert.doesNotMatch(server, /express\.static\([^)]*uploads/i, 'gli upload non devono essere pubblici');

assert.equal(manifest.display, 'standalone');
assert.equal(manifest.scope, '/');
assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192'));
assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512'));
assert.ok(Array.isArray(manifest.shortcuts) && manifest.shortcuts.length >= 2);

console.log('Validazione statica completata.');
