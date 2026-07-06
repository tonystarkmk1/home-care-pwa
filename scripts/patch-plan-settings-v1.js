const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const indexPath = path.join(root, 'public', 'index.html');
const serverPath = path.join(root, 'server3.js');
const PLAN_SETTINGS_SCRIPT_VERSION = 3;

function patchIndex() {
  let html = fs.readFileSync(indexPath, 'utf8');

  if (!html.includes('/plan-settings-v1.js')) {
    html = html.replace('<script>\nconst app=', `<script src="/plan-settings-v1.js?v=${PLAN_SETTINGS_SCRIPT_VERSION}"></script>\n<script>\nconst app=`);
  } else {
    html = html.replace(/\/plan-settings-v1\.js\?v=\d+/g, `/plan-settings-v1.js?v=${PLAN_SETTINGS_SCRIPT_VERSION}`);
  }

  if (!html.includes('window.applyPlanSettingsV1')) {
    html = html.replace('boot();', 'if(window.applyPlanSettingsV1)window.applyPlanSettingsV1();boot();');
  }

  fs.writeFileSync(indexPath, html);
}

function patchServer() {
  let code = fs.readFileSync(serverPath, 'utf8');
  if (code.includes("app.get('/api/public/plan-settings'")) return;

  const routes = `
async function ensurePlanSettingsTable() {
  await q(` + '`' + `
    CREATE TABLE IF NOT EXISTS plan_settings (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      price_cents INTEGER NOT NULL DEFAULT 0,
      price_label TEXT,
      features_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      days INTEGER NOT NULL DEFAULT 30,
      from_price BOOLEAN NOT NULL DEFAULT FALSE,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  ` + '`' + `);

  const defaults = ['base','comfort','premium','villa_giardino','personalizzato'].map((id, index) => {
    const cfg = packages[id] || packages.base;
    const features = checklists[id] || [];
    const priceLabel = cfg.from ? 'da ' + (cfg.priceCents / 100).toFixed(0) + ' €/mese' : (cfg.priceCents / 100).toFixed(0) + ' €/mese';
    return { id, label: cfg.label || id, priceCents: cfg.priceCents || 0, priceLabel, features, days: cfg.days || 30, from: Boolean(cfg.from), sort: index + 1 };
  });

  for (const plan of defaults) {
    await q('INSERT INTO plan_settings(id,label,price_cents,price_label,features_json,days,from_price,active,sort_order) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,TRUE,$8) ON CONFLICT (id) DO NOTHING', [plan.id, plan.label, plan.priceCents, plan.priceLabel, JSON.stringify(plan.features), plan.days, plan.from, plan.sort]);
  }

  await loadPlanSettingsRuntime();
}

async function loadPlanSettingsRuntime() {
  const rows = (await q('SELECT * FROM plan_settings WHERE active=TRUE ORDER BY sort_order ASC, id ASC')).rows;
  for (const row of rows) {
    packages[row.id] = { label: row.label, priceCents: Number(row.price_cents || 0), days: Number(row.days || 30), from: Boolean(row.from_price) };
    checklists[row.id] = Array.isArray(row.features_json) ? row.features_json : [];
  }
}

function serializePlan(row) {
  return {
    id: row.id,
    label: row.label,
    price_cents: Number(row.price_cents || 0),
    price_label: row.price_label || '',
    features: Array.isArray(row.features_json) ? row.features_json : [],
    days: Number(row.days || 30),
    from_price: Boolean(row.from_price),
    active: Boolean(row.active),
    sort_order: Number(row.sort_order || 0),
    updated_at: row.updated_at,
  };
}

app.get('/api/public/plan-settings', async (req, res) => {
  await ensurePlanSettingsTable();
  const rows = (await q('SELECT * FROM plan_settings WHERE active=TRUE ORDER BY sort_order ASC, id ASC')).rows;
  res.json({ plans: rows.map(serializePlan) });
});

app.get('/api/admin/plan-settings', auth(), adminOnly, async (req, res) => {
  await ensurePlanSettingsTable();
  const rows = (await q('SELECT * FROM plan_settings ORDER BY sort_order ASC, id ASC')).rows;
  res.json({ plans: rows.map(serializePlan) });
});

app.patch('/api/admin/plan-settings/:id', auth(), adminOnly, async (req, res) => {
  await ensurePlanSettingsTable();
  const current = (await q('SELECT * FROM plan_settings WHERE id=$1', [req.params.id])).rows[0];
  if (!current) return res.status(404).json({ error: 'Piano non trovato' });
  const label = req.body.label || current.label;
  const priceCents = req.body.price_euro ? cents(req.body.price_euro) : Number(current.price_cents || 0);
  if (!priceCents) return res.status(400).json({ error: 'Prezzo non valido' });
  const priceLabel = req.body.price_label || ((req.body.from_price ? 'da ' : '') + (priceCents / 100).toFixed(0) + ' €/mese');
  const featuresText = String(req.body.features_text || '').trim();
  const features = featuresText ? featuresText.split(/\r?\n/).map((x) => x.trim()).filter(Boolean) : [];
  const row = (await q('UPDATE plan_settings SET label=$2,price_cents=$3,price_label=$4,features_json=$5::jsonb,days=$6,from_price=$7,active=$8,sort_order=$9,updated_at=NOW() WHERE id=$1 RETURNING *', [req.params.id, label, priceCents, priceLabel, JSON.stringify(features), Number(req.body.days || current.days || 30), Boolean(req.body.from_price), Boolean(req.body.active), Number(req.body.sort_order || 0)])).rows[0];
  await loadPlanSettingsRuntime();
  res.json({ plan: serializePlan(row) });
});

ensurePlanSettingsTable().catch((error) => console.warn('Listino piani non inizializzato:', error.message));

`;

  const marker = "app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));";
  if (!code.includes(marker)) throw new Error('Marker catch-all non trovato');
  code = code.replace(marker, routes + marker);
  fs.writeFileSync(serverPath, code);
}

try {
  patchIndex();
  patchServer();
  console.log('Patch Piani/Listino V1 applicata.');
} catch (error) {
  console.warn('Patch Piani/Listino V1 non applicata:', error.message);
}
