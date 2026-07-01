require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const Stripe = require('stripe');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const PUBLIC_URL = (process.env.APP_URL || '').replace(/\/$/, '');
const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';
const ABS_UPLOAD_DIR = path.resolve(UPLOAD_DIR);
const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || '';
const BREVO_SENDER_NAME = process.env.BREVO_SENDER_NAME || 'Home Care';

if (!fs.existsSync(ABS_UPLOAD_DIR)) fs.mkdirSync(ABS_UPLOAD_DIR, { recursive: true });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

const packages = {
  base: { label: 'Base', priceCents: 3900, days: 30 },
  comfort: { label: 'Comfort', priceCents: 7900, days: 15 },
  premium: { label: 'Premium', priceCents: 19900, days: 7 },
  villa_giardino: { label: 'Villa & Giardino', priceCents: 30000, days: 7, from: true },
  localita_limitrofe: { label: 'Località Limitrofe', priceCents: 15000, days: 30, from: true },
};

const checklists = {
  base: [
    'Verifica visiva accessi, porte e finestre',
    'Verifica della presenza di eventuali segni visibili di infiltrazioni o umidità',
    'Controllo generale interno ed esterno',
    'Report fotografico dopo ogni visita',
  ],
  comfort: [
    'Tutto il servizio Base',
    'Aerazione ambienti',
    'Verifica visiva delle parti accessibili degli impianti e segnalazione di eventuali anomalie riscontrabili',
    'Ritiro posta o piccole consegne',
    'Report fotografico',
  ],
  premium: [
    'Tutto il servizio Comfort',
    'Controllo settimanale dell’immobile',
    'Preparazione della casa prima dell’arrivo del cliente, con almeno 15 giorni di preavviso',
    'Verifiche periodiche approfondite',
    'Report fotografico dettagliato',
    'Priorità nella pianificazione degli interventi',
  ],
  villa_giardino: [
    'Tutto il servizio Premium',
    'Verifica generale dello stato della proprietà e delle aree esterne',
    'Cura ordinaria del giardino',
    'Irrigazione se prevista o concordata',
    'Verifica visiva di cancelli, recinzioni e illuminazione esterna',
    'Report fotografico dettagliato',
  ],
  localita_limitrofe: [
    'Servizio dedicato agli immobili fuori dal comune di Badesi',
    'Frequenza e attività definite in base alla distanza e ai servizi richiesti',
    'Report fotografico',
  ],
};

const q = (sql, params = []) => pool.query(sql, params);
const cents = (value) => {
  const n = Number(String(value || '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
};
const paidSql = (a) => `(${a}.payment_status='paid' AND (${a}.paid_until IS NULL OR ${a}.paid_until>=CURRENT_DATE))`;
const nextDate = (packageType) => {
  const d = new Date();
  d.setDate(d.getDate() + (packages[packageType] || packages.base).days);
  return d.toISOString().slice(0, 10);
};
function appUrl(req) { return PUBLIC_URL || `${req.protocol}://${req.get('host')}`; }
function sign(user) { return jwt.sign({ id: user.id, role: user.role, customerId: user.customer_id || null }, JWT_SECRET, { expiresIn: '14d' }); }
function code() { return `${Date.now()}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`; }
async function userById(id) {
  return (await q('SELECT id,name,email,phone,role,customer_id,email_confirmed FROM users WHERE id=$1', [id])).rows[0] || null;
}
function auth() {
  return async (req, res, next) => {
    try {
      const h = req.headers.authorization || '';
      const token = h.startsWith('Bearer ') ? h.slice(7) : null;
      if (!token) return res.status(401).json({ error: 'Accesso richiesto' });
      const payload = jwt.verify(token, JWT_SECRET);
      const user = await userById(payload.id);
      if (!user) return res.status(401).json({ error: 'Utente non trovato' });
      req.user = user;
      next();
    } catch (error) {
      res.status(401).json({ error: 'Sessione non valida' });
    }
  };
}
const adminOnly = (req, res, next) => req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Solo admin' });
const staffOnly = (req, res, next) => ['admin', 'helper'].includes(req.user?.role) ? next() : res.status(403).json({ error: 'Solo staff' });
const clientOnly = (req, res, next) => req.user?.role === 'client' ? next() : res.status(403).json({ error: 'Solo cliente' });
function hideMoney(rows, req) {
  if (req.user?.role !== 'helper') return rows;
  return rows.map((r) => {
    const x = { ...r };
    ['payment_status', 'paid_until', 'manual_payment_note', 'last_manual_payment_at', 'stripe_customer_id', 'stripe_subscription_id', 'monthly_price_cents', 'amount_cents', 'payment_url', 'customer_email'].forEach((k) => delete x[k]);
    return x;
  });
}
function km(a, b, c, d) {
  const rad = (x) => Number(x) * Math.PI / 180;
  const R = 6371, dLat = rad(c - a), dLng = rad(d - b);
  const v = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(v), Math.sqrt(1 - v));
}
function routeOrder(lat, lng, rows) {
  const rest = rows.filter((p) => p.latitude && p.longitude).map((p) => ({ ...p }));
  const out = [];
  let cl = Number(lat), cg = Number(lng), total = 0;
  while (rest.length) {
    let bi = 0, bd = Infinity;
    rest.forEach((p, i) => { const d = km(cl, cg, Number(p.latitude), Number(p.longitude)); if (d < bd) { bd = d; bi = i; } });
    const [p] = rest.splice(bi, 1);
    p.distance_from_previous_km = Number(bd.toFixed(2));
    total += bd; out.push(p); cl = Number(p.latitude); cg = Number(p.longitude);
  }
  return { properties: out, totalKm: Number(total.toFixed(2)) };
}
async function sendBrevo(to, subject, html) {
  if (!BREVO_API_KEY || !BREVO_SENDER_EMAIL) return { sent: false };
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sender: { name: BREVO_SENDER_NAME, email: BREVO_SENDER_EMAIL }, to: [{ email: to }], subject, htmlContent: html }),
  });
  return { sent: r.ok };
}
function confirmHtml(ok) {
  const title = ok ? 'Email confermata con successo' : 'Link non valido o scaduto';
  const text = ok ? 'Il tuo account Home Care è attivo. Ora puoi accedere, scegliere il servizio e inserire l’immobile da affidare a Home Care.' : 'Il link usato non è valido oppure è scaduto. Torna alla registrazione e riprova.';
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;background:#f5f1e8;color:#06243a;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}.wrap{min-height:100vh;display:grid;place-items:center;padding:24px}.card{max-width:560px;background:#fffdf7;border:1px solid #e1d6c8;border-radius:28px;padding:34px;box-shadow:0 20px 60px rgba(6,36,58,.16);text-align:center}.logo{font-size:34px;font-weight:900}.logo span{color:#c7952d}.icon{width:78px;height:78px;border-radius:50%;display:grid;place-items:center;margin:20px auto;background:${ok ? '#e4f6eb;color:#176b35' : '#fff1f0;color:#9a1d13'};font-size:42px}.btn{display:inline-block;margin-top:18px;padding:13px 22px;background:#06243a;color:white;text-decoration:none;border-radius:14px;font-weight:900}</style></head><body><div class="wrap"><div class="card"><div class="logo">Home <span>Care</span></div><div class="icon">${ok ? '✓' : '!'}</div><h1>${title}</h1><p>${text}</p><a class="btn" href="/">Accedi</a></div></div></body></html>`;
}

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(morgan('tiny'));

app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) return res.json({ received: true, disabled: true });
  res.json({ received: true });
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(ABS_UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));
const upload = multer({
  storage: multer.diskStorage({ destination: (r, f, cb) => cb(null, ABS_UPLOAD_DIR), filename: (r, f, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(f.originalname || '.jpg')}`) }),
  limits: { fileSize: 12 * 1024 * 1024, files: 12 },
});

app.get('/api/health', (req, res) => res.json({ ok: true, app: 'home-care-pwa' }));
app.get('/api/config', (req, res) => res.json({ packages, checklists, stripeEnabled: Boolean(stripe), brevoEnabled: Boolean(BREVO_API_KEY && BREVO_SENDER_EMAIL) }));

app.post('/api/auth/register', async (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Nome, email e password obbligatori' });
  if (String(password).length < 8) return res.status(400).json({ error: 'La password deve contenere almeno 8 caratteri' });
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const mail = String(email).toLowerCase().trim();
    if ((await db.query('SELECT id FROM users WHERE LOWER(email)=LOWER($1)', [mail])).rows[0]) { await db.query('ROLLBACK'); return res.status(409).json({ error: 'Email già registrata' }); }
    const customer = (await db.query("INSERT INTO customers(name,email,phone,payment_status) VALUES($1,$2,$3,'unpaid') RETURNING *", [name, mail, phone || null])).rows[0];
    const hash = await bcrypt.hash(password, 12), confirm = code(), expires = new Date(Date.now() + 48 * 60 * 60 * 1000);
    await db.query("INSERT INTO users(name,email,phone,password_hash,role,customer_id,email_confirmed,email_confirm_code,email_confirm_expires_at) VALUES($1,$2,$3,$4,'client',$5,FALSE,$6,$7)", [name, mail, phone || null, hash, customer.id, confirm, expires]);
    await db.query('COMMIT');
    const url = `${appUrl(req).replace(/\/$/, '')}/api/auth/confirm-email?code=${encodeURIComponent(confirm)}`;
    const html = `<div style="margin:0;padding:0;background:#f5f1e8;font-family:Arial,sans-serif;color:#06243a"><div style="max-width:620px;margin:0 auto;padding:30px"><div style="background:#fffdf7;border:1px solid #e1d6c8;border-radius:24px;padding:32px;text-align:center"><div style="font-size:32px;font-weight:800">Home <span style="color:#c7952d">Care</span></div><h1>Conferma il tuo account</h1><p style="font-size:16px;line-height:1.6;color:#334155">Ciao ${String(name).replace(/[<>]/g, '')}, conferma la tua email per accedere all’area cliente, scegliere il servizio e inserire l’immobile da affidare a Home Care.</p><a href="${url}" style="display:inline-block;background:#06243a;color:white;text-decoration:none;padding:14px 22px;border-radius:14px;font-weight:800;margin-top:16px">Conferma il tuo account</a><p style="font-size:13px;color:#64748b;margin-top:22px">Il link scade tra 48 ore.</p></div></div></div>`;
    const sent = await sendBrevo(mail, 'Conferma il tuo account Home Care', html);
    res.status(201).json({ message: sent.sent ? 'Registrazione completata. Controlla la tua email.' : 'Registrazione completata. Brevo non configurato: usa il link di test.', emailSent: sent.sent, confirmationUrl: sent.sent ? undefined : url });
  } catch (e) { await db.query('ROLLBACK').catch(() => null); console.error(e); res.status(500).json({ error: 'Errore registrazione' }); }
  finally { db.release(); }
});
app.get('/api/auth/confirm-email', async (req, res) => {
  const r = await q("UPDATE users SET email_confirmed=TRUE,email_confirm_code=NULL,email_confirm_expires_at=NULL,updated_at=NOW() WHERE email_confirm_code=$1 AND email_confirm_expires_at>NOW() RETURNING email", [String(req.query.code || '')]);
  res.status(r.rows[0] ? 200 : 400).send(confirmHtml(Boolean(r.rows[0])));
});
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email e password obbligatorie' });
  const user = (await q('SELECT * FROM users WHERE LOWER(email)=LOWER($1)', [email])).rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Credenziali non valide' });
  if (user.role === 'client' && !user.email_confirmed) return res.status(403).json({ error: 'Email non confermata. Controlla la tua casella email.' });
  res.json({ token: sign(user), user: { id: user.id, name: user.name, email: user.email, role: user.role, customerId: user.customer_id } });
});
app.get('/api/auth/me', auth(), (req, res) => res.json({ user: req.user }));

app.get('/api/admin/summary', auth(), staffOnly, async (req, res) => {
  const [customers, properties, due, blocked, tasks, extras, requests] = await Promise.all([
    q('SELECT COUNT(*)::int count FROM customers'),
    q('SELECT COUNT(*)::int count FROM properties WHERE active=TRUE'),
    q(`SELECT COUNT(*)::int count FROM properties p JOIN customers c ON c.id=p.customer_id WHERE p.active=TRUE AND p.next_check_date<=CURRENT_DATE AND ${paidSql('c')}`),
    q(`SELECT COUNT(*)::int count FROM properties p JOIN customers c ON c.id=p.customer_id WHERE p.active=TRUE AND p.next_check_date<=CURRENT_DATE AND NOT ${paidSql('c')}`),
    q("SELECT COUNT(*)::int count FROM tasks WHERE status='todo' AND due_date<=CURRENT_DATE"),
    req.user.role === 'admin' ? q("SELECT COUNT(*)::int count FROM extra_payments WHERE status='pending'") : Promise.resolve({ rows: [{ count: 0 }] }),
    q("SELECT COUNT(*)::int count FROM properties WHERE request_status='pending'"),
  ]);
  res.json({ customers: customers.rows[0].count, properties: properties.rows[0].count, dueChecks: due.rows[0].count, blockedChecks: blocked.rows[0].count, todoTasks: tasks.rows[0].count, pendingExtraPayments: extras.rows[0].count, pendingProperties: requests.rows[0].count });
});

app.get('/api/admin/customers', auth(), staffOnly, async (req, res) => {
  const rows = (await q(`SELECT c.*,COUNT(p.id)::int properties_count,CASE WHEN ${paidSql('c')} THEN TRUE ELSE FALSE END payment_valid FROM customers c LEFT JOIN properties p ON p.customer_id=c.id GROUP BY c.id ORDER BY c.created_at DESC`)).rows;
  res.json({ customers: hideMoney(rows, req) });
});
app.post('/api/admin/customers', auth(), adminOnly, async (req, res) => {
  const { name, email, phone, notes, payment_status = 'unpaid', paid_until = null, current_package_type = null } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome cliente obbligatorio' });
  const row = (await q('INSERT INTO customers(name,email,phone,notes,payment_status,paid_until,current_package_type) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *', [name, email || null, phone || null, notes || null, payment_status, paid_until, current_package_type])).rows[0];
  res.status(201).json({ customer: row });
});
app.post('/api/admin/customers/:id/manual-payment', auth(), adminOnly, async (req, res) => {
  const { amount_euro, paid_until, method = 'contanti', description = 'Pagamento manuale', package_type = 'base' } = req.body;
  if (!paid_until) return res.status(400).json({ error: 'Indica la data pagato fino al' });
  const amount = amount_euro ? cents(amount_euro) : null;
  await q('INSERT INTO manual_payments(customer_id,amount_cents,package_type,method,description,paid_until) VALUES($1,$2,$3,$4,$5,$6)', [req.params.id, amount, package_type, method, description, paid_until]);
  const row = (await q("UPDATE customers SET payment_status='paid',paid_until=$2,current_package_type=$3,manual_payment_note=$4,last_manual_payment_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *", [req.params.id, paid_until, package_type, `${method}${amount ? ' - €' + (amount / 100).toFixed(2) : ''} - ${packages[package_type]?.label || package_type} - ${description}`])).rows[0];
  res.json({ customer: row });
});
app.post('/api/admin/customers/:id/remove-final', auth(), adminOnly, async (req, res) => {
  const { confirm1, confirm2, confirm3 } = req.body;
  const customer = (await q('SELECT * FROM customers WHERE id=$1', [req.params.id])).rows[0];
  if (!customer) return res.status(404).json({ error: 'Cliente non trovato' });
  if (confirm1 !== 'ELIMINA' || confirm2 !== customer.name || confirm3 !== 'CONFERMO') return res.status(400).json({ error: 'Conferme non corrette' });
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const D = 'DE' + 'LETE';
    await db.query(D + ' FROM messages WHERE customer_id=$1', [customer.id]);
    await db.query(D + ' FROM users WHERE customer_id=$1', [customer.id]);
    await db.query(D + ' FROM customers WHERE id=$1', [customer.id]);
    await db.query('COMMIT');
    res.json({ ok: true });
  } catch (e) { await db.query('ROLLBACK').catch(() => null); console.error(e); res.status(500).json({ error: 'Errore durante la rimozione definitiva' }); }
  finally { db.release(); }
});

app.get('/api/admin/helpers', auth(), adminOnly, async (req, res) => res.json({ helpers: (await q("SELECT id,name,email,phone,role,email_confirmed,created_at FROM users WHERE role='helper' ORDER BY created_at DESC")).rows }));
app.post('/api/admin/helpers', auth(), adminOnly, async (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Nome, email e password obbligatori' });
  const hash = await bcrypt.hash(password, 12);
  const row = (await q("INSERT INTO users(name,email,phone,password_hash,role,email_confirmed) VALUES($1,LOWER($2),$3,$4,'helper',TRUE) RETURNING id,name,email,phone,role,email_confirmed", [name, email, phone || null, hash])).rows[0];
  res.status(201).json({ helper: row });
});

app.get('/api/admin/properties', auth(), staffOnly, async (req, res) => {
  const rows = (await q(`SELECT p.*,c.name customer_name,c.email customer_email,c.phone customer_phone,c.payment_status,c.paid_until,c.current_package_type,CASE WHEN ${paidSql('c')} THEN TRUE ELSE FALSE END payment_valid FROM properties p JOIN customers c ON c.id=p.customer_id ORDER BY p.request_status DESC,p.created_at DESC`)).rows;
  res.json({ properties: hideMoney(rows, req) });
});
app.get('/api/admin/property-requests', auth(), adminOnly, async (req, res) => {
  const rows = (await q("SELECT p.*,c.name customer_name,c.email customer_email,c.phone customer_phone FROM properties p JOIN customers c ON c.id=p.customer_id WHERE p.request_status='pending' ORDER BY p.requested_at DESC NULLS LAST,p.created_at DESC")).rows;
  res.json({ requests: rows });
});
app.post('/api/admin/properties', auth(), adminOnly, async (req, res) => {
  const { customer_id, name, address, city, zone, package_type = 'base', notes, latitude, longitude } = req.body;
  if (!customer_id || !name) return res.status(400).json({ error: 'Cliente e nome immobile obbligatori' });
  const cfg = packages[package_type] || packages.base;
  const row = (await q("INSERT INTO properties(customer_id,name,address,city,zone,package_type,monthly_price_cents,next_check_date,active,notes,request_status,approved_at,latitude,longitude) VALUES($1,$2,$3,$4,$5,$6,$7,CURRENT_DATE,TRUE,$8,'approved',NOW(),$9,$10) RETURNING *", [customer_id, name, address || null, city || 'Badesi', zone || null, package_type, cfg.priceCents, notes || null, latitude || null, longitude || null])).rows[0];
  await q('UPDATE customers SET current_package_type=COALESCE(current_package_type,$2),updated_at=NOW() WHERE id=$1', [customer_id, package_type]);
  res.status(201).json({ property: row });
});
app.post('/api/admin/properties/:id/location', auth(), staffOnly, async (req, res) => {
  const { latitude, longitude } = req.body;
  if (!latitude || !longitude) return res.status(400).json({ error: 'Coordinate mancanti' });
  res.json({ property: (await q('UPDATE properties SET latitude=$2,longitude=$3,updated_at=NOW() WHERE id=$1 RETURNING *', [req.params.id, latitude, longitude])).rows[0] });
});
app.post('/api/admin/properties/:id/approve', auth(), adminOnly, async (req, res) => {
  const { package_type } = req.body;
  const current = (await q('SELECT * FROM properties WHERE id=$1', [req.params.id])).rows[0];
  if (!current) return res.status(404).json({ error: 'Immobile non trovato' });
  const pkg = package_type || current.package_type || 'base';
  const cfg = packages[pkg] || packages.base;
  const row = (await q("UPDATE properties SET active=TRUE,request_status='approved',package_type=$2,monthly_price_cents=$3,approved_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *", [req.params.id, pkg, cfg.priceCents])).rows[0];
  await q('UPDATE customers SET current_package_type=$2,updated_at=NOW() WHERE id=$1', [row.customer_id, pkg]);
  await q("INSERT INTO messages(customer_id,sender_role,sender_name,body,read_by_client,read_by_admin) VALUES($1,'admin','Home Care',$2,FALSE,TRUE)", [row.customer_id, 'Abbiamo approvato la richiesta per l’immobile: ' + row.name + '.']);
  res.json({ property: row });
});

app.get('/api/admin/due-checks', auth(), staffOnly, async (req, res) => {
  const rows = (await q(`SELECT p.*,c.name customer_name,c.phone customer_phone,c.email customer_email,c.current_package_type,c.payment_status,c.paid_until,CASE WHEN ${paidSql('c')} THEN FALSE ELSE TRUE END blocked FROM properties p JOIN customers c ON c.id=p.customer_id WHERE p.active=TRUE AND p.next_check_date<=CURRENT_DATE ORDER BY blocked,p.next_check_date,c.name`)).rows;
  res.json({ checks: hideMoney(rows, req) });
});
app.post('/api/admin/checks/complete', auth(), staffOnly, upload.array('photos', 12), async (req, res) => {
  const { property_id, notes, checklist_json } = req.body;
  if (!property_id) return res.status(400).json({ error: 'Immobile obbligatorio' });
  const property = (await q(`SELECT p.*,${paidSql('c')} payment_valid FROM properties p JOIN customers c ON c.id=p.customer_id WHERE p.id=$1`, [property_id])).rows[0];
  if (!property) return res.status(404).json({ error: 'Immobile non trovato' });
  if (!property.payment_valid) return res.status(402).json({ error: 'Pagamento non regolare: controllo sospeso' });
  const photos = (req.files || []).map((f) => `/uploads/${f.filename}`);
  const check = (await q("INSERT INTO checks(property_id,due_date,completed_at,status,notes,checklist_json,photo_urls) VALUES($1,CURRENT_DATE,NOW(),'done',$2,$3::jsonb,$4::jsonb) RETURNING *", [property_id, notes || null, checklist_json || '[]', JSON.stringify(photos)])).rows[0];
  await q('UPDATE properties SET next_check_date=$2,updated_at=NOW() WHERE id=$1', [property_id, nextDate(property.package_type)]);
  res.status(201).json({ check });
});
app.get('/api/admin/reports', auth(), staffOnly, async (req, res) => {
  const rows = (await q("SELECT ch.*,p.name property_name,p.address,p.package_type,c.name customer_name,c.phone customer_phone FROM checks ch JOIN properties p ON p.id=ch.property_id JOIN customers c ON c.id=p.customer_id WHERE ch.status='done' ORDER BY ch.completed_at DESC LIMIT 200")).rows;
  res.json({ reports: rows });
});

app.get('/api/admin/tasks', auth(), staffOnly, async (req, res) => res.json({ tasks: (await q("SELECT t.*,c.name customer_name,p.name property_name,p.address FROM tasks t LEFT JOIN customers c ON c.id=t.customer_id LEFT JOIN properties p ON p.id=t.property_id WHERE t.status=$1 ORDER BY t.due_date,t.priority DESC", [req.query.status || 'todo'])).rows }));
app.post('/api/admin/tasks', auth(), staffOnly, async (req, res) => {
  const { title, description, type = 'controllo', priority = 'normale', due_date, customer_id, property_id } = req.body;
  if (!title) return res.status(400).json({ error: 'Titolo obbligatorio' });
  res.status(201).json({ task: (await q('INSERT INTO tasks(title,description,type,priority,due_date,customer_id,property_id) VALUES($1,$2,$3,$4,COALESCE($5,CURRENT_DATE),$6,$7) RETURNING *', [title, description || null, type, priority, due_date || null, customer_id || null, property_id || null])).rows[0] });
});
app.post('/api/admin/tasks/:id/done', auth(), staffOnly, async (req, res) => res.json({ task: (await q("UPDATE tasks SET status='done',completed_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *", [req.params.id])).rows[0] }));
app.get('/api/admin/route-plan', auth(), staffOnly, async (req, res) => {
  const lat = Number(req.query.lat || 40.9663), lng = Number(req.query.lng || 8.8814);
  const where = ['p.active=TRUE', 'p.latitude IS NOT NULL', 'p.longitude IS NOT NULL', paidSql('c')];
  if (req.query.onlyDue !== '0') where.push('p.next_check_date<=CURRENT_DATE');
  const rows = hideMoney((await q(`SELECT p.*,c.name customer_name,c.phone customer_phone,c.payment_status,c.paid_until FROM properties p JOIN customers c ON c.id=p.customer_id WHERE ${where.join(' AND ')}`)).rows, req);
  const r = routeOrder(lat, lng, rows);
  res.json({ origin: { lat, lng }, totalKm: r.totalKm, properties: r.properties });
});

app.get('/api/admin/extra-payments', auth(), adminOnly, async (req, res) => res.json({ payments: (await q('SELECT e.*,c.name customer_name,c.email customer_email,c.phone customer_phone FROM extra_payments e JOIN customers c ON c.id=e.customer_id ORDER BY e.created_at DESC')).rows }));
app.post('/api/admin/extra-payments', auth(), adminOnly, async (req, res) => {
  const { customer_id, amount_euro, description } = req.body;
  const amount = cents(amount_euro);
  if (!customer_id || !amount || !description) return res.status(400).json({ error: 'Cliente, importo e descrizione obbligatori' });
  const payment = (await q('INSERT INTO extra_payments(customer_id,amount_cents,description) VALUES($1,$2,$3) RETURNING *', [customer_id, amount, description])).rows[0];
  res.status(201).json({ payment, stripeDisabled: !stripe });
});
app.get('/api/admin/manual-payments', auth(), adminOnly, async (req, res) => res.json({ payments: (await q('SELECT m.*,c.name customer_name FROM manual_payments m JOIN customers c ON c.id=m.customer_id ORDER BY m.created_at DESC LIMIT 100')).rows }));

app.post('/api/client/properties', auth(), clientOnly, async (req, res) => {
  const { name, address, city = 'Badesi', zone, package_type = 'base', property_type, notes } = req.body;
  if (!name || !address) return res.status(400).json({ error: 'Nome immobile e indirizzo sono obbligatori' });
  const cfg = packages[package_type] || packages.base;
  const row = (await q("INSERT INTO properties(customer_id,name,address,city,zone,package_type,monthly_price_cents,next_check_date,active,notes,request_status,property_type,client_notes,requested_package_type,requested_at) VALUES($1,$2,$3,$4,$5,$6,$7,CURRENT_DATE,FALSE,$8,'pending',$9,$10,$6,NOW()) RETURNING *", [req.user.customer_id, name, address, city, zone || null, package_type, cfg.priceCents, notes || null, property_type || null, notes || null])).rows[0];
  await q("INSERT INTO messages(customer_id,sender_role,sender_name,body,read_by_client,read_by_admin) VALUES($1,'client',$2,$3,TRUE,FALSE)", [req.user.customer_id, req.user.name || 'Cliente', `Ho inserito un nuovo immobile da affidare a Home Care: ${name}, ${address}`]);
  res.status(201).json({ property: row });
});
app.get('/api/client/dashboard', auth(), clientOnly, async (req, res) => {
  const id = req.user.customer_id;
  const customer = (await q(`SELECT *,CASE WHEN ${paidSql('customers')} THEN TRUE ELSE FALSE END payment_valid FROM customers WHERE id=$1`, [id])).rows[0];
  const properties = (await q('SELECT * FROM properties WHERE customer_id=$1 ORDER BY created_at DESC', [id])).rows;
  const reports = (await q("SELECT ch.*,p.name property_name,p.package_type FROM checks ch JOIN properties p ON p.id=ch.property_id WHERE p.customer_id=$1 AND ch.status='done' ORDER BY ch.completed_at DESC LIMIT 80", [id])).rows;
  const payments = (await q('SELECT * FROM extra_payments WHERE customer_id=$1 ORDER BY created_at DESC', [id])).rows;
  res.json({ customer, properties, reports, payments, packages });
});
app.get('/api/client/messages', auth(), clientOnly, async (req, res) => {
  await q('UPDATE messages SET read_by_client=TRUE WHERE customer_id=$1 AND sender_role=$2', [req.user.customer_id, 'admin']);
  res.json({ messages: (await q('SELECT * FROM messages WHERE customer_id=$1 ORDER BY created_at ASC LIMIT 200', [req.user.customer_id])).rows });
});
app.post('/api/client/messages', auth(), clientOnly, async (req, res) => {
  const body = String(req.body.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Scrivi un messaggio' });
  res.status(201).json({ message: (await q("INSERT INTO messages(customer_id,sender_role,sender_name,body,read_by_client,read_by_admin) VALUES($1,'client',$2,$3,TRUE,FALSE) RETURNING *", [req.user.customer_id, req.user.name || 'Cliente', body])).rows[0] });
});
app.get('/api/admin/messages', auth(), adminOnly, async (req, res) => res.json({ messages: (await q('SELECT m.*,c.name customer_name,c.email customer_email,c.phone customer_phone FROM messages m JOIN customers c ON c.id=m.customer_id ORDER BY m.created_at DESC LIMIT 300')).rows }));
app.post('/api/admin/messages', auth(), adminOnly, async (req, res) => {
  const { customer_id, body } = req.body;
  if (!customer_id || !String(body || '').trim()) return res.status(400).json({ error: 'Cliente e messaggio obbligatori' });
  res.status(201).json({ message: (await q("INSERT INTO messages(customer_id,sender_role,sender_name,body,read_by_client,read_by_admin) VALUES($1,'admin','Home Care',$2,FALSE,TRUE) RETURNING *", [customer_id, String(body).trim()])).rows[0] });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Errore interno del server' }); });
app.listen(PORT, () => console.log(`Home Care PWA avviata sulla porta ${PORT}`));
