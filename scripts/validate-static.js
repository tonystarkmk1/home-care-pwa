'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const required = [
  'server3.js', 'schema.sql', 'public/index.html', 'public/app.css', 'public/app.js',
  'public/runtime-stability-v44.js', 'public/pwa-v44.js', 'public/operations-v2.js',
  'public/operations-v2.css', 'public/guided-checks-v2.js', 'public/guided-checks-v2.css',
  'public/simple-ui-v44.js', 'public/simple-ui-v44.css',
  'public/sw.js', 'public/manifest.json', 'public/offline.html', 'public/icon.svg',
  'public/icon-192.png', 'public/icon-512.png', 'public/apple-touch-icon.png', 'public/favicon.ico',
  'src/guided-checks-v2.js', 'tests/guided-checks.test.js',
  'src/simple-ux-v44.js', 'tests/simple-ui-v44.test.js',
  'scripts/migrate.js', 'scripts/seed.js', 'scripts/start-stable.js',
];
required.forEach((file) => assert.ok(fs.existsSync(path.join(root, file)), `${file} mancante`));

const index = read('public/index.html');
const app = read('public/app.js');
const runtime = read('public/runtime-stability-v44.js');
const installer = read('public/pwa-v44.js');
const operations = read('public/operations-v2.js');
const operationsCss = read('public/operations-v2.css');
const guided = read('public/guided-checks-v2.js');
const guidedBackend = read('src/guided-checks-v2.js');
const simpleUi = read('public/simple-ui-v44.js');
const simpleCss = read('public/simple-ui-v44.css');
const simpleBackend = read('src/simple-ux-v44.js');
const schema = read('schema.sql');
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
assert.match(index, /runtime-stability-v44\.js\?v=44/);
assert.match(index, /pwa-v44\.js\?v=44/);
assert.match(index, /operations-v2\.js\?v=44/);
assert.match(index, /guided-checks-v2\.js\?v=44/);
assert.match(index, /simple-ui-v44\.js\?v=44/);
assert.match(index, /simple-ui-v44\.css\?v=44/);

assert.doesNotMatch(app, /localStorage\.setItem\([^)]*(token|session)/i, 'il token non deve essere salvato in localStorage');
assert.doesNotMatch(app, /\sonclick=/i, 'app.js non deve generare onclick inline');
assert.doesNotMatch(app, /\sstyle=/i, 'app.js non deve generare style inline');
assert.match(app, /data-install-app/);
assert.match(app, /esc\(/);

assert.match(runtime, /StableMutationObserver/);
assert.match(runtime, /recoverBoot/);
assert.match(runtime, /serviceWorker\.getRegistrations/);
assert.match(installer, /beforeinstallprompt/);
assert.match(installer, /iphone\|ipad\|ipod/i);
assert.match(installer, /samsungbrowser/i);
assert.match(installer, /installLabelState/);
assert.match(installer, /controllerchange[\s\S]{0,180}if \(!reloadForUpdate\) return;[\s\S]{0,180}window\.location\.reload\(\)/);

assert.match(worker, /home-care-v44/);
assert.match(worker, /networkFirst/);
assert.match(worker, /content-type/);
assert.match(worker, /\/api\//);
assert.match(worker, /cache:\s*'no-store'/);
assert.match(operations, /data-hc-action/);
assert.match(operationsCss, /\.action-sheet\.open/);
assert.match(guided, /Inizia controllo/);
assert.match(guided, /Approva e invia report/);
assert.match(guidedBackend, /property_check_templates/);
assert.match(guidedBackend, /guided_check_item_photos/);
assert.match(simpleUi, /Scegli il servizio per la tua casa/);
assert.match(simpleUi, /Le mie case/);
assert.match(simpleUi, /Il prossimo passo/);
assert.match(simpleCss, /\.hc-simple-mobile-nav/);
assert.match(simpleBackend, /\/api\/client\/plan-selection/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS property_occupancies/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS notifications/);
assert.match(schema, /home_care_next_available_date/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS guided_checks/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS property_check_templates/);

for (const file of ['public/icon-192.png', 'public/icon-512.png', 'public/apple-touch-icon.png']) {
  const buffer = fs.readFileSync(path.join(root, file));
  assert.ok(buffer.length > 500, `${file} troppo piccolo`);
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${file} non è un PNG valido`);
}
const favicon = fs.readFileSync(path.join(root, 'public/favicon.ico'));
assert.ok(favicon.length > 500, 'favicon.ico troppo piccolo');
assert.equal(favicon.subarray(0, 4).toString('hex'), '00000100', 'favicon.ico non valido');

assert.equal(packageJson.dependencies.multer, '2.2.0');
assert.match(packageJson.scripts.check, /runtime-stability-v44/);
assert.match(packageJson.scripts.check, /pwa-v44/);
assert.match(packageJson.scripts.check, /validate:static/);
assert.match(packageJson.scripts.test, /node --test/);
assert.equal(packageJson.engines.node, '22.23.1');

assert.doesNotMatch(start, /patch-/i, 'start-stable non deve applicare patch runtime');
assert.match(start, /start\(\)/);
assert.match(server, /httpOnly:\s*true/);
assert.match(server, /contentSecurityPolicy/);
assert.match(server, /STRIPE_WEBHOOK_SECRET è obbligatorio/);
assert.match(server, /stripe\.webhooks\.constructEvent|stripeClient\.webhooks\.constructEvent/);
assert.match(server, /check_photos/);
assert.match(server, /selected_plan/);
assert.match(server, /current_package_type/);
assert.doesNotMatch(server, /express\.static\([^)]*uploads/i, 'gli upload non devono essere pubblici');

assert.equal(manifest.id, '/');
assert.equal(manifest.display, 'standalone');
assert.deepEqual(manifest.display_override, ['standalone']);
assert.equal(manifest.scope, '/');
assert.match(manifest.start_url, /app_version=44/);
assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192' && icon.type === 'image/png'));
assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512' && icon.type === 'image/png'));
assert.ok(Array.isArray(manifest.shortcuts) && manifest.shortcuts.length >= 2);

console.log('Validazione statica completata.');
