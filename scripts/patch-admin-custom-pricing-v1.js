const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const indexPath = path.join(root, 'public', 'index.html');
const serverPath = path.join(root, 'server3.js');
const ADMIN_CUSTOM_PRICING_SCRIPT_VERSION = 1;

function patchIndex() {
  let html = fs.readFileSync(indexPath, 'utf8');
  const script = `<script src="/admin-custom-pricing-v1.js?v=${ADMIN_CUSTOM_PRICING_SCRIPT_VERSION}"></script>`;

  if (!html.includes('/admin-custom-pricing-v1.js')) {
    html = html.replace('<script>\nconst app=', `${script}\n<script>\nconst app=`);
  } else {
    html = html.replace(/<script src="\/admin-custom-pricing-v1\.js(?:\?v=\d+)?"><\/script>/g, script);
  }

  const apply = 'if(window.applyAdminCustomPricingV1)window.applyAdminCustomPricingV1();';
  if (!html.includes('window.applyAdminCustomPricingV1')) {
    html = html.replace('boot();', apply + 'boot();');
  }

  fs.writeFileSync(indexPath, html);
}

function patchServer() {
  let code = fs.readFileSync(serverPath, 'utf8');

  if (!code.includes('custom_monthly_price_cents')) {
    const marker = "app.get('/api/health', (req, res) => res.json({ ok: true, app: 'home-care-pwa' }));";
    const bootstrap = `
async function ensureCustomerCustomPlansTable() {
  await q('ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_package_type_check');
  await q('ALTER TABLE customers ADD COLUMN IF NOT EXISTS custom_monthly_price_cents INTEGER');
  await q('ALTER TABLE customers ADD COLUMN IF NOT EXISTS custom_plan_summary TEXT');
  await q('ALTER TABLE customers ADD COLUMN IF NOT EXISTS current_custom_plan_id UUID');
  await q(` + '`' + `
    CREATE TABLE IF NOT EXISTS customer_custom_plans (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      services_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      base_price_cents INTEGER NOT NULL DEFAULT 0,
      services_total_cents INTEGER NOT NULL DEFAULT 0,
      subtotal_cents INTEGER NOT NULL DEFAULT 0,
      discount_type TEXT NOT NULL DEFAULT 'none',
      discount_value_cents INTEGER NOT NULL DEFAULT 0,
      discount_percent NUMERIC(7,2) NOT NULL DEFAULT 0,
      final_price_cents INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      activated_at TIMESTAMPTZ,
      archived_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  ` + '`' + `);
  await q('CREATE INDEX IF NOT EXISTS idx_customer_custom_plans_customer ON customer_custom_plans(customer_id, status)');
  await q('CREATE INDEX IF NOT EXISTS idx_customer_custom_plans_property ON customer_custom_plans(property_id)');
}

function customPlanSummary(plan) {
  let services = [];
  try { services = Array.isArray(plan.services_json) ? plan.services_json : JSON.parse(plan.services_json || '[]'); } catch (_) {}
  const lines = services.map((item) => '- ' + item.label + ': €' + Number(item.price_euro || 0).toFixed(2));
  return [
    plan.title,
    'Prezzo mensile finale: €' + (Number(plan.final_price_cents || 0) / 100).toFixed(2),
    lines.length ? 'Servizi inclusi:\n' + lines.join('\n') : '',
    plan.notes || ''
  ].filter(Boolean).join('\n');
}

ensureCustomerCustomPlansTable().catch((error) => console.warn('Piani personalizzati cliente non inizializzati:', error.message));

`;
    if (!code.includes(marker)) throw new Error('Marker health non trovato');
    code = code.replace(marker, bootstrap + marker);
  }

  if (!code.includes("app.get('/api/admin/customer-custom-plans'")) {
    const routes = `
app.get('/api/admin/customer-custom-plans', auth(), adminOnly, async (req, res) => {
  await ensureCustomerCustomPlansTable();
  const params = [];
  const where = [];
  if (req.query.customer_id) { params.push(req.query.customer_id); where.push('ccp.customer_id=$' + params.length); }
  const sql = ` + '`' + `SELECT ccp.*,c.name customer_name,c.email customer_email,p.name property_name,p.address property_address
    FROM customer_custom_plans ccp
    JOIN customers c ON c.id=ccp.customer_id
    LEFT JOIN properties p ON p.id=ccp.property_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ccp.created_at DESC` + '`' + `;
  res.json({ plans: (await q(sql, params)).rows });
});

app.post('/api/admin/customer-custom-plans', auth(), adminOnly, async (req, res) => {
  await ensureCustomerCustomPlansTable();
  const customerId = req.body.customer_id;
  if (!customerId) return res.status(400).json({ error: 'Cliente obbligatorio' });
  const title = String(req.body.title || 'Piano personalizzato Home Care').trim();
  const services = Array.isArray(req.body.services) ? req.body.services : [];
  const basePrice = cents(req.body.base_price_euro) || 0;
  const servicesTotal = cents(req.body.services_total_euro) || Math.round(services.reduce((sum, item) => sum + Number(item.price_euro || 0), 0) * 100) + (Math.max(0, Number(req.body.extra_controls || 0)) * (cents(req.body.extra_control_price_euro) || 0));
  const subtotal = cents(req.body.subtotal_euro) || (basePrice + servicesTotal);
  const discountType = ['none','amount','percent'].includes(req.body.discount_type) ? req.body.discount_type : 'none';
  const rawDiscount = Number(String(req.body.discount_value || 0).replace(',', '.')) || 0;
  const discountValueCents = discountType === 'amount' ? Math.max(0, Math.round(rawDiscount * 100)) : 0;
  const discountPercent = discountType === 'percent' ? Math.max(0, Math.min(rawDiscount, 100)) : 0;
  let computedDiscount = discountValueCents;
  if (discountType === 'percent') computedDiscount = Math.round(subtotal * discountPercent / 100);
  computedDiscount = Math.min(computedDiscount, subtotal);
  const finalPrice = cents(req.body.final_price_euro) || Math.max(0, subtotal - computedDiscount);
  if (!finalPrice) return res.status(400).json({ error: 'Prezzo finale non valido' });
  const status = req.body.activate ? 'active' : 'draft';
  const row = (await q(` + '`' + `INSERT INTO customer_custom_plans(customer_id,property_id,title,services_json,base_price_cents,services_total_cents,subtotal_cents,discount_type,discount_value_cents,discount_percent,final_price_cents,notes,status,activated_at)
    VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$13,CASE WHEN $13='active' THEN NOW() ELSE NULL END) RETURNING *` + '`' + `,
    [customerId, req.body.property_id || null, title, JSON.stringify(services), basePrice, servicesTotal, subtotal, discountType, discountValueCents, discountPercent, finalPrice, req.body.notes || null, status]
  )).rows[0];
  if (status === 'active') {
    await q("UPDATE customer_custom_plans SET status='draft',updated_at=NOW() WHERE customer_id=$1 AND id<>$2 AND status='active'", [customerId, row.id]);
    await q("UPDATE customers SET current_package_type='personalizzato',custom_monthly_price_cents=$2,custom_plan_summary=$3,current_custom_plan_id=$4,payment_status='unpaid',updated_at=NOW() WHERE id=$1", [customerId, finalPrice, customPlanSummary(row), row.id]);
    if (req.body.property_id) await q("UPDATE properties SET package_type='personalizzato',monthly_price_cents=$2,request_status='approved',active=TRUE,approved_at=COALESCE(approved_at,NOW()),updated_at=NOW() WHERE id=$1", [req.body.property_id, finalPrice]);
    await q("INSERT INTO messages(customer_id,sender_role,sender_name,body,read_by_client,read_by_admin) VALUES($1,'admin','Home Care',$2,FALSE,TRUE)", [customerId, 'Abbiamo preparato il tuo piano personalizzato Home Care. Prezzo mensile confermato: €' + (finalPrice / 100).toFixed(2) + '. Puoi procedere dall’area Pagamenti.']);
  }
  res.status(201).json({ plan: row });
});

app.post('/api/admin/customer-custom-plans/:id/activate', auth(), adminOnly, async (req, res) => {
  await ensureCustomerCustomPlansTable();
  const plan = (await q('UPDATE customer_custom_plans SET status=$2,activated_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *', [req.params.id, 'active'])).rows[0];
  if (!plan) return res.status(404).json({ error: 'Piano personalizzato non trovato' });
  await q("UPDATE customer_custom_plans SET status='draft',updated_at=NOW() WHERE customer_id=$1 AND id<>$2 AND status='active'", [plan.customer_id, plan.id]);
  await q("UPDATE customers SET current_package_type='personalizzato',custom_monthly_price_cents=$2,custom_plan_summary=$3,current_custom_plan_id=$4,payment_status='unpaid',updated_at=NOW() WHERE id=$1", [plan.customer_id, plan.final_price_cents, customPlanSummary(plan), plan.id]);
  if (plan.property_id) await q("UPDATE properties SET package_type='personalizzato',monthly_price_cents=$2,request_status='approved',active=TRUE,approved_at=COALESCE(approved_at,NOW()),updated_at=NOW() WHERE id=$1", [plan.property_id, plan.final_price_cents]);
  await q("INSERT INTO messages(customer_id,sender_role,sender_name,body,read_by_client,read_by_admin) VALUES($1,'admin','Home Care',$2,FALSE,TRUE)", [plan.customer_id, 'Abbiamo attivato il tuo piano personalizzato Home Care. Prezzo mensile confermato: €' + (Number(plan.final_price_cents || 0) / 100).toFixed(2) + '.']);
  res.json({ plan });
});

app.post('/api/admin/customer-custom-plans/:id/archive', auth(), adminOnly, async (req, res) => {
  await ensureCustomerCustomPlansTable();
  const plan = (await q("UPDATE customer_custom_plans SET status='archived',archived_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *", [req.params.id])).rows[0];
  if (!plan) return res.status(404).json({ error: 'Piano personalizzato non trovato' });
  res.json({ plan });
});

`;
    const marker = "app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));";
    if (!code.includes(marker)) throw new Error('Marker catch-all non trovato');
    code = code.replace(marker, routes + marker);
  }

  const oldMonthly = "const monthlyCents = Number(customMonthly || (usePropertyPrice ? property.monthly_price_cents : cfg.priceCents));";
  const newMonthly = "const customerCustomMonthly = pkg === 'personalizzato' ? Number(customer.custom_monthly_price_cents || 0) : 0;\n  const monthlyCents = Number(customerCustomMonthly || customMonthly || (usePropertyPrice ? property.monthly_price_cents : cfg.priceCents));";
  if (code.includes(oldMonthly) && !code.includes('customerCustomMonthly')) {
    code = code.replace(oldMonthly, newMonthly);
  }

  fs.writeFileSync(serverPath, code);
}

try {
  patchIndex();
  patchServer();
  console.log('Patch piani personalizzati cliente V1 applicata.');
} catch (error) {
  console.warn('Patch piani personalizzati cliente V1 non applicata:', error.message);
}
