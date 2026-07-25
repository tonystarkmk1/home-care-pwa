'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function filePath(relative) {
  return path.join(root, relative);
}

function read(relative) {
  return fs.readFileSync(filePath(relative), 'utf8');
}

function write(relative, content) {
  fs.writeFileSync(filePath(relative), content.endsWith('\n') ? content : `${content}\n`);
}

function replaceRequired(content, search, replacement, label) {
  if (content.includes(replacement)) return content;
  if (!content.includes(search)) throw new Error(`Marker non trovato: ${label}`);
  return content.replace(search, replacement);
}

// Collega il nuovo endpoint di selezione del piano al backend già esistente.
let operations = read('src/operations-v2.js');
operations = replaceRequired(
  operations,
  "const { installGuidedChecks } = require('./guided-checks-v2');",
  "const { installGuidedChecks } = require('./guided-checks-v2');\nconst { installSimpleUxV44 } = require('./simple-ux-v44');",
  'import simple ux'
);
operations = replaceRequired(
  operations,
  '  installGuidedChecks(dependencies);',
  '  installGuidedChecks(dependencies);\n  installSimpleUxV44(dependencies);',
  'install simple ux'
);
write('src/operations-v2.js', operations);

// Conserva anche nel database il piano scelto prima della registrazione.
let server = read('server3.js');
server = replaceRequired(
  server,
  "    const password = text(req.body.password, { name: 'Password', required: true, min: 10, max: 200, trim: false });\n    const rawCode = randomToken(32);",
  "    const password = text(req.body.password, { name: 'Password', required: true, min: 10, max: 200, trim: false });\n    const selectedPlan = req.body.selected_plan\n      ? (await getPlan(req.body.selected_plan, pool, true)).id\n      : null;\n    const rawCode = randomToken(32);",
  'registration selected plan validation'
);
server = replaceRequired(
  server,
  "        `INSERT INTO customers(name,email,phone,payment_status) VALUES($1,$2,$3,'unpaid') RETURNING *`,\n        [name, mail, phone],",
  "        `INSERT INTO customers(name,email,phone,current_package_type,payment_status) VALUES($1,$2,$3,$4,'unpaid') RETURNING *`,\n        [name, mail, phone, selectedPlan],",
  'registration selected plan insert'
);
write('server3.js', server);

// Invia selected_plan al server; non deve rimanere soltanto nel browser.
let app = read('public/app.js');
app = app.replace("        delete data.selected_plan;\n", '');
write('public/app.js', app);

// Corregge due dettagli di robustezza nel layer UI aggiuntivo.
let simpleUi = read('public/simple-ui-v44.js');
if (!simpleUi.includes('function cssEscape(value)')) {
  simpleUi = replaceRequired(
    simpleUi,
    "  function money(cents) {",
    "  function cssEscape(value) {\n    const raw = String(value || '');\n    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(raw);\n    return raw.replace(/[^a-zA-Z0-9_-]/g, '');\n  }\n\n  function money(cents) {",
    'css escape helper'
  );
}
simpleUi = simpleUi.replace('CSS.escape(tab)', 'cssEscape(tab)');
if (!simpleUi.includes("if (state.planOverlay?.isConnected) return;")) {
  simpleUi = replaceRequired(
    simpleUi,
    "  async function openPlanGate() {\n    if (state.user?.role !== 'client') return;\n    const data = await clientData();",
    "  async function openPlanGate() {\n    if (state.user?.role !== 'client') return;\n    if (state.planOverlay?.isConnected) return;\n    const data = await clientData();",
    'avoid plan gate mutation loop'
  );
}
write('public/simple-ui-v44.js', simpleUi);

// Aggiorna il documento principale e carica la UX semplificata.
let index = read('public/index.html').replaceAll('v=43', 'v=44');
index = index
  .replaceAll('runtime-stability-v43.js', 'runtime-stability-v44.js')
  .replaceAll('pwa-v43.js', 'pwa-v44.js');
if (!index.includes('/simple-ui-v44.css')) {
  index = replaceRequired(
    index,
    '  <link rel="stylesheet" href="/guided-checks-v2.css?v=44">',
    '  <link rel="stylesheet" href="/guided-checks-v2.css?v=44">\n  <link rel="stylesheet" href="/simple-ui-v44.css?v=44">',
    'simple ui css'
  );
}
if (!index.includes('/simple-ui-v44.js')) {
  index = replaceRequired(
    index,
    '  <script src="/guided-checks-v2.js?v=44" defer></script>',
    '  <script src="/guided-checks-v2.js?v=44" defer></script>\n  <script src="/simple-ui-v44.js?v=44" defer></script>',
    'simple ui js'
  );
}
write('public/index.html', index);

// Versiona service worker, installer e recupero automatico.
let worker = read('public/sw.js')
  .replaceAll('home-care-v43', 'home-care-v44')
  .replaceAll('v=43', 'v=44')
  .replaceAll('runtime-stability-v43.js', 'runtime-stability-v44.js')
  .replaceAll('pwa-v43.js', 'pwa-v44.js');
if (!worker.includes("'/simple-ui-v44.css?v=44'")) {
  worker = replaceRequired(
    worker,
    "  '/guided-checks-v2.css?v=44',",
    "  '/guided-checks-v2.css?v=44',\n  '/simple-ui-v44.css?v=44',",
    'simple css service worker'
  );
}
if (!worker.includes("'/simple-ui-v44.js?v=44'")) {
  worker = replaceRequired(
    worker,
    "  '/guided-checks-v2.js?v=44',",
    "  '/guided-checks-v2.js?v=44',\n  '/simple-ui-v44.js?v=44',",
    'simple js service worker'
  );
}
write('public/sw.js', worker);

let runtime = read('public/runtime-stability-v43.js')
  .replace("const RECOVERY_VERSION = '43';", "const RECOVERY_VERSION = '44';");
runtime = runtime.replace(
  '[data-install-app], .desktop-copy, .hc-notification-button, .hc-notification-count, .hc-notification-panel',
  '[data-install-app], .desktop-copy, .hc-notification-button, .hc-notification-count, .hc-notification-panel, .hc-simple-mobile-nav, .hc-simple-sidebar, .hc-simple-overlay'
);
write('public/runtime-stability-v44.js', runtime);

let installer = read('public/pwa-v43.js')
  .replaceAll('home-care-v43', 'home-care-v44')
  .replace("url.searchParams.set('pwa_reset', '43');", "url.searchParams.set('pwa_reset', '44');");
write('public/pwa-v44.js', installer);
fs.rmSync(filePath('public/runtime-stability-v43.js'), { force: true });
fs.rmSync(filePath('public/pwa-v43.js'), { force: true });

const manifest = JSON.parse(read('public/manifest.json').replaceAll('v=43', 'v=44'));
manifest.start_url = String(manifest.start_url || '/?source=pwa').replace(/app_version=\d+/i, 'app_version=44');
write('public/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);

// Aggiorna versione, controlli sintattici e lockfile (generato dal workflow).
const packageJson = JSON.parse(read('package.json'));
packageJson.version = '1.3.0';
let checkParts = String(packageJson.scripts.check || '').split(' && ').filter(Boolean);
checkParts = checkParts
  .map((part) => part.replace('runtime-stability-v43.js', 'runtime-stability-v44.js'))
  .map((part) => part.replace('pwa-v43.js', 'pwa-v44.js'));
for (const addition of [
  'node --check src/simple-ux-v44.js',
  'node --check public/simple-ui-v44.js',
  'node --check tests/simple-ui-v44.test.js',
]) {
  if (!checkParts.includes(addition)) {
    const validateIndex = checkParts.indexOf('npm run validate:static');
    checkParts.splice(validateIndex >= 0 ? validateIndex : checkParts.length, 0, addition);
  }
}
packageJson.scripts.check = checkParts.join(' && ');
write('package.json', `${JSON.stringify(packageJson, null, 2)}\n`);

// Estende la validazione statica alle nuove regole di usabilità.
let validate = read('scripts/validate-static.js');
validate = validate
  .replaceAll('runtime-stability-v43.js', 'runtime-stability-v44.js')
  .replaceAll('pwa-v43.js', 'pwa-v44.js')
  .replaceAll('home-care-v43', 'home-care-v44')
  .replaceAll('app_version=43', 'app_version=44')
  .replaceAll('v=43', 'v=44');
validate = replaceRequired(
  validate,
  "  'public/operations-v2.css', 'public/guided-checks-v2.js', 'public/guided-checks-v2.css',",
  "  'public/operations-v2.css', 'public/guided-checks-v2.js', 'public/guided-checks-v2.css',\n  'public/simple-ui-v44.js', 'public/simple-ui-v44.css',",
  'simple public required files'
);
validate = replaceRequired(
  validate,
  "  'src/guided-checks-v2.js', 'tests/guided-checks.test.js',",
  "  'src/guided-checks-v2.js', 'tests/guided-checks.test.js',\n  'src/simple-ux-v44.js', 'tests/simple-ui-v44.test.js',",
  'simple backend required files'
);
if (!validate.includes("const simpleUi = read('public/simple-ui-v44.js');")) {
  validate = replaceRequired(
    validate,
    "const guidedBackend = read('src/guided-checks-v2.js');",
    "const guidedBackend = read('src/guided-checks-v2.js');\nconst simpleUi = read('public/simple-ui-v44.js');\nconst simpleCss = read('public/simple-ui-v44.css');\nconst simpleBackend = read('src/simple-ux-v44.js');",
    'simple ui validation readers'
  );
}
if (!validate.includes('simple-ui-v44\\.js\\?v=44')) {
  validate = replaceRequired(
    validate,
    'assert.match(index, /guided-checks-v2\\.js\\?v=44/);',
    'assert.match(index, /guided-checks-v2\\.js\\?v=44/);\nassert.match(index, /simple-ui-v44\\.js\\?v=44/);\nassert.match(index, /simple-ui-v44\\.css\\?v=44/);',
    'simple ui index assertions'
  );
}
if (!validate.includes('assert.match(simpleUi, /Scegli il servizio per la tua casa/)')) {
  validate = replaceRequired(
    validate,
    'assert.match(guidedBackend, /guided_check_item_photos/);',
    "assert.match(guidedBackend, /guided_check_item_photos/);\nassert.match(simpleUi, /Scegli il servizio per la tua casa/);\nassert.match(simpleUi, /Le mie case/);\nassert.match(simpleUi, /Il prossimo passo/);\nassert.match(simpleCss, /\\.hc-simple-mobile-nav/);\nassert.match(simpleBackend, /\\/api\\/client\\/plan-selection/);",
    'simple ui implementation assertions'
  );
}
if (!validate.includes('assert.match(server, /selected_plan/)')) {
  validate = replaceRequired(
    validate,
    'assert.match(server, /check_photos/);',
    'assert.match(server, /check_photos/);\nassert.match(server, /selected_plan/);\nassert.match(server, /current_package_type/);',
    'registration plan assertions'
  );
}
write('scripts/validate-static.js', validate);

console.log('Home Care Simple UI V44 applicata in modo idempotente.');
