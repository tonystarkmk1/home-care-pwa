'use strict';

const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { createApp, loadConfig } = require('../server3');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://homecare:homecare@127.0.0.1:5432/homecare_test';
const JWT_SECRET = 'home-care-simple-ui-v44-test-secret-with-more-than-thirty-two-characters';

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
    const data = type.includes('application/json') ? await response.json() : await response.text();
    if (data && typeof data === 'object' && data.csrfToken) this.csrfToken = data.csrfToken;
    return { response, data };
  }

  async bootstrap() {
    const result = await this.request('/api/config');
    assert.equal(result.response.status, 200, JSON.stringify(result.data));
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

before(async () => {
  execFileSync(process.execPath, ['scripts/migrate.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL },
    stdio: 'inherit',
  });

  pool = new Pool({ connectionString: DATABASE_URL });
  await pool.query('TRUNCATE users,customers RESTART IDENTITY CASCADE');
  await pool.query(`
    INSERT INTO plan_settings(id,label,price_cents,price_label,features_json,days,from_price,active,sort_order)
    VALUES
      ('base','Base',3900,'€39/mese','["Controllo periodico"]'::jsonb,30,FALSE,TRUE,10),
      ('comfort','Comfort',7900,'€79/mese','["Controllo più frequente","Report fotografico"]'::jsonb,15,FALSE,TRUE,20),
      ('personalizzato','Personalizzato',10000,'Da €100/mese','["Servizi su misura"]'::jsonb,30,TRUE,TRUE,30)
    ON CONFLICT (id) DO UPDATE SET
      label=EXCLUDED.label,
      price_cents=EXCLUDED.price_cents,
      price_label=EXCLUDED.price_label,
      features_json=EXCLUDED.features_json,
      days=EXCLUDED.days,
      from_price=EXCLUDED.from_price,
      active=EXCLUDED.active,
      sort_order=EXCLUDED.sort_order
  `);

  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL,
    JWT_SECRET,
    STRIPE_WEBHOOK_SECRET: 'whsec_simple_ui_v44_test',
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
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

test('il piano scelto prima della registrazione viene conservato nel profilo cliente', async () => {
  const browser = new BrowserClient(base);
  await browser.bootstrap();
  const registration = await browser.request('/api/auth/register', {
    method: 'POST',
    json: {
      name: 'Cliente Registrazione Piano',
      email: 'registrazione-piano@example.test',
      phone: '+390000001',
      password: 'Registrazione-piano-2026!',
      selected_plan: 'comfort',
    },
  });
  assert.equal(registration.response.status, 201, JSON.stringify(registration.data));

  const customer = (await pool.query(
    'SELECT current_package_type FROM customers WHERE LOWER(email)=LOWER($1)',
    ['registrazione-piano@example.test']
  )).rows[0];
  assert.equal(customer.current_package_type, 'comfort');
});

test('un cliente senza piano può sceglierlo prima delle altre operazioni', async () => {
  const password = 'Cliente-senza-piano-2026!';
  const passwordHash = await bcrypt.hash(password, 12);
  const customer = (await pool.query(
    `INSERT INTO customers(name,email,phone,payment_status,current_package_type)
     VALUES('Cliente Senza Piano','senza-piano@example.test','+390000002','unpaid',NULL)
     RETURNING id`
  )).rows[0];
  await pool.query(
    `INSERT INTO users(name,email,phone,password_hash,role,customer_id,email_confirmed)
     VALUES('Cliente Senza Piano','senza-piano@example.test','+390000002',$1,'client',$2,TRUE)`,
    [passwordHash, customer.id]
  );

  const browser = new BrowserClient(base);
  await browser.login('senza-piano@example.test', password);
  const before = await browser.request('/api/client/dashboard');
  assert.equal(before.response.status, 200);
  assert.equal(before.data.customer.current_package_type, null);

  const selection = await browser.request('/api/client/plan-selection', {
    method: 'POST',
    json: { package_type: 'base' },
  });
  assert.equal(selection.response.status, 200, JSON.stringify(selection.data));
  assert.equal(selection.data.customer.current_package_type, 'base');
  assert.equal(selection.data.plan.label, 'Base');

  const after = await browser.request('/api/client/dashboard');
  assert.equal(after.response.status, 200);
  assert.equal(after.data.customer.current_package_type, 'base');
});

test('un piano già operativo non viene cambiato senza verifica amministrativa', async () => {
  const password = 'Cliente-piano-attivo-2026!';
  const passwordHash = await bcrypt.hash(password, 12);
  const customer = (await pool.query(
    `INSERT INTO customers(name,email,phone,payment_status,current_package_type)
     VALUES('Cliente Piano Attivo','piano-attivo@example.test','+390000003','unpaid','base')
     RETURNING id`
  )).rows[0];
  await pool.query(
    `INSERT INTO users(name,email,phone,password_hash,role,customer_id,email_confirmed)
     VALUES('Cliente Piano Attivo','piano-attivo@example.test','+390000003',$1,'client',$2,TRUE)`,
    [passwordHash, customer.id]
  );
  await pool.query(
    `INSERT INTO properties(
       customer_id,name,address,city,package_type,monthly_price_cents,next_check_date,active,request_status,approved_at
     ) VALUES($1,'Casa già attiva','Via Test 3','Badesi','base',3900,CURRENT_DATE,TRUE,'approved',NOW())`,
    [customer.id]
  );

  const browser = new BrowserClient(base);
  await browser.login('piano-attivo@example.test', password);
  const selection = await browser.request('/api/client/plan-selection', {
    method: 'POST',
    json: { package_type: 'comfort' },
  });
  assert.equal(selection.response.status, 409);
  assert.equal(selection.data.code, 'PLAN_CHANGE_REQUIRES_ADMIN');

  const unchanged = (await pool.query(
    'SELECT current_package_type FROM customers WHERE id=$1',
    [customer.id]
  )).rows[0];
  assert.equal(unchanged.current_package_type, 'base');
});
