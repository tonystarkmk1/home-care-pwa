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
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';
const ABS_UPLOAD_DIR = path.resolve(UPLOAD_DIR);

if (!fs.existsSync(ABS_UPLOAD_DIR)) fs.mkdirSync(ABS_UPLOAD_DIR, { recursive: true });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

const packageConfig = {
  base: { label: 'Base', priceCents: 3900, days: 30, color: '#2563eb' },
  comfort: { label: 'Comfort', priceCents: 7900, days: 15, color: '#059669' },
  premium: { label: 'Premium', priceCents: 19900, days: 7, color: '#7c3aed' },
  villa_giardino: { label: 'Villa & Giardino', priceCents: 30000, days: 7, from: true, color: '#d97706' },
  localita_limitrofe: { label: 'Località Limitrofe', priceCents: 15000, days: 30, from: true, color: '#be123c' },
};

const CHECKLISTS = {
  base: [
    'Verifica visiva accessi, porte e finestre',
    'Verifica della presenza di eventuali segni visibili di infiltrazioni o umidità',
    'Report fotografico',
  ],
  comfort: [
    'Verifica visiva accessi, porte e finestre',
    'Aerazione ambienti',
    'Verifica visiva delle parti accessibili degli impianti e segnalazione di eventuali anomalie riscontrabili',
    'Ritiro posta o piccole consegne',
    'Report fotografico',
  ],
  premium: [
    'Controllo settimanale dell’immobile',
    'Preparazione della casa prima dell’arrivo del cliente, con almeno 15 giorni di preavviso',
    'Verifiche periodiche approfondite',
    'Report fotografico dettagliato',
    'Priorità nella pianificazione degli interventi',
  ],
  villa_giardino: [
    'Controllo settimanale dell’immobile',
    'Verifica generale dello stato della proprietà e delle aree esterne',
    'Cura ordinaria giardino e spazi esterni',
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

function euro(cents) {
  return Number(cents || 0) / 100;
}

function toIntCents(value) {
  const numeric = Number(String(value || '').replace(',', '.'));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.round(numeric * 100);
}

function nextCheckDate(packageType, from = new Date()) {
  const cfg = packageConfig[packageType] || packageConfig.base;
  const d = new Date(from);
  d.setDate(d.getDate() + cfg.days);
  return d.toISOString().slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function paymentIsValidSql(alias = 'c') {
  return `(${alias}.payment_status = 'paid' AND (${alias}.paid_until IS NULL OR ${alias}.paid_until >= CURRENT_DATE))`;
}

function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role, customerId: user.customer_id || null }, JWT_SECRET, { expiresIn: '14d' });
}

async function query(sql, params = []) {
  return pool.query(sql, params);
}

async function getUserById(id) {
  const { rows } = await query('SELECT id, name, email, phone, role, customer_id FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

function auth(required = true) {
  return async (req, res, next) => {
    try {
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : null;
      if (!token) {
        if (!required) return next();
        return res.status(401).json({ error: 'Accesso richiesto' });
      }
      const payload = jwt.verify(token, JWT_SECRET);
      const user = await getUserById(payload.id);
      if (!user) return res.status(401).json({ error: 'Utente non trovato' });
      req.user = user;
      next();
    } catch (error) {
      return res.status(401).json({ error: 'Token non valido' });
    }
  };
}

function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Solo admin' });
  next();
}

function clientOnly(req, res, next) {
  if (!req.user || req.user.role !== 'client') return res.status(403).json({ error: 'Solo cliente' });
  next();
}

function haversineKm(aLat, aLng, bLat, bLng) {
  const toRad = (v) => (Number(v) * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function sortNearest(originLat, originLng, properties) {
  const remaining = properties.filter((p) => p.latitude && p.longitude).map((p) => ({ ...p }));
  const ordered = [];
  let currentLat = Number(originLat);
  let currentLng = Number(originLng);
  let totalKm = 0;
  while (remaining.length) {
    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < remaining.length; i += 1) {
      const p = remaining[i];
      const dist = haversineKm(currentLat, currentLng, Number(p.latitude), Number(p.longitude));
      if (dist < bestDistance) {
        bestDistance = dist;
        bestIndex = i;
      }
    }
    const [best] = remaining.splice(bestIndex, 1);
    best.distance_from_previous_km = Number(bestDistance.toFixed(2));
    totalKm += bestDistance;
    ordered.push(best);
    currentLat = Number(best.latitude);
    currentLng = Number(best.longitude);
  }
  return { ordered, totalKm: Number(totalKm.toFixed(2)) };
}

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(morgan('tiny'));

// Stripe richiede raw body sul webhook prima di express.json().
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) return res.status(200).json({ received: true, disabled: true });
  let event;
  try {
    const sig = req.headers['stripe-signature'];
    if (process.env.STRIPE_WEBHOOK_SECRET) {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } else {
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    console.error('Stripe webhook non valido:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const kind = session.metadata?.kind;
      if (kind === 'extra_payment' && session.metadata?.extraPaymentId) {
        await query(
          `UPDATE extra_payments SET status = 'paid', paid_at = NOW(), updated_at = NOW(), stripe_session_id = COALESCE(stripe_session_id, $2)
           WHERE id = $1`,
          [session.metadata.extraPaymentId, session.id]
        );
      }
      if (kind === 'subscription' && session.metadata?.customerId) {
        await query(
          `UPDATE customers SET payment_status = 'paid', paid_until = NULL, stripe_customer_id = COALESCE(stripe_customer_id, $2), stripe_subscription_id = COALESCE(stripe_subscription_id, $3), updated_at = NOW()
           WHERE id = $1`,
          [session.metadata.customerId, session.customer, session.subscription]
        );
      }
    }

    if (event.type === 'invoice.paid') {
      const invoice = event.data.object;
      if (invoice.customer) {
        await query(`UPDATE customers SET payment_status = 'paid', updated_at = NOW() WHERE stripe_customer_id = $1`, [invoice.customer]);
      }
    }

    if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object;
      if (invoice.customer) {
        await query(`UPDATE customers SET payment_status = 'past_due', updated_at = NOW() WHERE stripe_customer_id = $1`, [invoice.customer]);
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      await query(`UPDATE customers SET payment_status = 'canceled', updated_at = NOW() WHERE stripe_subscription_id = $1`, [sub.id]);
    }

    res.json({ received: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Errore gestione webhook' });
  }
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(ABS_UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, ABS_UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 12 * 1024 * 1024, files: 12 } });

app.get('/api/health', (req, res) => res.json({ ok: true, app: 'home-care-pwa' }));
app.get('/api/config', (req, res) => res.json({ packages: packageConfig, checklists: CHECKLISTS, stripeEnabled: Boolean(stripe) }));

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email e password obbligatorie' });
  const { rows } = await query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email]);
  const user = rows[0];
  if (!user) return res.status(401).json({ error: 'Credenziali non valide' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Credenziali non valide' });
  res.json({ token: signToken(user), user: { id: user.id, name: user.name, email: user.email, role: user.role, customerId: user.customer_id } });
});

app.get('/api/auth/me', auth(), async (req, res) => res.json({ user: req.user }));

app.get('/api/admin/summary', auth(), adminOnly, async (req, res) => {
  const validPayment = paymentIsValidSql('c');
  const [customers, properties, due, blocked, tasks, extra] = await Promise.all([
    query('SELECT COUNT(*)::int AS count FROM customers'),
    query('SELECT COUNT(*)::int AS count FROM properties WHERE active = TRUE'),
    query(`SELECT COUNT(*)::int AS count FROM properties p JOIN customers c ON c.id = p.customer_id WHERE p.active = TRUE AND p.next_check_date <= CURRENT_DATE AND ${validPayment}`),
    query(`SELECT COUNT(*)::int AS count FROM properties p JOIN customers c ON c.id = p.customer_id WHERE p.active = TRUE AND p.next_check_date <= CURRENT_DATE AND NOT ${validPayment}`),
    query(`SELECT COUNT(*)::int AS count FROM tasks WHERE status = 'todo' AND due_date <= CURRENT_DATE`),
    query(`SELECT COUNT(*)::int AS count FROM extra_payments WHERE status = 'pending'`),
  ]);
  res.json({
    customers: customers.rows[0].count,
    properties: properties.rows[0].count,
    dueChecks: due.rows[0].count,
    blockedChecks: blocked.rows[0].count,
    todoTasks: tasks.rows[0].count,
    pendingExtraPayments: extra.rows[0].count,
  });
});

app.get('/api/admin/customers', auth(), adminOnly, async (req, res) => {
  const { rows } = await query(
    `SELECT c.*, COUNT(p.id)::int AS properties_count,
       CASE WHEN ${paymentIsValidSql('c')} THEN TRUE ELSE FALSE END AS payment_valid
     FROM customers c
     LEFT JOIN properties p ON p.customer_id = c.id
     GROUP BY c.id
     ORDER BY c.created_at DESC`
  );
  res.json({ customers: rows });
});

app.post('/api/admin/customers', auth(), adminOnly, async (req, res) => {
  const { name, email, phone, notes, payment_status = 'unpaid', paid_until = null } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome cliente obbligatorio' });
  const { rows } = await query(
    `INSERT INTO customers (name, email, phone, notes, payment_status, paid_until)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [name, email || null, phone || null, notes || null, payment_status, paid_until]
  );
  res.status(201).json({ customer: rows[0] });
});

app.patch('/api/admin/customers/:id', auth(), adminOnly, async (req, res) => {
  const { name, email, phone, notes, payment_status, paid_until } = req.body;
  const { rows } = await query(
    `UPDATE customers SET
       name = COALESCE($2, name), email = $3, phone = $4, notes = $5,
       payment_status = COALESCE($6, payment_status), paid_until = $7, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [req.params.id, name || null, email || null, phone || null, notes || null, payment_status || null, paid_until || null]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Cliente non trovato' });
  res.json({ customer: rows[0] });
});

app.post('/api/admin/customers/:id/manual-payment', auth(), adminOnly, async (req, res) => {
  const { amount_euro, paid_until, method = 'contanti', description = 'Pagamento manuale registrato dall\'admin' } = req.body;
  if (!paid_until) return res.status(400).json({ error: 'Indica la data pagato fino al' });
  const cents = amount_euro ? toIntCents(amount_euro) : null;
  const { rows: cRows } = await query('SELECT * FROM customers WHERE id = $1', [req.params.id]);
  if (!cRows[0]) return res.status(404).json({ error: 'Cliente non trovato' });

  await query(
    `INSERT INTO manual_payments (customer_id, amount_cents, method, description, paid_until)
     VALUES ($1, $2, $3, $4, $5)`,
    [req.params.id, cents, method, description, paid_until]
  );
  const { rows } = await query(
    `UPDATE customers SET payment_status = 'paid', paid_until = $2, manual_payment_note = $3,
       last_manual_payment_at = NOW(), updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [req.params.id, paid_until, `${method}${cents ? ` - €${euro(cents).toFixed(2)}` : ''} - ${description}`]
  );
  res.json({ customer: rows[0], message: `Cliente segnato come pagato fino al ${paid_until}` });
});

app.post('/api/admin/customers/:id/client-login', auth(), adminOnly, async (req, res) => {
  const { password } = req.body;
  const { rows: custRows } = await query('SELECT * FROM customers WHERE id = $1', [req.params.id]);
  const customer = custRows[0];
  if (!customer) return res.status(404).json({ error: 'Cliente non trovato' });
  if (!customer.email) return res.status(400).json({ error: 'Il cliente deve avere una email' });
  const tempPassword = password || `HomeCare${Math.floor(100000 + Math.random() * 900000)}!`;
  const hash = await bcrypt.hash(tempPassword, 12);
  const { rows } = await query(
    `INSERT INTO users (name, email, phone, password_hash, role, customer_id)
     VALUES ($1, $2, $3, $4, 'client', $5)
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone, password_hash = EXCLUDED.password_hash, customer_id = EXCLUDED.customer_id, role = 'client', updated_at = NOW()
     RETURNING id, name, email, role, customer_id`,
    [customer.name, customer.email, customer.phone, hash, customer.id]
  );
  res.json({ user: rows[0], temporaryPassword: tempPassword });
});

app.get('/api/admin/properties', auth(), adminOnly, async (req, res) => {
  const { rows } = await query(
    `SELECT p.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone, c.payment_status, c.paid_until,
       CASE WHEN ${paymentIsValidSql('c')} THEN TRUE ELSE FALSE END AS payment_valid
     FROM properties p
     JOIN customers c ON c.id = p.customer_id
     ORDER BY p.created_at DESC`
  );
  res.json({ properties: rows });
});

app.post('/api/admin/properties', auth(), adminOnly, async (req, res) => {
  const { customer_id, name, address, city, zone, package_type = 'base', notes, latitude, longitude } = req.body;
  if (!customer_id || !name) return res.status(400).json({ error: 'Cliente e nome immobile obbligatori' });
  const cfg = packageConfig[package_type] || packageConfig.base;
  const { rows } = await query(
    `INSERT INTO properties (customer_id, name, address, city, zone, package_type, monthly_price_cents, next_check_date, notes, latitude, longitude)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_DATE, $8, $9, $10)
     RETURNING *`,
    [customer_id, name, address || null, city || 'Badesi', zone || null, package_type, cfg.priceCents, notes || null, latitude || null, longitude || null]
  );
  res.status(201).json({ property: rows[0] });
});

app.patch('/api/admin/properties/:id', auth(), adminOnly, async (req, res) => {
  const { name, address, city, zone, package_type, notes, active, next_check_date } = req.body;
  const cfg = package_type ? (packageConfig[package_type] || packageConfig.base) : null;
  const { rows } = await query(
    `UPDATE properties SET
       name = COALESCE($2, name), address = $3, city = $4, zone = $5,
       package_type = COALESCE($6, package_type), monthly_price_cents = COALESCE($7, monthly_price_cents),
       notes = $8, active = COALESCE($9, active), next_check_date = COALESCE($10, next_check_date), updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [req.params.id, name || null, address || null, city || null, zone || null, package_type || null, cfg?.priceCents || null, notes || null, typeof active === 'boolean' ? active : null, next_check_date || null]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Immobile non trovato' });
  res.json({ property: rows[0] });
});

app.post('/api/admin/properties/:id/location', auth(), adminOnly, async (req, res) => {
  const { latitude, longitude } = req.body;
  if (!latitude || !longitude) return res.status(400).json({ error: 'Coordinate mancanti' });
  const { rows } = await query(
    `UPDATE properties SET latitude = $2, longitude = $3, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [req.params.id, latitude, longitude]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Immobile non trovato' });
  res.json({ property: rows[0] });
});

app.get('/api/admin/due-checks', auth(), adminOnly, async (req, res) => {
  const validPayment = paymentIsValidSql('c');
  const { rows } = await query(
    `SELECT p.*, c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email, c.payment_status, c.paid_until,
       CASE WHEN ${validPayment} THEN FALSE ELSE TRUE END AS blocked
     FROM properties p
     JOIN customers c ON c.id = p.customer_id
     WHERE p.active = TRUE AND p.next_check_date <= CURRENT_DATE
     ORDER BY blocked ASC, p.next_check_date ASC, c.name ASC`
  );
  res.json({ checks: rows });
});

app.post('/api/admin/checks/complete', auth(), adminOnly, upload.array('photos', 12), async (req, res) => {
  const { property_id, notes, checklist_json } = req.body;
  if (!property_id) return res.status(400).json({ error: 'Immobile obbligatorio' });
  const { rows: pRows } = await query(
    `SELECT p.*, c.payment_status, c.paid_until, ${paymentIsValidSql('c')} AS payment_valid
     FROM properties p JOIN customers c ON c.id = p.customer_id WHERE p.id = $1`,
    [property_id]
  );
  const property = pRows[0];
  if (!property) return res.status(404).json({ error: 'Immobile non trovato' });
  if (!property.payment_valid) return res.status(402).json({ error: 'Pagamento non regolare: controllo sospeso' });
  const photoUrls = (req.files || []).map((file) => `/uploads/${file.filename}`);
  const nextDate = nextCheckDate(property.package_type);
  const { rows } = await query(
    `INSERT INTO checks (property_id, due_date, completed_at, status, notes, checklist_json, photo_urls)
     VALUES ($1, CURRENT_DATE, NOW(), 'done', $2, $3::jsonb, $4::jsonb)
     RETURNING *`,
    [property_id, notes || null, checklist_json || '[]', JSON.stringify(photoUrls)]
  );
  await query('UPDATE properties SET next_check_date = $2, updated_at = NOW() WHERE id = $1', [property_id, nextDate]);
  res.status(201).json({ check: rows[0], nextCheckDate: nextDate });
});

app.get('/api/admin/checks', auth(), adminOnly, async (req, res) => {
  const { propertyId } = req.query;
  const params = [];
  let where = '';
  if (propertyId) { params.push(propertyId); where = 'WHERE c.property_id = $1'; }
  const { rows } = await query(
    `SELECT c.*, p.name AS property_name, cu.name AS customer_name
     FROM checks c
     JOIN properties p ON p.id = c.property_id
     JOIN customers cu ON cu.id = p.customer_id
     ${where}
     ORDER BY c.completed_at DESC NULLS LAST, c.created_at DESC
     LIMIT 100`,
    params
  );
  res.json({ checks: rows });
});

app.get('/api/admin/tasks', auth(), adminOnly, async (req, res) => {
  const status = req.query.status || 'todo';
  const { rows } = await query(
    `SELECT t.*, c.name AS customer_name, p.name AS property_name, p.address
     FROM tasks t
     LEFT JOIN customers c ON c.id = t.customer_id
     LEFT JOIN properties p ON p.id = t.property_id
     WHERE t.status = $1
     ORDER BY t.due_date ASC, t.priority DESC, t.created_at DESC`,
    [status]
  );
  res.json({ tasks: rows });
});

app.post('/api/admin/tasks', auth(), adminOnly, async (req, res) => {
  const { title, description, type = 'controllo', priority = 'normale', due_date, customer_id, property_id } = req.body;
  if (!title) return res.status(400).json({ error: 'Titolo obbligatorio' });
  const { rows } = await query(
    `INSERT INTO tasks (title, description, type, priority, due_date, customer_id, property_id)
     VALUES ($1, $2, $3, $4, COALESCE($5, CURRENT_DATE), $6, $7)
     RETURNING *`,
    [title, description || null, type, priority, due_date || null, customer_id || null, property_id || null]
  );
  res.status(201).json({ task: rows[0] });
});

app.post('/api/admin/tasks/:id/done', auth(), adminOnly, async (req, res) => {
  const { rows } = await query(
    `UPDATE tasks SET status = 'done', completed_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Attività non trovata' });
  res.json({ task: rows[0] });
});

app.get('/api/admin/route-plan', auth(), adminOnly, async (req, res) => {
  const lat = Number(req.query.lat || 40.9663);
  const lng = Number(req.query.lng || 8.8814);
  const onlyDue = req.query.onlyDue !== '0';
  const validPayment = paymentIsValidSql('c');
  const whereParts = [`p.active = TRUE`, `p.latitude IS NOT NULL`, `p.longitude IS NOT NULL`, validPayment];
  if (onlyDue) whereParts.push(`p.next_check_date <= CURRENT_DATE`);
  const { rows } = await query(
    `SELECT p.*, c.name AS customer_name, c.phone AS customer_phone, c.payment_status, c.paid_until
     FROM properties p
     JOIN customers c ON c.id = p.customer_id
     WHERE ${whereParts.join(' AND ')}`
  );
  const withDistance = rows.map((p) => ({ ...p, distance_from_origin_km: Number(haversineKm(lat, lng, Number(p.latitude), Number(p.longitude)).toFixed(2)) }));
  const nearest = sortNearest(lat, lng, withDistance);
  res.json({ origin: { lat, lng }, totalKm: nearest.totalKm, properties: nearest.ordered });
});

app.post('/api/admin/stripe/subscription', auth(), adminOnly, async (req, res) => {
  if (!stripe) return res.status(400).json({ error: 'Stripe non configurato' });
  const { customer_id, property_id } = req.body;
  const { rows } = await query(
    `SELECT c.*, p.package_type, p.monthly_price_cents, p.name AS property_name
     FROM customers c JOIN properties p ON p.customer_id = c.id
     WHERE c.id = $1 AND p.id = $2`,
    [customer_id, property_id]
  );
  const row = rows[0];
  if (!row) return res.status(404).json({ error: 'Cliente o immobile non trovato' });
  let stripeCustomerId = row.stripe_customer_id;
  if (!stripeCustomerId) {
    const sc = await stripe.customers.create({ name: row.name, email: row.email || undefined, phone: row.phone || undefined, metadata: { customerId: row.id } });
    stripeCustomerId = sc.id;
    await query('UPDATE customers SET stripe_customer_id = $2, updated_at = NOW() WHERE id = $1', [row.id, stripeCustomerId]);
  }
  const cfg = packageConfig[row.package_type] || packageConfig.base;
  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: 'subscription',
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'eur',
        unit_amount: row.monthly_price_cents,
        recurring: { interval: 'month' },
        product_data: { name: `Home Care - ${cfg.label} - ${row.property_name}` },
      },
    }],
    success_url: `${APP_URL}/?payment=success`,
    cancel_url: `${APP_URL}/?payment=canceled`,
    metadata: { kind: 'subscription', customerId: row.id, propertyId: property_id, packageType: row.package_type },
  });
  res.json({ url: session.url });
});

app.get('/api/admin/extra-payments', auth(), adminOnly, async (req, res) => {
  const { rows } = await query(
    `SELECT e.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
     FROM extra_payments e
     JOIN customers c ON c.id = e.customer_id
     ORDER BY e.created_at DESC`
  );
  res.json({ payments: rows });
});

app.post('/api/admin/extra-payments', auth(), adminOnly, async (req, res) => {
  const { customer_id, amount_euro, description } = req.body;
  const cents = toIntCents(amount_euro);
  if (!customer_id || !cents || !description) return res.status(400).json({ error: 'Cliente, importo e descrizione obbligatori' });
  const { rows: cRows } = await query('SELECT * FROM customers WHERE id = $1', [customer_id]);
  const customer = cRows[0];
  if (!customer) return res.status(404).json({ error: 'Cliente non trovato' });

  const { rows } = await query(
    `INSERT INTO extra_payments (customer_id, amount_cents, description)
     VALUES ($1, $2, $3) RETURNING *`,
    [customer_id, cents, description]
  );
  const extra = rows[0];

  if (!stripe) return res.status(201).json({ payment: extra, stripeDisabled: true });

  let stripeCustomerId = customer.stripe_customer_id;
  if (!stripeCustomerId) {
    const sc = await stripe.customers.create({ name: customer.name, email: customer.email || undefined, phone: customer.phone || undefined, metadata: { customerId: customer.id } });
    stripeCustomerId = sc.id;
    await query('UPDATE customers SET stripe_customer_id = $2, updated_at = NOW() WHERE id = $1', [customer.id, stripeCustomerId]);
  }

  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: 'payment',
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'eur',
        unit_amount: cents,
        product_data: { name: 'Home Care - Manutenzione o extra', description },
      },
    }],
    success_url: `${APP_URL}/?extra=success`,
    cancel_url: `${APP_URL}/?extra=canceled`,
    metadata: { kind: 'extra_payment', extraPaymentId: extra.id, customerId: customer.id },
  });
  const { rows: updated } = await query(
    `UPDATE extra_payments SET stripe_session_id = $2, payment_url = $3, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [extra.id, session.id, session.url]
  );
  res.status(201).json({ payment: updated[0] });
});

app.get('/api/admin/manual-payments', auth(), adminOnly, async (req, res) => {
  const { rows } = await query(
    `SELECT m.*, c.name AS customer_name
     FROM manual_payments m
     JOIN customers c ON c.id = m.customer_id
     ORDER BY m.created_at DESC
     LIMIT 100`
  );
  res.json({ payments: rows });
});

app.get('/api/client/dashboard', auth(), clientOnly, async (req, res) => {
  const customerId = req.user.customer_id;
  const { rows: customers } = await query(
    `SELECT *, CASE WHEN ${paymentIsValidSql('customers')} THEN TRUE ELSE FALSE END AS payment_valid
     FROM customers WHERE id = $1`,
    [customerId]
  );
  const { rows: properties } = await query('SELECT * FROM properties WHERE customer_id = $1 AND active = TRUE ORDER BY created_at DESC', [customerId]);
  const { rows: reports } = await query(
    `SELECT ch.*, p.name AS property_name FROM checks ch JOIN properties p ON p.id = ch.property_id
     WHERE p.customer_id = $1 AND ch.status = 'done'
     ORDER BY ch.completed_at DESC LIMIT 30`,
    [customerId]
  );
  const { rows: payments } = await query('SELECT * FROM extra_payments WHERE customer_id = $1 ORDER BY created_at DESC', [customerId]);
  res.json({ customer: customers[0], properties, reports, payments, packages: packageConfig });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Errore interno del server' });
});

app.listen(PORT, () => {
  console.log(`Home Care PWA avviata su ${APP_URL}`);
});
