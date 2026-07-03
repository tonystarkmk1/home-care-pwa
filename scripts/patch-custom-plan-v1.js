const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const indexPath = path.join(root, 'public', 'index.html');
const serverPath = path.join(root, 'server3.js');

function patchIndex() {
  let html = fs.readFileSync(indexPath, 'utf8');

  if (!html.includes('/custom-plan-v1.js')) {
    html = html.replace('<script>\nconst app=', '<script src="/custom-plan-v1.js?v=1"></script>\n<script>\nconst app=');
  }

  if (!html.includes('window.applyCustomPlanV1')) {
    html = html.replace("if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});boot();", "if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});if(window.applyCustomPlanV1)window.applyCustomPlanV1();boot();");
  }

  fs.writeFileSync(indexPath, html);
}

function patchServer() {
  let code = fs.readFileSync(serverPath, 'utf8');

  if (!code.includes("personalizzato: { label: 'Personalizzato'")) {
    code = code.replace(
      "  localita_limitrofe: { label: 'Località Limitrofe', priceCents: 15000, days: 30, from: true },",
      "  personalizzato: { label: 'Personalizzato', priceCents: 3900, days: 30, from: true },\n  localita_limitrofe: { label: 'Personalizzato', priceCents: 3900, days: 30, from: true },"
    );
  }

  if (!code.includes("personalizzato: [\n    'Base obbligatorio")) {
    code = code.replace(
      "  localita_limitrofe: [\n    'Servizio dedicato agli immobili fuori dal comune di Badesi',\n    'Frequenza e attività definite in base alla distanza e ai servizi richiesti',\n    'Report fotografico',\n  ],",
      "  personalizzato: [\n    'Base obbligatorio con 1 controllo mensile incluso',\n    'Servizi aggiuntivi selezionabili dal cliente',\n    'Prezzo finale confermato da Home Care prima dell’attivazione',\n  ],\n  localita_limitrofe: [\n    'Base obbligatorio con 1 controllo mensile incluso',\n    'Servizi aggiuntivi selezionabili dal cliente',\n    'Prezzo finale confermato da Home Care prima dell’attivazione',\n  ],"
    );
  }

  const oldApprove = `app.post('/api/admin/properties/:id/approve', auth(), adminOnly, async (req, res) => {
  const { package_type } = req.body;
  const current = (await q('SELECT * FROM properties WHERE id=$1', [req.params.id])).rows[0];
  if (!current) return res.status(404).json({ error: 'Immobile non trovato' });
  const pkg = package_type || current.package_type || 'base';
  const cfg = packages[pkg] || packages.base;
  const row = (await q("UPDATE properties SET active=TRUE,request_status='approved',package_type=$2,monthly_price_cents=$3,approved_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *", [req.params.id, pkg, cfg.priceCents])).rows[0];
  await q('UPDATE customers SET current_package_type=$2,updated_at=NOW() WHERE id=$1', [row.customer_id, pkg]);
  await q("INSERT INTO messages(customer_id,sender_role,sender_name,body,read_by_client,read_by_admin) VALUES($1,'admin','Home Care',$2,FALSE,TRUE)", [row.customer_id, 'Abbiamo approvato la richiesta per l’immobile: ' + row.name + '.']);
  res.json({ property: row });
});`;

  const newApprove = `app.post('/api/admin/properties/:id/approve', auth(), adminOnly, async (req, res) => {
  const { package_type, monthly_price_euro } = req.body;
  const current = (await q('SELECT * FROM properties WHERE id=$1', [req.params.id])).rows[0];
  if (!current) return res.status(404).json({ error: 'Immobile non trovato' });
  const pkg = package_type || current.package_type || 'base';
  const cfg = packages[pkg] || packages.base;
  const customPrice = cents(monthly_price_euro);
  const monthlyPrice = customPrice || cfg.priceCents;
  const row = (await q("UPDATE properties SET active=TRUE,request_status='approved',package_type=$2,monthly_price_cents=$3,approved_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *", [req.params.id, pkg, monthlyPrice])).rows[0];
  await q('UPDATE customers SET current_package_type=$2,updated_at=NOW() WHERE id=$1', [row.customer_id, pkg]);
  await q("INSERT INTO messages(customer_id,sender_role,sender_name,body,read_by_client,read_by_admin) VALUES($1,'admin','Home Care',$2,FALSE,TRUE)", [row.customer_id, 'Abbiamo approvato la richiesta per l’immobile: ' + row.name + '. Prezzo mensile confermato: €' + (monthlyPrice / 100).toFixed(2) + '.']);
  res.json({ property: row });
});`;

  if (code.includes(oldApprove) && !code.includes('monthly_price_euro')) {
    code = code.replace(oldApprove, newApprove);
  }

  fs.writeFileSync(serverPath, code);
}

try {
  patchIndex();
  patchServer();
  console.log('Patch piano Personalizzato V1 applicata.');
} catch (error) {
  console.warn('Patch piano Personalizzato V1 non applicata:', error.message);
}
