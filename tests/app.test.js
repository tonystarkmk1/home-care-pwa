'use strict';

const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { execFileSync } = require('node:child_process');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { createApp, loadConfig, imageType } = require('../server3');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://homecare:homecare@127.0.0.1:5432/homecare_test';
const JWT_SECRET = 'home-care-test-secret-with-more-than-32-characters';
const stripeSessions = [];

const fakeStripe = {
  webhooks: {
    constructEvent(body, signature) {
      if (!signature) throw new Error('Firma Stripe mancante');
      return JSON.parse(Buffer.isBuffer(body) ? body.toString('utf8') : String(body));
    },
  },
  customers: {
    async create() { return { id: `cus_test_${Date.now()}` }; },
  },
  checkout: {
    sessions: {
      async create(payload) {
        stripeSessions.push(payload);
        return { id: `cs_test_${stripeSessions.length}`, url: `https://checkout.stripe.test/session-${stripeSessions.length}`, status: 'open' };
      },
      async retrieve() { return { status: 'expired' }; },
    },
  },
  subscriptions: {
    async retrieve(id) { return { id, metadata: {} }; },
  },
};

class BrowserClient {
  constructor(base) {
    this.base = base;
    this.cookies = new Map();
    this.csrfToken = '';
  }

  updateCookies(headers) {
    const values = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [headers.get('set-cookie')].filter(Boolean);
    values.forEach((value) => {
      const first = value.split(';', 1)[0];
      const index = first.indexOf('=');
      if (index < 0) return;
      const name = first.slice(0, index);
      const cookieValue = first.slice(index + 1);
      if (cookieValue) this.cookies.set(name, cookieValue);
      else this.cookies.delete(name);
    });
  }

  async request(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const headers = new Headers(options.headers || {});
    headers.set('Accept', 'application/json');
    if (this.cookies.size) headers.set('Cookie', Array.from(this.cookies.entries()).map(([key, value]) => `${key}=${value}`).join('; '));
    if (!['GET', 'HEAD'].includes(method) && options.csrf !== false) headers.set('X-CSRF-Token', this.csrfToken);
    headers.set('Origin', this.base);
    let body = options.body;
    if (options.json !== undefined) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(options.json);
    }
    const response = await fetch(new URL(path, this.base), { method, headers, body, redirect: options.redirect || 'follow' });
    this.updateCookies(response.headers);
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await response.json() : await response.arrayBuffer();
    if (data && typeof data === 'object' && !(data instanceof ArrayBuffer) && data.csrfToken) this.csrfToken = data.csrfToken;
    return { response, data };
  }

  async bootstrap() {
    const result = await this.request('/api/config');
    assert.equal(result.response.status, 200);
    this.csrfToken = result.data.csrfToken;
    return result.data;
  }
}

let pool;
let server;
let base;
let admin;
let owner;
let other;
let ownerCustomerId;

async function registerClient(client, name, email) {
  await client.bootstrap();
  const registration = await client.request('/api/auth/register', {
    method: 'POST',
    json: { name, email, phone: '+3900000000', password: 'Password-test-2026!' },
  });
  assert.equal(registration.response.status, 201, JSON.stringify(registration.data));
  assert.ok(registration.data.confirmationUrl);
  const confirmation = await client.request(registration.data.confirmationUrl);
  assert.equal(confirmation.response.status, 200);
  const login = await client.request('/api/auth/login', {
    method: 'POST',
    json: { email, password: 'Password-test-2026!' },
  });
  assert.equal(login.response.status, 200, JSON.stringify(login.data));
  return registration.data.customerId;
}

before(async () => {
  execFileSync(process.execPath, ['scripts/migrate.js'], {
    cwd: require('node:path').join(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL },
    stdio: 'inherit',
  });
  pool = new Pool({ connectionString: DATABASE_URL });
  await pool.query(`TRUNCATE stripe_events,check_photos,checks,tasks,extra_payments,manual_payments,messages,customer_custom_plans,properties,users,customers,contact_channels RESTART IDENTITY CASCADE`);
  const passwordHash = await bcrypt.hash('Admin-password-2026!', 12);
  await pool.query(`INSERT INTO users(name,email,password_hash,role,email_confirmed) VALUES('Admin Test','admin@example.test',$1,'admin',TRUE)`, [passwordHash]);

  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL,
    JWT_SECRET,
    STRIPE_WEBHOOK_SECRET: 'whsec_test',
    REGISTRATION_ENABLED: 'true',
  });
  const app = createApp({ config, pool, stripeClient: fakeStripe, mailer: async () => ({ sent: false }) });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  base = `http://127.0.0.1:${address.port}`;

  admin = new BrowserClient(base);
  await admin.bootstrap();
  const adminLogin = await admin.request('/api/auth/login', { method: 'POST', json: { email: 'admin@example.test', password: 'Admin-password-2026!' } });
  assert.equal(adminLogin.response.status, 200, JSON.stringify(adminLogin.data));

  owner = new BrowserClient(base);
  ownerCustomerId = await registerClient(owner, 'Cliente Proprietario', 'owner@example.test');
  other = new BrowserClient(base);
  await registerClient(other, 'Altro Cliente', 'other@example.test');
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

test('la configurazione di produzione blocca secret deboli e webhook non firmati', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production', DATABASE_URL, JWT_SECRET: 'debole' }), /32 caratteri/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', DATABASE_URL, JWT_SECRET, APP_URL: 'https://example.test', STRIPE_SECRET_KEY: 'sk_test' }), /STRIPE_WEBHOOK_SECRET/);
});

test('il riconoscimento delle immagini accetta solo formati supportati', () => {
  assert.equal(imageType(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])), 'image/jpeg');
  assert.equal(imageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])), 'image/png');
  assert.equal(imageType(Buffer.from('non-immagine')), null);
});

test('home, health check e header di sicurezza sono disponibili', async () => {
  const home = await owner.request('/');
  assert.equal(home.response.status, 200);
  assert.match(home.response.headers.get('content-security-policy') || '', /default-src 'self'/);
  assert.equal(home.response.headers.get('x-content-type-options'), 'nosniff');
  const health = await owner.request('/api/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.data.database, 'ok');
});

test('le richieste mutative senza CSRF vengono rifiutate', async () => {
  const client = new BrowserClient(base);
  await client.bootstrap();
  const result = await client.request('/api/auth/login', {
    method: 'POST', csrf: false, json: { email: 'admin@example.test', password: 'Admin-password-2026!' },
  });
  assert.equal(result.response.status, 403);
  assert.equal(result.data.code, 'CSRF_INVALID');
});

test('il server rifiuta un piano arbitrario inviato dal cliente', async () => {
  const result = await owner.request('/api/client/properties', {
    method: 'POST',
    json: { name: 'Casa XSS', address: 'Via Test 1', city: 'Badesi', package_type: '<img src=x onerror=alert(1)>' },
  });
  assert.equal(result.response.status, 400);
  assert.equal(result.data.code, 'PLAN_INVALID');
});

test('il checkout personalizzato usa il prezzo approvato, non quello inviato dal browser', async () => {
  const request = await owner.request('/api/client/properties', {
    method: 'POST',
    json: { name: 'Villa Prezzo', address: 'Via Mare 10', city: 'Badesi', package_type: 'personalizzato', notes: 'Richiesta test' },
  });
  assert.equal(request.response.status, 201, JSON.stringify(request.data));
  const propertyId = request.data.property.id;
  const approval = await admin.request(`/api/admin/properties/${propertyId}/approve`, {
    method: 'POST',
    json: { package_type: 'personalizzato', monthly_price_euro: '123.45' },
  });
  assert.equal(approval.response.status, 200, JSON.stringify(approval.data));

  const checkout = await owner.request('/api/client/plan-checkout', {
    method: 'POST',
    json: { billing: 'monthly', package_type: 'personalizzato', custom_monthly_price_euro: '0.01' },
  });
  assert.equal(checkout.response.status, 200, JSON.stringify(checkout.data));
  const payload = stripeSessions.at(-1);
  assert.equal(payload.line_items[0].price_data.unit_amount, 12345);
  assert.equal(payload.metadata.expectedAmountCents, '12345');
});

test('le foto dei report sono persistenti e accessibili solo al cliente proprietario', async () => {
  const payment = await admin.request(`/api/admin/customers/${ownerCustomerId}/manual-payment`, {
    method: 'POST',
    json: { amount_euro: '123.45', paid_until: '2099-12-31', method: 'bonifico', description: 'Test', package_type: 'personalizzato' },
  });
  assert.equal(payment.response.status, 200, JSON.stringify(payment.data));

  const properties = await admin.request('/api/admin/properties');
  const property = properties.data.properties.find((item) => item.customer_id === ownerCustomerId && item.package_type === 'personalizzato');
  assert.ok(property);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X7W6WQAAAABJRU5ErkJggg==', 'base64');
  const form = new FormData();
  form.append('property_id', property.id);
  form.append('notes', 'Controllo di prova');
  form.append('checklist_json', JSON.stringify(['Porte controllate']));
  form.append('photos', new Blob([png], { type: 'image/png' }), 'prova.png');
  const completed = await admin.request('/api/admin/checks/complete', { method: 'POST', body: form });
  assert.equal(completed.response.status, 201, JSON.stringify(completed.data));

  const reports = await owner.request('/api/client/dashboard');
  const photoUrl = reports.data.reports[0].photos[0].url;
  const ownPhoto = await owner.request(photoUrl);
  assert.equal(ownPhoto.response.status, 200);
  assert.equal(ownPhoto.response.headers.get('content-type'), 'image/png');
  const forbidden = await other.request(photoUrl);
  assert.equal(forbidden.response.status, 403);
});

test('il webhook Stripe senza firma viene respinto', async () => {
  const result = await fetch(`${base}/api/stripe/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'evt_unsigned', type: 'checkout.session.completed', data: { object: {} } }),
  });
  assert.equal(result.status, 400);
});
