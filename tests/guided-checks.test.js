'use strict';

const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { createApp, loadConfig } = require('../server3');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://homecare:homecare@127.0.0.1:5432/homecare_test';
const JWT_SECRET = 'home-care-guided-checks-test-secret-with-more-than-32-characters';

class BrowserClient {
  constructor(base) {
    this.base = base;
    this.cookies = new Map();
    this.csrfToken = '';
  }

  updateCookies(headers) {
    const values = typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : [headers.get('set-cookie')].filter(Boolean);
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

  async request(urlPath, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const headers = new Headers(options.headers || {});
    headers.set('Accept', 'application/json');
    headers.set('Origin', this.base);
    if (this.cookies.size) {
      headers.set('Cookie', Array.from(this.cookies.entries()).map(([key, value]) => `${key}=${value}`).join('; '));
    }
    if (!['GET', 'HEAD'].includes(method) && options.csrf !== false) {
      headers.set('X-CSRF-Token', this.csrfToken);
    }
    let body = options.body;
    if (options.json !== undefined) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(options.json);
    }
    const response = await fetch(new URL(urlPath, this.base), {
      method,
      headers,
      body,
      redirect: options.redirect || 'follow',
    });
    this.updateCookies(response.headers);
    const type = response.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await response.json() : await response.arrayBuffer();
    if (data && typeof data === 'object' && !(data instanceof ArrayBuffer) && data.csrfToken) {
      this.csrfToken = data.csrfToken;
    }
    return { response, data };
  }

  async bootstrap() {
    const result = await this.request('/api/config');
    assert.equal(result.response.status, 200);
    this.csrfToken = result.data.csrfToken;
  }

  async login(email, password) {
    await this.bootstrap();
    const result = await this.request('/api/auth/login', {
      method: 'POST',
      json: { email, password },
    });
    assert.equal(result.response.status, 200, JSON.stringify(result.data));
  }
}

let pool;
let server;
let base;
let admin;
let owner;
let customerId;
let propertyId;

before(async () => {
  execFileSync(process.execPath, ['scripts/migrate.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL },
    stdio: 'inherit',
  });

  pool = new Pool({ connectionString: DATABASE_URL });
  await pool.query(`
    TRUNCATE
      guided_check_item_photos,guided_check_items,guided_checks,property_check_templates,
      notifications,property_occupancies,stripe_events,check_photos,checks,tasks,
      extra_payments,manual_payments,messages,customer_custom_plans,properties,
      users,customers,contact_channels
    RESTART IDENTITY CASCADE
  `);

  const adminHash = await bcrypt.hash('Admin-guided-2026!', 12);
  await pool.query(
    `INSERT INTO users(name,email,password_hash,role,email_confirmed)
     VALUES('Admin Guided','admin-guided@example.test',$1,'admin',TRUE)`,
    [adminHash]
  );

  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL,
    JWT_SECRET,
    STRIPE_WEBHOOK_SECRET: 'whsec_guided_test',
    REGISTRATION_ENABLED: 'true',
  });
  const app = createApp({
    config,
    pool,
    stripeClient: null,
    mailer: async () => ({ sent: false }),
  });
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;

  admin = new BrowserClient(base);
  await admin.login('admin-guided@example.test', 'Admin-guided-2026!');

  const customer = await admin.request('/api/admin/customers', {
    method: 'POST',
    json: {
      name: 'Cliente Controllo Guidato',
      email: 'cliente-guided@example.test',
      phone: '+3900000001',
      current_package_type: 'base',
    },
  });
  assert.equal(customer.response.status, 201, JSON.stringify(customer.data));
  customerId = customer.data.customer.id;

  const property = await admin.request('/api/admin/properties', {
    method: 'POST',
    json: {
      customer_id: customerId,
      name: 'Casa Checklist',
      address: 'Via del Test 1',
      city: 'Badesi',
      package_type: 'base',
      monthly_price_euro: '39.00',
    },
  });
  assert.equal(property.response.status, 201, JSON.stringify(property.data));
  propertyId = property.data.property.id;

  const payment = await admin.request(`/api/admin/customers/${customerId}/manual-payment`, {
    method: 'POST',
    json: {
      amount_euro: '39.00',
      package_type: 'base',
      method: 'bonifico',
      description: 'Pagamento test controllo guidato',
      paid_until: '2099-12-31',
    },
  });
  assert.equal(payment.response.status, 200, JSON.stringify(payment.data));

  const clientHash = await bcrypt.hash('Cliente-guided-2026!', 12);
  await pool.query(
    `INSERT INTO users(name,email,password_hash,role,customer_id,email_confirmed)
     VALUES('Cliente Guided','cliente-guided@example.test',$1,'client',$2,TRUE)`,
    [clientHash, customerId]
  );
  owner = new BrowserClient(base);
  await owner.login('cliente-guided@example.test', 'Cliente-guided-2026!');
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

test('il controllo guidato crea una bozza privata e pubblica il report solo dopo approvazione', async () => {
  const template = await admin.request(`/api/admin/properties/${propertyId}/checklist-template`, {
    method: 'PUT',
    json: {
      items_json: [
        'Controllare porte e finestre',
        'Verificare eventuali perdite visibili',
      ],
    },
  });
  assert.equal(template.response.status, 200, JSON.stringify(template.data));
  assert.deepEqual(template.data.template.items_json, [
    'Controllare porte e finestre',
    'Verificare eventuali perdite visibili',
  ]);

  const started = await admin.request('/api/admin/guided-checks/start', {
    method: 'POST',
    json: { property_id: propertyId },
  });
  assert.equal(started.response.status, 201, JSON.stringify(started.data));
  const session = started.data.session;
  assert.equal(session.status, 'in_progress');
  assert.equal(session.items.length, 2);

  const first = session.items[0];
  const second = session.items[1];

  const firstUpdate = await admin.request(`/api/admin/guided-checks/${session.id}/items/${first.id}`, {
    method: 'PATCH',
    json: { checked: true, notes: 'Tutto regolare.' },
  });
  assert.equal(firstUpdate.response.status, 200, JSON.stringify(firstUpdate.data));
  assert.equal(firstUpdate.data.item.checked, true);

  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X7W6WQAAAABJRU5ErkJggg==',
    'base64'
  );
  const photoForm = new FormData();
  photoForm.append('photos', new Blob([png], { type: 'image/png' }), 'verifica.png');
  const photoUpload = await admin.request(
    `/api/admin/guided-checks/${session.id}/items/${first.id}/photos`,
    { method: 'POST', body: photoForm }
  );
  assert.equal(photoUpload.response.status, 201, JSON.stringify(photoUpload.data));
  assert.equal(photoUpload.data.photos.length, 1);

  const secondUpdate = await admin.request(`/api/admin/guided-checks/${session.id}/items/${second.id}`, {
    method: 'PATCH',
    json: { checked: true, notes: 'Nessuna perdita rilevata.' },
  });
  assert.equal(secondUpdate.response.status, 200, JSON.stringify(secondUpdate.data));

  const notes = await admin.request(`/api/admin/guided-checks/${session.id}`, {
    method: 'PATCH',
    json: { overall_notes: 'Controllo completato senza anomalie importanti.' },
  });
  assert.equal(notes.response.status, 200, JSON.stringify(notes.data));

  const finished = await admin.request(`/api/admin/guided-checks/${session.id}/finish`, {
    method: 'POST',
    json: {},
  });
  assert.equal(finished.response.status, 200, JSON.stringify(finished.data));
  assert.equal(finished.data.guided_check.status, 'draft');

  const beforeApproval = await owner.request('/api/client/dashboard');
  assert.equal(beforeApproval.response.status, 200);
  assert.equal(beforeApproval.data.reports.length, 0, 'la bozza non deve essere visibile al cliente');

  const approval = await admin.request(`/api/admin/guided-checks/${session.id}/approve`, {
    method: 'POST',
    json: {},
  });
  assert.equal(approval.response.status, 200, JSON.stringify(approval.data));
  assert.equal(approval.data.guided_check.status, 'approved');
  assert.ok(approval.data.check.id);

  const afterApproval = await owner.request('/api/client/dashboard');
  assert.equal(afterApproval.response.status, 200);
  assert.equal(afterApproval.data.reports.length, 1);
  assert.deepEqual(afterApproval.data.reports[0].checklist_json, [
    'Controllare porte e finestre',
    'Verificare eventuali perdite visibili',
  ]);
  assert.match(afterApproval.data.reports[0].notes, /Controllo completato senza anomalie importanti/);
  assert.equal(afterApproval.data.reports[0].photos.length, 1);

  const ownPhoto = await owner.request(afterApproval.data.reports[0].photos[0].url);
  assert.equal(ownPhoto.response.status, 200);
  assert.equal(ownPhoto.response.headers.get('content-type'), 'image/png');
});

test('una casa occupata non può avviare un controllo guidato', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const occupancy = await admin.request('/api/admin/occupancies', {
    method: 'POST',
    json: {
      property_id: propertyId,
      start_date: today,
      end_date: today,
      note: 'Casa occupata per il test',
    },
  });
  assert.equal(occupancy.response.status, 201, JSON.stringify(occupancy.data));

  const started = await admin.request('/api/admin/guided-checks/start', {
    method: 'POST',
    json: { property_id: propertyId },
  });
  assert.equal(started.response.status, 409);
  assert.equal(started.data.code, 'PROPERTY_OCCUPIED');
});
