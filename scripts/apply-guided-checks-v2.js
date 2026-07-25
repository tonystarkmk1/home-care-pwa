'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

function write(relative, content) {
  fs.writeFileSync(path.join(root, relative), content.endsWith('\n') ? content : `${content}\n`);
}

function replaceRequired(content, search, replacement, label) {
  if (content.includes(replacement)) return content;
  if (!content.includes(search)) throw new Error(`Marker non trovato: ${label}`);
  return content.replace(search, replacement);
}

let operations = read('src/operations-v2.js');
operations = replaceRequired(
  operations,
  "const crypto = require('crypto');",
  "const crypto = require('crypto');\nconst { installGuidedChecks } = require('./guided-checks-v2');",
  'require guided checks'
);
if (!operations.includes('installGuidedChecks(dependencies);')) {
  operations = replaceRequired(
    operations,
    "  async function notifyCustomer(client, customerId, kind, title, body, linkTab, dedupeKey) {",
    "  installGuidedChecks(dependencies);\n\n  async function notifyCustomer(client, customerId, kind, title, body, linkTab, dedupeKey) {",
    'install guided checks'
  );
}
write('src/operations-v2.js', operations);

let schema = read('schema.sql');
if (!schema.includes('-- GUIDED_CHECKS_V2_START')) schema = `${schema.trimEnd()}\n
-- GUIDED_CHECKS_V2_START
CREATE TABLE IF NOT EXISTS property_check_templates (
  property_id UUID PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
  items_json JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(items_json)='array'),
  updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS guided_checks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  started_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  check_id UUID REFERENCES checks(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress','draft','approved','canceled')),
  overall_notes TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_guided_checks_one_open_property
  ON guided_checks(property_id)
  WHERE status IN ('in_progress','draft');
CREATE INDEX IF NOT EXISTS idx_guided_checks_status_updated
  ON guided_checks(status,updated_at DESC);

CREATE TABLE IF NOT EXISTS guided_check_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guided_check_id UUID NOT NULL REFERENCES guided_checks(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  label TEXT NOT NULL,
  checked BOOLEAN NOT NULL DEFAULT FALSE,
  checked_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(guided_check_id,sort_order)
);

CREATE INDEX IF NOT EXISTS idx_guided_check_items_session
  ON guided_check_items(guided_check_id,sort_order);

CREATE TABLE IF NOT EXISTS guided_check_item_photos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guided_check_item_id UUID NOT NULL REFERENCES guided_check_items(id) ON DELETE CASCADE,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
  original_name TEXT,
  size_bytes INTEGER NOT NULL CHECK (size_bytes>0 AND size_bytes<=8388608),
  sha256 TEXT NOT NULL,
  image_data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guided_check_item_photos_item
  ON guided_check_item_photos(guided_check_item_id,created_at);
-- GUIDED_CHECKS_V2_END
\n`;
write('schema.sql', schema);

let index = read('public/index.html').replaceAll('v=41', 'v=42');
if (!index.includes('/guided-checks-v2.css')) {
  index = replaceRequired(
    index,
    '  <link rel="stylesheet" href="/operations-v2.css?v=42">',
    '  <link rel="stylesheet" href="/operations-v2.css?v=42">\n  <link rel="stylesheet" href="/guided-checks-v2.css?v=42">',
    'guided checks css'
  );
}
if (!index.includes('/guided-checks-v2.js')) {
  index = replaceRequired(
    index,
    '  <script src="/operations-v2.js?v=42" defer></script>',
    '  <script src="/operations-v2.js?v=42" defer></script>\n  <script src="/guided-checks-v2.js?v=42" defer></script>',
    'guided checks js'
  );
}
write('public/index.html', index);

let worker = read('public/sw.js')
  .replaceAll('home-care-v41', 'home-care-v42')
  .replaceAll('v=41', 'v=42');
if (!worker.includes("'/guided-checks-v2.css'")) {
  worker = replaceRequired(
    worker,
    "  '/operations-v2.css',",
    "  '/operations-v2.css',\n  '/guided-checks-v2.css',",
    'guided css cache'
  );
}
if (!worker.includes("'/guided-checks-v2.js'")) {
  worker = replaceRequired(
    worker,
    "  '/operations-v2.js',",
    "  '/operations-v2.js',\n  '/guided-checks-v2.js',",
    'guided js cache'
  );
}
write('public/sw.js', worker);

let pwa = read('public/pwa-v2.js')
  .replaceAll('home-care-v41', 'home-care-v42')
  .replace("url.searchParams.set('pwa_reset', '41');", "url.searchParams.set('pwa_reset', '42');");
write('public/pwa-v2.js', pwa);

let manifest = read('public/manifest.json').replaceAll('v=41', 'v=42');
write('public/manifest.json', manifest);

const packageJson = JSON.parse(read('package.json'));
packageJson.version = '1.2.0';
const checkParts = packageJson.scripts.check.split(' && ');
const additions = [
  'node --check src/guided-checks-v2.js',
  'node --check public/guided-checks-v2.js',
  'node --check tests/guided-checks.test.js',
];
for (const addition of additions) {
  if (!checkParts.includes(addition)) {
    const validateIndex = checkParts.indexOf('npm run validate:static');
    checkParts.splice(validateIndex >= 0 ? validateIndex : checkParts.length, 0, addition);
  }
}
packageJson.scripts.check = checkParts.join(' && ');
write('package.json', `${JSON.stringify(packageJson, null, 2)}\n`);

let validate = read('scripts/validate-static.js');
validate = replaceRequired(
  validate,
  "  'public/pwa-v2.js', 'public/operations-v2.js', 'public/operations-v2.css', 'public/sw.js', 'public/manifest.json', 'public/offline.html',",
  "  'public/pwa-v2.js', 'public/operations-v2.js', 'public/operations-v2.css', 'public/guided-checks-v2.js', 'public/guided-checks-v2.css', 'public/sw.js', 'public/manifest.json', 'public/offline.html',\n  'src/guided-checks-v2.js', 'tests/guided-checks.test.js',",
  'required guided files'
);
if (!validate.includes("const guided = read('public/guided-checks-v2.js');")) {
  validate = replaceRequired(
    validate,
    "const operationsCss = read('public/operations-v2.css');",
    "const operationsCss = read('public/operations-v2.css');\nconst guided = read('public/guided-checks-v2.js');\nconst guidedBackend = read('src/guided-checks-v2.js');",
    'read guided files'
  );
}
if (!validate.includes('assert.match(index, /guided-checks-v2')) {
  validate = replaceRequired(
    validate,
    "assert.match(index, /operations-v2\\.css/);",
    "assert.match(index, /operations-v2\\.css/);\nassert.match(index, /guided-checks-v2\\.js/);\nassert.match(index, /guided-checks-v2\\.css/);",
    'guided index assertions'
  );
}
if (!validate.includes('assert.match(guided, /Inizia controllo/)')) {
  validate = replaceRequired(
    validate,
    "assert.match(operationsCss, /\\.action-sheet\\.open/);",
    "assert.match(operationsCss, /\\.action-sheet\\.open/);\nassert.match(guided, /Inizia controllo/);\nassert.match(guided, /Approva e invia report/);\nassert.match(guidedBackend, /property_check_templates/);\nassert.match(guidedBackend, /guided_check_item_photos/);",
    'guided implementation assertions'
  );
}
if (!validate.includes('CREATE TABLE IF NOT EXISTS guided_checks')) {
  validate = replaceRequired(
    validate,
    "assert.match(schema, /home_care_next_available_date/);",
    "assert.match(schema, /home_care_next_available_date/);\nassert.match(schema, /CREATE TABLE IF NOT EXISTS guided_checks/);\nassert.match(schema, /CREATE TABLE IF NOT EXISTS property_check_templates/);",
    'guided schema assertions'
  );
}
write('scripts/validate-static.js', validate);

console.log('Guided Checks V2 applicato in modo idempotente.');
