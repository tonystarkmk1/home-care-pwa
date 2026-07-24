'use strict';

require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const Stripe = require('stripe');
const { Pool } = require('pg');
const { version: APP_VERSION } = require('./package.json');

const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_COOKIE = 'hc_session';
const CSRF_COOKIE = 'hc_csrf';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class HttpError extends Error {
  constructor(status, message, code = 'REQUEST_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function boolEnv(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function loadConfig(env = process.env) {
  const nodeEnv = String(env.NODE_ENV || 'development').trim();
  const isProduction = nodeEnv === 'production';
  const isTest = nodeEnv === 'test';
  const databaseUrl = String(env.DATABASE_URL || '').trim();
  const jwtSecret = String(env.JWT_SECRET || (isProduction ? '' : 'home-care-development-secret-change-me-2026')).trim();
  const appUrl = String(env.APP_URL || '').trim().replace(/\/$/, '');
  const stripeSecretKey = String(env.STRIPE_SECRET_KEY || '').trim();
  const stripeWebhookSecret = String(env.STRIPE_WEBHOOK_SECRET || '').trim();
  const brevoApiKey = String(env.BREVO_API_KEY || '').trim();
  const brevoSenderEmail = String(env.BREVO_SENDER_EMAIL || '').trim();

  if (!databaseUrl) throw new Error('DATABASE_URL non configurata');
  if (isProduction && jwtSecret.length < 32) throw new Error('JWT_SECRET deve contenere almeno 32 caratteri in produzione');
  if (stripeSecretKey && !stripeWebhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET è obbligatorio quando STRIPE_SECRET_KEY è configurata');
  }
  if (appUrl) {
    let parsed;
    try { parsed = new URL(appUrl); } catch (_) { throw new Error('APP_URL non valida'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('APP_URL deve usare http o https');
    if (isProduction && parsed.protocol !== 'https:') throw new Error('APP_URL deve usare https in produzione');
  }

  return {
    nodeEnv,
    isProduction,
    isTest,
    databaseUrl,
    jwtSecret,
    appUrl,
    port: Number(env.PORT || 3000),
    sessionDays: 14,
    stripeSecretKey,
    stripeWebhookSecret,
    brevoApiKey,
    brevoSenderEmail,
    brevoSenderName: String(env.BREVO_SENDER_NAME || 'Home Care').trim(),
    registrationEnabled: boolEnv(env.REGISTRATION_ENABLED, true),
    logFormat: String(env.LOG_FORMAT || (isProduction ? 'combined' : 'dev')),
  };
}

function createPool(config) {
  return new Pool({
    connectionString: config.databaseUrl,
    ssl: config.isProduction ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function parseCookies(header = '') {
  const out = {};
  String(header).split(';').forEach((chunk) => {
    const index = chunk.indexOf('=');
    if (index < 0) return;
    const key = chunk.slice(0, index).trim();
    const value = chunk.slice(index + 1).trim();
    if (!key) return;
    try { out[key] = decodeURIComponent(value); } catch (_) { out[key] = value; }
  });
  return out;
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function tokenHash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function htmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function text(value, options = {}) {
  const { name = 'Valore', required = false, min = 0, max = 500, trim = true } = options;
  if (value === undefined || value === null) {
    if (required) throw new HttpError(400, `${name} obbligatorio`, 'VALIDATION_ERROR');
    return null;
  }
  const result = trim ? String(value).trim() : String(value);
  if (!result) {
    if (required) throw new HttpError(400, `${name} obbligatorio`, 'VALIDATION_ERROR');
    return null;
  }
  if (result.length < min || result.length > max) {
    throw new HttpError(400, `${name} deve contenere tra ${min} e ${max} caratteri`, 'VALIDATION_ERROR');
  }
  return result;
}

function email(value, options = {}) {
  const result = text(value, { name: options.name || 'Email', required: options.required, max: 254 });
  if (!result) return null;
  const normalized = result.toLowerCase();
  if (!EMAIL_RE.test(normalized)) throw new HttpError(400, 'Email non valida', 'VALIDATION_ERROR');
  return normalized;
}

function uuid(value, name = 'Identificativo') {
  const result = text(value, { name, required: true, max: 40 });
  if (!UUID_RE.test(result)) throw new HttpError(400, `${name} non valido`, 'VALIDATION_ERROR');
  return result;
}

function enumValue(value, allowed, options = {}) {
  const result = text(value, { name: options.name || 'Valore', required: options.required, max: 80 });
  if (!result) return options.fallback ?? null;
  if (!allowed.includes(result)) throw new HttpError(400, `${options.name || 'Valore'} non valido`, 'VALIDATION_ERROR');
  return result;
}

function numberValue(value, options = {}) {
  const { name = 'Numero', min = -Infinity, max = Infinity, integer = false, required = false } = options;
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpError(400, `${name} obbligatorio`, 'VALIDATION_ERROR');
    return null;
  }
  const parsed = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isInteger(parsed))) {
    throw new HttpError(400, `${name} non valido`, 'VALIDATION_ERROR');
  }
  return parsed;
}

function cents(value, options = {}) {
  const amount = numberValue(value, { name: options.name || 'Importo', min: options.allowZero ? 0 : 0.01, max: 1_000_000, required: options.required });
  return amount === null ? null : Math.round(amount * 100);
}

function isoDate(value, options = {}) {
  const result = text(value, { name: options.name || 'Data', required: options.required, max: 10 });
  if (!result) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(Date.parse(`${result}T00:00:00Z`))) {
    throw new HttpError(400, `${options.name || 'Data'} non valida`, 'VALIDATION_ERROR');
  }
  return result;
}

function booleanValue(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null || value === '') return fallback;
  if (['true', '1', 'yes', 'on'].includes(String(value).toLowerCase())) return true;
  if (['false', '0', 'no', 'off'].includes(String(value).toLowerCase())) return false;
  return fallback;
}

function listOfStrings(value, options = {}) {
  let array = value;
  if (typeof value === 'string') {
    try { array = JSON.parse(value); } catch (_) { array = value.split('\n'); }
  }
  if (!Array.isArray(array)) throw new HttpError(400, `${options.name || 'Elenco'} non valido`, 'VALIDATION_ERROR');
  const maxItems = options.maxItems || 80;
  if (array.length > maxItems) throw new HttpError(400, `${options.name || 'Elenco'} troppo lungo`, 'VALIDATION_ERROR');
  return array.map((item) => text(item, { name: options.itemName || 'Voce', required: true, max: options.maxLength || 240 }));
}

function rateLimit({ windowMs, max, message }) {
  const buckets = new Map();
  let calls = 0;
  return (req, res, next) => {
    const now = Date.now();
    const key = `${req.ip || 'unknown'}:${req.path}`;
    const current = buckets.get(key);
    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
    } else {
      current.count += 1;
      if (current.count > max) {
        res.set('Retry-After', String(Math.ceil((current.resetAt - now) / 1000)));
        return res.status(429).json({ error: message || 'Troppe richieste. Riprova più tardi.', code: 'RATE_LIMITED' });
      }
    }
    calls += 1;
    if (calls % 500 === 0) {
      for (const [bucketKey, bucket] of buckets.entries()) if (bucket.resetAt <= now) buckets.delete(bucketKey);
    }
    next();
  };
}

function imageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

function safeOriginalName(value) {
  const base = path.basename(String(value || 'foto'));
  return base.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 160) || 'foto';
}

function paidSql(alias) {
  return `(${alias}.payment_status='paid' AND (${alias}.paid_until IS NULL OR ${alias}.paid_until>=CURRENT_DATE))`;
}

function appBaseUrl(config, req) {
  return config.appUrl || `${req.protocol}://${req.get('host')}`;
}

async function sendBrevo(config, to, subject, html) {
  if (!config.brevoApiKey || !config.brevoSenderEmail) return { sent: false, reason: 'not_configured' };
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': config.brevoApiKey,
      'Content-Type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { name: config.brevoSenderName, email: config.brevoSenderEmail },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Brevo ha risposto ${response.status}: ${detail.slice(0, 300)}`);
  }
  return { sent: true };
}

function createApp(options = {}) {
  const config = options.config || loadConfig();
  const pool = options.pool || createPool(config);
  const stripeClient = options.stripeClient === undefined
    ? (config.stripeSecretKey ? new Stripe(config.stripeSecretKey) : null)
    : options.stripeClient;
  const mailer = options.mailer || sendBrevo;
  const app = express();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 8, fields: 40 },
    fileFilter: (_req, file, callback) => {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
        return callback(new HttpError(400, 'Sono ammesse solo immagini JPEG, PNG o WebP', 'INVALID_UPLOAD'));
      }
      callback(null, true);
    },
  });

  const q = (sql, params = [], client = pool) => client.query(sql, params);
  const transaction = async (handler) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await handler(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => null);
      throw error;
    } finally {
      client.release();
    }
  };

  app.locals.config = config;
  app.locals.pool = pool;
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: config.isProduction ? [] : null,
      },
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }));
  if (!config.isTest) app.use(morgan(config.logFormat));
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    next();
  });

  function setCsrfCookie(res, existing) {
    const value = existing || randomToken(24);
    res.cookie(CSRF_COOKIE, value, {
      httpOnly: false,
      secure: config.isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 24 * 60 * 60 * 1000,
    });
    return value;
  }

  function setSessionCookie(res, user) {
    const token = jwt.sign(
      { id: user.id, role: user.role, customerId: user.customer_id || null, tokenVersion: Number(user.token_version || 0) },
      config.jwtSecret,
      { expiresIn: `${config.sessionDays}d`, issuer: 'home-care-pwa', audience: 'home-care-web' }
    );
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: config.isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: config.sessionDays * 24 * 60 * 60 * 1000,
    });
  }

  function clearSessionCookie(res) {
    res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: config.isProduction, sameSite: 'lax', path: '/' });
  }

  function requireCsrf(req, res, next) {
    if (!MUTATING_METHODS.has(req.method)) return next();
    const cookies = parseCookies(req.headers.cookie);
    const cookieToken = cookies[CSRF_COOKIE];
    const headerToken = req.get('x-csrf-token');
    if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
      return res.status(403).json({ error: 'Richiesta di sicurezza non valida. Ricarica la pagina.', code: 'CSRF_INVALID' });
    }
    const origin = req.get('origin');
    if (origin) {
      try {
        const parsed = new URL(origin);
        const sameHost = parsed.host === req.get('host');
        const sameProtocol = parsed.protocol === `${req.protocol}:`;
        const configuredOrigin = config.appUrl && origin === config.appUrl;
        if (!(sameHost && sameProtocol) && !configuredOrigin) {
          return res.status(403).json({ error: 'Origine della richiesta non consentita', code: 'ORIGIN_INVALID' });
        }
      } catch (_) {
        return res.status(403).json({ error: 'Origine della richiesta non valida', code: 'ORIGIN_INVALID' });
      }
    }
    next();
  }

  async function userById(id) {
    return (await q(
      `SELECT id,name,email,phone,role,customer_id,email_confirmed,token_version,created_at
         FROM users WHERE id=$1`,
      [id]
    )).rows[0] || null;
  }

  function auth(required = true) {
    return asyncHandler(async (req, res, next) => {
      const cookies = parseCookies(req.headers.cookie);
      const token = cookies[SESSION_COOKIE];
      if (!token) {
        if (!required) return next();
        throw new HttpError(401, 'Accesso richiesto', 'AUTH_REQUIRED');
      }
      let payload;
      try {
        payload = jwt.verify(token, config.jwtSecret, { issuer: 'home-care-pwa', audience: 'home-care-web' });
      } catch (_) {
        clearSessionCookie(res);
        throw new HttpError(401, 'Sessione non valida o scaduta', 'AUTH_INVALID');
      }
      const user = await userById(payload.id);
      if (!user || Number(user.token_version || 0) !== Number(payload.tokenVersion || 0)) {
        clearSessionCookie(res);
        throw new HttpError(401, 'Sessione non più valida', 'AUTH_INVALID');
      }
      req.user = user;
      next();
    });
  }

  const role = (...allowed) => (req, _res, next) => {
    if (!req.user || !allowed.includes(req.user.role)) return next(new HttpError(403, 'Operazione non autorizzata', 'FORBIDDEN'));
    next();
  };

  async function listPlans(client = pool, includeInactive = false) {
    const result = await q(
      `SELECT id,label,price_cents,price_label,features_json,days,from_price,active,sort_order,updated_at
         FROM plan_settings ${includeInactive ? '' : 'WHERE active=TRUE'}
        ORDER BY sort_order ASC,id ASC`,
      [],
      client
    );
    return result.rows.map((row) => ({
      id: row.id,
      label: row.label,
      price_cents: Number(row.price_cents),
      price_label: row.price_label,
      features: Array.isArray(row.features_json) ? row.features_json : [],
      days: Number(row.days),
      from_price: Boolean(row.from_price),
      active: Boolean(row.active),
      sort_order: Number(row.sort_order),
      updated_at: row.updated_at,
    }));
  }

  async function getPlan(id, client = pool, activeOnly = false) {
    const planId = text(id, { name: 'Piano', required: true, max: 60 });
    const row = (await q(
      `SELECT * FROM plan_settings WHERE id=$1 ${activeOnly ? 'AND active=TRUE' : ''}`,
      [planId],
      client
    )).rows[0];
    if (!row) throw new HttpError(400, 'Piano non disponibile', 'PLAN_INVALID');
    return row;
  }

  function customPlanSummary(plan) {
    const services = Array.isArray(plan.services_json) ? plan.services_json : [];
    const lines = services.map((item) => `• ${item.label}: €${(Number(item.price_cents || 0) / 100).toFixed(2)}`);
    return [
      plan.title,
      `Prezzo mensile finale: €${(Number(plan.final_price_cents || 0) / 100).toFixed(2)}`,
      lines.length ? `Servizi inclusi:\n${lines.join('\n')}` : '',
      plan.notes || '',
    ].filter(Boolean).join('\n');
  }

  async function reportRows(whereSql, params, client = pool, limit = 200) {
    const rows = (await q(
      `SELECT ch.id,ch.property_id,ch.due_date,ch.completed_at,ch.status,ch.notes,ch.checklist_json,ch.photo_urls,ch.created_at,
              p.name property_name,p.address,p.city,p.package_type,p.customer_id,
              c.name customer_name,c.phone customer_phone,
              COALESCE(json_agg(json_build_object('id',ph.id,'mime_type',ph.mime_type,'size_bytes',ph.size_bytes))
                FILTER (WHERE ph.id IS NOT NULL),'[]'::json) AS photos
         FROM checks ch
         JOIN properties p ON p.id=ch.property_id
         JOIN customers c ON c.id=p.customer_id
         LEFT JOIN check_photos ph ON ph.check_id=ch.id
        WHERE ch.status='done' ${whereSql}
        GROUP BY ch.id,p.id,c.id
        ORDER BY ch.completed_at DESC
        LIMIT $${params.length + 1}`,
      [...params, limit],
      client
    )).rows;
    return rows.map((row) => ({
      ...row,
      checklist_json: Array.isArray(row.checklist_json) ? row.checklist_json : [],
      photos: (Array.isArray(row.photos) ? row.photos : []).map((photo) => ({ ...photo, url: `/api/photos/${photo.id}` })),
    }));
  }

  async function activateCustomPlan(client, plan, senderMessage = true) {
    await q(
      `UPDATE customer_custom_plans
          SET status='draft',activated_at=NULL,updated_at=NOW()
        WHERE customer_id=$1 AND id<>$2 AND status='active'`,
      [plan.customer_id, plan.id],
      client
    );
    const active = (await q(
      `UPDATE customer_custom_plans
          SET status='active',activated_at=COALESCE(activated_at,NOW()),archived_at=NULL,updated_at=NOW()
        WHERE id=$1 RETURNING *`,
      [plan.id],
      client
    )).rows[0];
    await q(
      `UPDATE customers
          SET current_package_type='personalizzato',custom_monthly_price_cents=$2,custom_plan_summary=$3,
              current_custom_plan_id=$4,payment_status='unpaid',paid_until=NULL,updated_at=NOW()
        WHERE id=$1`,
      [active.customer_id, active.final_price_cents, customPlanSummary(active), active.id],
      client
    );
    if (active.property_id) {
      await q(
        `UPDATE properties
            SET package_type='personalizzato',monthly_price_cents=$2,request_status='approved',active=TRUE,
                approved_at=COALESCE(approved_at,NOW()),rejected_at=NULL,updated_at=NOW()
          WHERE id=$1 AND customer_id=$3`,
        [active.property_id, active.final_price_cents, active.customer_id],
        client
      );
    }
    if (senderMessage) {
      await q(
        `INSERT INTO messages(customer_id,sender_role,sender_name,body,read_by_client,read_by_admin)
         VALUES($1,'admin','Home Care',$2,FALSE,TRUE)`,
        [active.customer_id, `Il tuo piano personalizzato è pronto. Prezzo mensile confermato: €${(Number(active.final_price_cents) / 100).toFixed(2)}.`],
        client
      );
    }
    return active;
  }

  async function processStripeEvent(event, client) {
    const object = event.data && event.data.object ? event.data.object : {};
    if (event.type === 'checkout.session.completed') {
      const meta = object.metadata || {};
      const expected = Number(meta.expectedAmountCents || 0);
      if (expected && Number(object.amount_total || 0) !== expected) {
        throw new HttpError(400, 'Importo Stripe non coerente', 'STRIPE_AMOUNT_MISMATCH');
      }
      if (meta.kind === 'plan_subscription' && UUID_RE.test(meta.customerId || '')) {
        await q(
          `UPDATE customers
              SET payment_status='paid',paid_until=NULL,current_package_type=COALESCE($4,current_package_type),
                  stripe_customer_id=COALESCE($2,stripe_customer_id),stripe_subscription_id=COALESCE($3,stripe_subscription_id),updated_at=NOW()
            WHERE id=$1`,
          [meta.customerId, object.customer || null, object.subscription || null, meta.packageType || null],
          client
        );
      }
      if (meta.kind === 'plan_annual' && UUID_RE.test(meta.customerId || '')) {
        await q(
          `UPDATE customers
              SET payment_status='paid',paid_until=(CURRENT_DATE + INTERVAL '1 year')::date,
                  current_package_type=COALESCE($3,current_package_type),stripe_customer_id=COALESCE($2,stripe_customer_id),updated_at=NOW()
            WHERE id=$1`,
          [meta.customerId, object.customer || null, meta.packageType || null],
          client
        );
      }
      if (meta.kind === 'extra_payment' && UUID_RE.test(meta.extraPaymentId || '')) {
        const payment = (await q('SELECT amount_cents FROM extra_payments WHERE id=$1 FOR UPDATE', [meta.extraPaymentId], client)).rows[0];
        if (!payment || Number(payment.amount_cents) !== Number(object.amount_total || 0)) {
          throw new HttpError(400, 'Preventivo Stripe non coerente', 'STRIPE_AMOUNT_MISMATCH');
        }
        await q(
          `UPDATE extra_payments SET status='paid',paid_at=NOW(),payment_url=NULL,updated_at=NOW() WHERE id=$1`,
          [meta.extraPaymentId],
          client
        );
      }
    }

    if (event.type === 'invoice.paid' && object.customer) {
      await q(
        `UPDATE customers SET payment_status='paid',paid_until=NULL,updated_at=NOW() WHERE stripe_customer_id=$1`,
        [object.customer],
        client
      );
    }

    if (event.type === 'invoice.payment_failed' && object.customer) {
      await q(
        `UPDATE customers SET payment_status='past_due',updated_at=NOW() WHERE stripe_customer_id=$1`,
        [object.customer],
        client
      );
    }

    if (event.type === 'customer.subscription.updated' && object.customer) {
      const status = String(object.status || '');
      if (['active', 'trialing'].includes(status)) {
        await q(
          `UPDATE customers SET payment_status='paid',paid_until=NULL,stripe_subscription_id=$2,updated_at=NOW() WHERE stripe_customer_id=$1`,
          [object.customer, object.id || null],
          client
        );
      } else if (['past_due', 'unpaid', 'incomplete_expired'].includes(status)) {
        await q(`UPDATE customers SET payment_status='past_due',updated_at=NOW() WHERE stripe_customer_id=$1`, [object.customer], client);
      }
    }

    if (event.type === 'customer.subscription.deleted' && object.customer) {
      const periodEnd = Number(object.current_period_end || 0);
      const paidUntil = periodEnd > Math.floor(Date.now() / 1000)
        ? new Date(periodEnd * 1000).toISOString().slice(0, 10)
        : null;
      await q(
        `UPDATE customers
            SET payment_status=$2,paid_until=$3,stripe_subscription_id=NULL,updated_at=NOW()
          WHERE stripe_customer_id=$1`,
        [object.customer, paidUntil ? 'paid' : 'canceled', paidUntil],
        client
      );
    }
  }

  app.post('/api/stripe/webhook', express.raw({ type: 'application/json', limit: '1mb' }), asyncHandler(async (req, res) => {
    if (!stripeClient) return res.status(503).json({ error: 'Stripe non configurato', code: 'STRIPE_DISABLED' });
    let event;
    try {
      event = stripeClient.webhooks.constructEvent(req.body, req.get('stripe-signature'), config.stripeWebhookSecret);
    } catch (error) {
      return res.status(400).send(`Webhook Stripe non valido: ${error.message}`);
    }
    await transaction(async (client) => {
      const inserted = (await q(
        `INSERT INTO stripe_events(event_id,event_type) VALUES($1,$2)
         ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
        [event.id, event.type],
        client
      )).rows[0];
      if (!inserted) return;
      await processStripeEvent(event, client);
    });
    res.json({ received: true });
  }));

  app.use(express.json({ limit: '1mb', strict: true }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, max: 900 }));
  app.use('/api', requireCsrf);

  app.get('/sw.js', (_req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Service-Worker-Allowed', '/');
    res.sendFile(path.join(PUBLIC_DIR, 'sw.js'));
  });
  app.get('/manifest.json', (_req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.type('application/manifest+json').sendFile(path.join(PUBLIC_DIR, 'manifest.json'));
  });
  app.use(express.static(PUBLIC_DIR, {
    index: false,
    etag: true,
    maxAge: '1h',
    setHeaders: (res, filePath) => {
      if (/\.(?:js|css|html|json)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
    },
  }));

  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 12, message: 'Troppi tentativi. Riprova tra qualche minuto.' });
  const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 6, message: 'Troppe registrazioni da questo dispositivo.' });
  const messageLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: 'Stai inviando troppi messaggi.' });

  app.get('/api/health', asyncHandler(async (_req, res) => {
    try {
      await q('SELECT 1 AS ok');
      res.json({ ok: true, app: 'home-care-pwa', version: APP_VERSION, database: 'ok' });
    } catch (_) {
      res.status(503).json({ ok: false, app: 'home-care-pwa', version: APP_VERSION, database: 'unavailable' });
    }
  }));

  app.get('/api/config', asyncHandler(async (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    const csrfToken = setCsrfCookie(res, cookies[CSRF_COOKIE]);
    const plans = await listPlans();
    res.json({
      appName: 'Home Care',
      version: APP_VERSION,
      csrfToken,
      plans,
      stripeEnabled: Boolean(stripeClient),
      emailEnabled: Boolean(config.brevoApiKey && config.brevoSenderEmail),
      registrationEnabled: config.registrationEnabled && (!config.isProduction || Boolean(config.brevoApiKey && config.brevoSenderEmail)),
      maxUploadBytes: 8 * 1024 * 1024,
      maxUploadFiles: 8,
    });
  }));

  app.post('/api/auth/register', registerLimiter, asyncHandler(async (req, res) => {
    if (!config.registrationEnabled) throw new HttpError(403, 'Registrazione temporaneamente disabilitata', 'REGISTRATION_DISABLED');
    if (config.isProduction && (!config.brevoApiKey || !config.brevoSenderEmail)) {
      throw new HttpError(503, 'Registrazione non disponibile: servizio email non configurato', 'EMAIL_REQUIRED');
    }
    const name = text(req.body.name, { name: 'Nome e cognome', required: true, min: 2, max: 120 });
    const mail = email(req.body.email, { required: true });
    const phone = text(req.body.phone, { name: 'Telefono', max: 40 });
    const password = text(req.body.password, { name: 'Password', required: true, min: 10, max: 200, trim: false });
    const rawCode = randomToken(32);
    const codeHash = tokenHash(rawCode);
    const expires = new Date(Date.now() + 48 * 60 * 60 * 1000);

    const created = await transaction(async (client) => {
      const duplicate = (await q('SELECT id FROM users WHERE LOWER(email)=LOWER($1)', [mail], client)).rows[0];
      if (duplicate) throw new HttpError(409, 'Email già registrata', 'EMAIL_EXISTS');
      const customer = (await q(
        `INSERT INTO customers(name,email,phone,payment_status) VALUES($1,$2,$3,'unpaid') RETURNING *`,
        [name, mail, phone],
        client
      )).rows[0];
      const passwordHash = await bcrypt.hash(password, 12);
      const user = (await q(
        `INSERT INTO users(name,email,phone,password_hash,role,customer_id,email_confirmed,email_confirm_code,email_confirm_expires_at)
         VALUES($1,$2,$3,$4,'client',$5,FALSE,$6,$7) RETURNING id,name,email,customer_id`,
        [name, mail, phone, passwordHash, customer.id, codeHash, expires],
        client
      )).rows[0];
      return { customer, user };
    });

    const confirmationUrl = `${appBaseUrl(config, req)}/api/auth/confirm-email?code=${encodeURIComponent(rawCode)}`;
    const body = `<div style="font-family:Arial,sans-serif;color:#09243d"><h1>Conferma il tuo account Home Care</h1><p>Ciao ${htmlEscape(name)}, conferma l’indirizzo email per accedere all’area cliente.</p><p><a href="${htmlEscape(confirmationUrl)}">Conferma il tuo account</a></p><p>Il collegamento scade tra 48 ore.</p></div>`;
    let sent = false;
    try { sent = (await mailer(config, mail, 'Conferma il tuo account Home Care', body)).sent; } catch (error) { console.error('Invio conferma email non riuscito:', error.message); }
    res.status(201).json({
      message: sent ? 'Registrazione completata. Controlla la tua email.' : 'Registrazione completata. L’email non è stata inviata: usa “Invia di nuovo” dalla schermata di accesso.',
      emailSent: sent,
      confirmationUrl: !config.isProduction && !sent ? confirmationUrl : undefined,
      customerId: created.customer.id,
    });
  }));

  app.post('/api/auth/resend-confirmation', authLimiter, asyncHandler(async (req, res) => {
    const mail = email(req.body.email, { required: true });
    const user = (await q(`SELECT id,name,email,email_confirmed FROM users WHERE LOWER(email)=LOWER($1) AND role='client'`, [mail])).rows[0];
    let developmentUrl;
    if (user && !user.email_confirmed) {
      const rawCode = randomToken(32);
      await q(
        `UPDATE users SET email_confirm_code=$2,email_confirm_expires_at=NOW()+INTERVAL '48 hours',updated_at=NOW() WHERE id=$1`,
        [user.id, tokenHash(rawCode)]
      );
      const confirmationUrl = `${appBaseUrl(config, req)}/api/auth/confirm-email?code=${encodeURIComponent(rawCode)}`;
      const body = `<div style="font-family:Arial,sans-serif;color:#09243d"><h1>Conferma il tuo account Home Care</h1><p>Ciao ${htmlEscape(user.name)}, usa questo collegamento:</p><p><a href="${htmlEscape(confirmationUrl)}">Conferma il tuo account</a></p></div>`;
      try { await mailer(config, user.email, 'Nuovo link di conferma Home Care', body); } catch (error) { console.error('Reinvio conferma non riuscito:', error.message); }
      if (!config.isProduction && (!config.brevoApiKey || !config.brevoSenderEmail)) developmentUrl = confirmationUrl;
    }
    res.json({ message: 'Se l’account esiste ed è in attesa, riceverai un nuovo link.', confirmationUrl: developmentUrl });
  }));

  app.get('/api/auth/confirm-email', asyncHandler(async (req, res) => {
    const raw = text(req.query.code, { name: 'Codice', required: true, max: 200 });
    const updated = (await q(
      `UPDATE users
          SET email_confirmed=TRUE,email_confirm_code=NULL,email_confirm_expires_at=NULL,updated_at=NOW()
        WHERE email_confirm_code=$1 AND email_confirm_expires_at>NOW()
        RETURNING id`,
      [tokenHash(raw)]
    )).rows[0];
    const ok = Boolean(updated);
    res.status(ok ? 200 : 400).type('html').send(`<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Home Care</title><link rel="stylesheet" href="/app.css"></head><body class="confirmation-page"><main class="confirmation-card"><div class="brand-lockup"><span class="brand-mark">HC</span><span>Home Care</span></div><h1>${ok ? 'Email confermata' : 'Link non valido o scaduto'}</h1><p>${ok ? 'Il tuo account è attivo. Ora puoi accedere.' : 'Richiedi un nuovo collegamento dalla schermata di accesso.'}</p><a class="button primary" href="/">Torna a Home Care</a></main></body></html>`);
  }));

  app.post('/api/auth/login', authLimiter, asyncHandler(async (req, res) => {
    const mail = email(req.body.email, { required: true });
    const password = text(req.body.password, { name: 'Password', required: true, max: 200, trim: false });
    const user = (await q('SELECT * FROM users WHERE LOWER(email)=LOWER($1)', [mail])).rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      throw new HttpError(401, 'Credenziali non valide', 'LOGIN_FAILED');
    }
    if (user.role === 'client' && !user.email_confirmed) {
      throw new HttpError(403, 'Email non confermata. Richiedi un nuovo link.', 'EMAIL_NOT_CONFIRMED');
    }
    setSessionCookie(res, user);
    const cookies = parseCookies(req.headers.cookie);
    const csrfToken = setCsrfCookie(res, cookies[CSRF_COOKIE]);
    res.json({
      csrfToken,
      user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role, customerId: user.customer_id },
    });
  }));

  app.post('/api/auth/logout', auth(false), asyncHandler(async (_req, res) => {
    clearSessionCookie(res);
    const csrfToken = setCsrfCookie(res);
    res.json({ ok: true, csrfToken });
  }));

  app.get('/api/auth/me', auth(), (req, res) => res.json({ user: req.user }));

  app.post('/api/auth/forgot-password', authLimiter, asyncHandler(async (req, res) => {
    const mail = email(req.body.email, { required: true });
    const user = (await q('SELECT id,name,email FROM users WHERE LOWER(email)=LOWER($1)', [mail])).rows[0];
    let developmentUrl;
    if (user) {
      const raw = randomToken(32);
      await q(
        `UPDATE users SET password_reset_code=$2,password_reset_expires_at=NOW()+INTERVAL '60 minutes',updated_at=NOW() WHERE id=$1`,
        [user.id, tokenHash(raw)]
      );
      const resetUrl = `${appBaseUrl(config, req)}/?reset=${encodeURIComponent(raw)}`;
      const body = `<div style="font-family:Arial,sans-serif;color:#09243d"><h1>Reimposta la password Home Care</h1><p>Ciao ${htmlEscape(user.name)}, il link è valido per 60 minuti.</p><p><a href="${htmlEscape(resetUrl)}">Reimposta la password</a></p></div>`;
      try { await mailer(config, user.email, 'Reimposta la password Home Care', body); } catch (error) { console.error('Invio reset password non riuscito:', error.message); }
      if (!config.isProduction && (!config.brevoApiKey || !config.brevoSenderEmail)) developmentUrl = resetUrl;
    }
    res.json({ message: 'Se l’account esiste, riceverai le istruzioni.', resetUrl: developmentUrl });
  }));

  app.post('/api/auth/reset-password', authLimiter, asyncHandler(async (req, res) => {
    const raw = text(req.body.code, { name: 'Codice', required: true, max: 200 });
    const password = text(req.body.password, { name: 'Password', required: true, min: 10, max: 200, trim: false });
    const passwordHash = await bcrypt.hash(password, 12);
    const user = (await q(
      `UPDATE users
          SET password_hash=$2,password_reset_code=NULL,password_reset_expires_at=NULL,
              token_version=token_version+1,updated_at=NOW()
        WHERE password_reset_code=$1 AND password_reset_expires_at>NOW()
        RETURNING id`,
      [tokenHash(raw), passwordHash]
    )).rows[0];
    if (!user) throw new HttpError(400, 'Link non valido o scaduto', 'RESET_INVALID');
    clearSessionCookie(res);
    res.json({ message: 'Password aggiornata. Ora puoi accedere.' });
  }));

  app.get('/api/admin/summary', auth(), role('admin', 'helper'), asyncHandler(async (req, res) => {
    const [customers, properties, due, blocked, tasks, extras, requests] = await Promise.all([
      q('SELECT COUNT(*)::int count FROM customers'),
      q(`SELECT COUNT(*)::int count FROM properties WHERE active=TRUE AND request_status='approved'`),
      q(`SELECT COUNT(*)::int count FROM properties p JOIN customers c ON c.id=p.customer_id WHERE p.active=TRUE AND p.request_status='approved' AND p.next_check_date<=CURRENT_DATE AND ${paidSql('c')}`),
      q(`SELECT COUNT(*)::int count FROM properties p JOIN customers c ON c.id=p.customer_id WHERE p.active=TRUE AND p.request_status='approved' AND p.next_check_date<=CURRENT_DATE AND NOT ${paidSql('c')}`),
      q(`SELECT COUNT(*)::int count FROM tasks WHERE status='todo' AND due_date<=CURRENT_DATE`),
      req.user.role === 'admin' ? q(`SELECT COUNT(*)::int count FROM extra_payments WHERE status='pending'`) : Promise.resolve({ rows: [{ count: 0 }] }),
      q(`SELECT COUNT(*)::int count FROM properties WHERE request_status='pending'`),
    ]);
    res.json({
      customers: customers.rows[0].count,
      properties: properties.rows[0].count,
      dueChecks: due.rows[0].count,
      blockedChecks: blocked.rows[0].count,
      todoTasks: tasks.rows[0].count,
      pendingExtraPayments: extras.rows[0].count,
      pendingProperties: requests.rows[0].count,
    });
  }));

  app.get('/api/admin/customers', auth(), role('admin', 'helper'), asyncHandler(async (req, res) => {
    const select = req.user.role === 'admin'
      ? `c.*,COUNT(p.id)::int properties_count,CASE WHEN ${paidSql('c')} THEN TRUE ELSE FALSE END payment_valid`
      : `c.id,c.name,c.email,c.phone,c.notes,c.current_package_type,c.created_at,COUNT(p.id)::int properties_count`;
    const rows = (await q(
      `SELECT ${select}
         FROM customers c LEFT JOIN properties p ON p.customer_id=c.id
        GROUP BY c.id ORDER BY c.created_at DESC`
    )).rows;
    res.json({ customers: rows });
  }));

  app.post('/api/admin/customers', auth(), role('admin'), asyncHandler(async (req, res) => {
    const name = text(req.body.name, { name: 'Nome cliente', required: true, min: 2, max: 120 });
    const mail = email(req.body.email);
    const phone = text(req.body.phone, { name: 'Telefono', max: 40 });
    const notes = text(req.body.notes, { name: 'Note', max: 3000 });
    const packageType = req.body.current_package_type ? (await getPlan(req.body.current_package_type)).id : null;
    const row = (await q(
      `INSERT INTO customers(name,email,phone,notes,current_package_type,payment_status)
       VALUES($1,$2,$3,$4,$5,'unpaid') RETURNING *`,
      [name, mail, phone, notes, packageType]
    )).rows[0];
    res.status(201).json({ customer: row });
  }));

  app.post('/api/admin/customers/:id/manual-payment', auth(), role('admin'), asyncHandler(async (req, res) => {
    const customerId = uuid(req.params.id, 'Cliente');
    const paidUntil = isoDate(req.body.paid_until, { name: 'Pagato fino al', required: true });
    const packageType = (await getPlan(req.body.package_type || 'base')).id;
    const amount = cents(req.body.amount_euro, { name: 'Importo' });
    const method = enumValue(req.body.method || 'contanti', ['contanti', 'bonifico', 'assegno', 'carta', 'altro'], { name: 'Metodo', required: true });
    const description = text(req.body.description || 'Pagamento manuale', { name: 'Descrizione', required: true, max: 500 });
    const customer = await transaction(async (client) => {
      const exists = (await q('SELECT id FROM customers WHERE id=$1 FOR UPDATE', [customerId], client)).rows[0];
      if (!exists) throw new HttpError(404, 'Cliente non trovato', 'NOT_FOUND');
      await q(
        `INSERT INTO manual_payments(customer_id,amount_cents,package_type,method,description,paid_until)
         VALUES($1,$2,$3,$4,$5,$6)`,
        [customerId, amount, packageType, method, description, paidUntil],
        client
      );
      return (await q(
        `UPDATE customers
            SET payment_status='paid',paid_until=$2,current_package_type=$3,manual_payment_note=$4,last_manual_payment_at=NOW(),updated_at=NOW()
          WHERE id=$1 RETURNING *`,
        [customerId, paidUntil, packageType, `${method}${amount ? ` - €${(amount / 100).toFixed(2)}` : ''} - ${description}`],
        client
      )).rows[0];
    });
    res.json({ customer });
  }));

  app.delete('/api/admin/customers/:id', auth(), role('admin'), asyncHandler(async (req, res) => {
    const customerId = uuid(req.params.id, 'Cliente');
    const confirmName = text(req.body.confirmName, { name: 'Nome di conferma', required: true, max: 120 });
    const confirmation = text(req.body.confirmation, { name: 'Conferma', required: true, max: 20 });
    if (confirmation !== 'ELIMINA') throw new HttpError(400, 'Conferma non corretta', 'CONFIRMATION_INVALID');
    const deleted = await transaction(async (client) => {
      const customer = (await q('SELECT id,name FROM customers WHERE id=$1 FOR UPDATE', [customerId], client)).rows[0];
      if (!customer) throw new HttpError(404, 'Cliente non trovato', 'NOT_FOUND');
      if (customer.name !== confirmName) throw new HttpError(400, 'Il nome del cliente non corrisponde', 'CONFIRMATION_INVALID');
      await q('DELETE FROM customers WHERE id=$1', [customerId], client);
      return customer;
    });
    res.json({ ok: true, deleted });
  }));

  app.get('/api/admin/helpers', auth(), role('admin'), asyncHandler(async (_req, res) => {
    const helpers = (await q(`SELECT id,name,email,phone,email_confirmed,created_at FROM users WHERE role='helper' ORDER BY created_at DESC`)).rows;
    res.json({ helpers });
  }));

  app.post('/api/admin/helpers', auth(), role('admin'), asyncHandler(async (req, res) => {
    const name = text(req.body.name, { name: 'Nome', required: true, min: 2, max: 120 });
    const mail = email(req.body.email, { required: true });
    const phone = text(req.body.phone, { name: 'Telefono', max: 40 });
    const password = text(req.body.password, { name: 'Password', required: true, min: 10, max: 200, trim: false });
    const duplicate = (await q('SELECT id FROM users WHERE LOWER(email)=LOWER($1)', [mail])).rows[0];
    if (duplicate) throw new HttpError(409, 'Email già utilizzata', 'EMAIL_EXISTS');
    const passwordHash = await bcrypt.hash(password, 12);
    const helper = (await q(
      `INSERT INTO users(name,email,phone,password_hash,role,email_confirmed)
       VALUES($1,$2,$3,$4,'helper',TRUE)
       RETURNING id,name,email,phone,role,email_confirmed,created_at`,
      [name, mail, phone, passwordHash]
    )).rows[0];
    res.status(201).json({ helper });
  }));

  app.get('/api/admin/properties', auth(), role('admin', 'helper'), asyncHandler(async (req, res) => {
    const financial = req.user.role === 'admin'
      ? `,c.payment_status,c.paid_until,CASE WHEN ${paidSql('c')} THEN TRUE ELSE FALSE END payment_valid`
      : '';
    const properties = (await q(
      `SELECT p.*,c.name customer_name,c.email customer_email,c.phone customer_phone${financial}
         FROM properties p JOIN customers c ON c.id=p.customer_id
        ORDER BY CASE p.request_status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,p.created_at DESC`
    )).rows;
    res.json({ properties });
  }));

  app.get('/api/admin/property-requests', auth(), role('admin'), asyncHandler(async (_req, res) => {
    const requests = (await q(
      `SELECT p.*,c.name customer_name,c.email customer_email,c.phone customer_phone
         FROM properties p JOIN customers c ON c.id=p.customer_id
        WHERE p.request_status='pending'
        ORDER BY p.requested_at DESC NULLS LAST,p.created_at DESC`
    )).rows;
    res.json({ requests });
  }));

  app.post('/api/admin/properties', auth(), role('admin'), asyncHandler(async (req, res) => {
    const customerId = uuid(req.body.customer_id, 'Cliente');
    const name = text(req.body.name, { name: 'Nome immobile', required: true, max: 160 });
    const address = text(req.body.address, { name: 'Indirizzo', max: 300 });
    const city = text(req.body.city || 'Badesi', { name: 'Comune', required: true, max: 120 });
    const zone = text(req.body.zone, { name: 'Zona', max: 120 });
    const notes = text(req.body.notes, { name: 'Note', max: 3000 });
    const plan = await getPlan(req.body.package_type || 'base', pool, true);
    const monthlyPrice = cents(req.body.monthly_price_euro, { name: 'Prezzo mensile' }) || Number(plan.price_cents);
    const latitude = numberValue(req.body.latitude, { name: 'Latitudine', min: -90, max: 90 });
    const longitude = numberValue(req.body.longitude, { name: 'Longitudine', min: -180, max: 180 });
    const property = (await q(
      `INSERT INTO properties(customer_id,name,address,city,zone,package_type,monthly_price_cents,next_check_date,active,notes,request_status,approved_at,latitude,longitude)
       VALUES($1,$2,$3,$4,$5,$6,$7,CURRENT_DATE,TRUE,$8,'approved',NOW(),$9,$10) RETURNING *`,
      [customerId, name, address, city, zone, plan.id, monthlyPrice, notes, latitude, longitude]
    )).rows[0];
    await q(`UPDATE customers SET current_package_type=COALESCE(current_package_type,$2),updated_at=NOW() WHERE id=$1`, [customerId, plan.id]);
    res.status(201).json({ property });
  }));

  app.post('/api/admin/properties/:id/location', auth(), role('admin', 'helper'), asyncHandler(async (req, res) => {
    const propertyId = uuid(req.params.id, 'Immobile');
    const latitude = numberValue(req.body.latitude, { name: 'Latitudine', min: -90, max: 90, required: true });
    const longitude = numberValue(req.body.longitude, { name: 'Longitudine', min: -180, max: 180, required: true });
    const property = (await q(
      `UPDATE properties SET latitude=$2,longitude=$3,updated_at=NOW() WHERE id=$1 RETURNING *`,
      [propertyId, latitude, longitude]
    )).rows[0];
    if (!property) throw new HttpError(404, 'Immobile non trovato', 'NOT_FOUND');
    res.json({ property });
  }));

  app.post('/api/admin/properties/:id/approve', auth(), role('admin'), asyncHandler(async (req, res) => {
    const propertyId = uuid(req.params.id, 'Immobile');
    const plan = await getPlan(req.body.package_type || 'base', pool, true);
    const overridePrice = cents(req.body.monthly_price_euro, { name: 'Prezzo mensile' });
    if (plan.id === 'personalizzato' && !overridePrice) {
      throw new HttpError(400, 'Indica il prezzo definitivo del piano personalizzato', 'PRICE_REQUIRED');
    }
    const result = await transaction(async (client) => {
      const current = (await q('SELECT * FROM properties WHERE id=$1 FOR UPDATE', [propertyId], client)).rows[0];
      if (!current) throw new HttpError(404, 'Immobile non trovato', 'NOT_FOUND');
      const price = overridePrice || Number(plan.price_cents);
      let activePlan = null;
      if (plan.id === 'personalizzato') {
        await q(`UPDATE customer_custom_plans SET status='draft',activated_at=NULL,updated_at=NOW() WHERE customer_id=$1 AND status='active'`, [current.customer_id], client);
        activePlan = (await q(
          `INSERT INTO customer_custom_plans(customer_id,property_id,title,services_json,base_price_cents,services_total_cents,subtotal_cents,final_price_cents,notes,status,activated_at)
           VALUES($1,$2,$3,'[]'::jsonb,$4,0,$4,$4,$5,'active',NOW()) RETURNING *`,
          [current.customer_id, current.id, `Piano personalizzato - ${current.name}`, price, current.client_notes || current.notes],
          client
        )).rows[0];
        await q(
          `UPDATE customers SET current_package_type='personalizzato',custom_monthly_price_cents=$2,custom_plan_summary=$3,current_custom_plan_id=$4,payment_status='unpaid',paid_until=NULL,updated_at=NOW() WHERE id=$1`,
          [current.customer_id, price, customPlanSummary(activePlan), activePlan.id],
          client
        );
      } else {
        await q(
          `UPDATE customers SET current_package_type=$2,custom_monthly_price_cents=NULL,custom_plan_summary=NULL,current_custom_plan_id=NULL,updated_at=NOW() WHERE id=$1`,
          [current.customer_id, plan.id],
          client
        );
      }
      const property = (await q(
        `UPDATE properties
            SET active=TRUE,request_status='approved',package_type=$2,monthly_price_cents=$3,
                approved_at=NOW(),rejected_at=NULL,updated_at=NOW()
          WHERE id=$1 RETURNING *`,
        [propertyId, plan.id, price],
        client
      )).rows[0];
      await q(
        `INSERT INTO messages(customer_id,sender_role,sender_name,body,read_by_client,read_by_admin)
         VALUES($1,'admin','Home Care',$2,FALSE,TRUE)`,
        [current.customer_id, `La richiesta per ${current.name} è stata approvata. Prezzo mensile: €${(price / 100).toFixed(2)}.`],
        client
      );
      return { property, customPlan: activePlan };
    });
    res.json(result);
  }));

  app.post('/api/admin/properties/:id/reject', auth(), role('admin'), asyncHandler(async (req, res) => {
    const propertyId = uuid(req.params.id, 'Immobile');
    const reason = text(req.body.reason || 'Richiesta non approvata', { name: 'Motivo', required: true, max: 1000 });
    const property = await transaction(async (client) => {
      const row = (await q(
        `UPDATE properties SET request_status='rejected',active=FALSE,rejected_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *`,
        [propertyId],
        client
      )).rows[0];
      if (!row) throw new HttpError(404, 'Immobile non trovato', 'NOT_FOUND');
      await q(
        `INSERT INTO messages(customer_id,sender_role,sender_name,body,read_by_client,read_by_admin)
         VALUES($1,'admin','Home Care',$2,FALSE,TRUE)`,
        [row.customer_id, `La richiesta per ${row.name} non è stata approvata. ${reason}`],
        client
      );
      return row;
    });
    res.json({ property });
  }));

  app.get('/api/admin/due-checks', auth(), role('admin', 'helper'), asyncHandler(async (_req, res) => {
    const checks = (await q(
      `SELECT p.id,p.name,p.address,p.city,p.package_type,p.next_check_date,p.latitude,p.longitude,
              c.name customer_name,c.phone customer_phone,
              CASE WHEN ${paidSql('c')} THEN FALSE ELSE TRUE END blocked
         FROM properties p JOIN customers c ON c.id=p.customer_id
        WHERE p.active=TRUE AND p.request_status='approved' AND p.next_check_date<=CURRENT_DATE
        ORDER BY blocked,p.next_check_date,c.name`
    )).rows;
    res.json({ checks });
  }));

  app.post('/api/admin/checks/complete', auth(), role('admin', 'helper'), upload.array('photos', 8), asyncHandler(async (req, res) => {
    const propertyId = uuid(req.body.property_id, 'Immobile');
    const notes = text(req.body.notes, { name: 'Note', max: 5000 });
    const checklist = listOfStrings(req.body.checklist_json || [], { name: 'Checklist', maxItems: 80, maxLength: 300 });
    const files = req.files || [];
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > 32 * 1024 * 1024) throw new HttpError(400, 'Le foto superano il limite complessivo di 32 MB', 'INVALID_UPLOAD');
    const verifiedFiles = files.map((file) => {
      const detected = imageType(file.buffer);
      if (!detected || detected !== file.mimetype) throw new HttpError(400, 'Una foto non è un’immagine valida', 'INVALID_UPLOAD');
      return {
        ...file,
        detected,
        sha256: crypto.createHash('sha256').update(file.buffer).digest('hex'),
      };
    });

    const check = await transaction(async (client) => {
      const property = (await q(
        `SELECT p.*,ps.days,CASE WHEN ${paidSql('c')} THEN TRUE ELSE FALSE END payment_valid
           FROM properties p
           JOIN customers c ON c.id=p.customer_id
           JOIN plan_settings ps ON ps.id=p.package_type
          WHERE p.id=$1 FOR UPDATE OF p`,
        [propertyId],
        client
      )).rows[0];
      if (!property) throw new HttpError(404, 'Immobile non trovato', 'NOT_FOUND');
      if (!property.active || property.request_status !== 'approved') throw new HttpError(409, 'Immobile non attivo', 'PROPERTY_INACTIVE');
      if (!property.payment_valid) throw new HttpError(402, 'Pagamento non regolare: controllo sospeso', 'PAYMENT_REQUIRED');
      const row = (await q(
        `INSERT INTO checks(property_id,due_date,completed_at,status,notes,checklist_json)
         VALUES($1,CURRENT_DATE,NOW(),'done',$2,$3::jsonb) RETURNING *`,
        [propertyId, notes, JSON.stringify(checklist)],
        client
      )).rows[0];
      for (const file of verifiedFiles) {
        await q(
          `INSERT INTO check_photos(check_id,mime_type,original_name,size_bytes,sha256,image_data)
           VALUES($1,$2,$3,$4,$5,$6)`,
          [row.id, file.detected, safeOriginalName(file.originalname), file.size, file.sha256, file.buffer],
          client
        );
      }
      await q(
        `UPDATE properties SET next_check_date=CURRENT_DATE+$2::int,updated_at=NOW() WHERE id=$1`,
        [propertyId, Number(property.days || 30)],
        client
      );
      return row;
    });
    res.status(201).json({ check });
  }));

  app.get('/api/admin/reports', auth(), role('admin', 'helper'), asyncHandler(async (_req, res) => {
    res.json({ reports: await reportRows('', []) });
  }));

  app.get('/api/photos/:id', auth(), asyncHandler(async (req, res) => {
    const photoId = uuid(req.params.id, 'Foto');
    const photo = (await q(
      `SELECT ph.mime_type,ph.original_name,ph.size_bytes,ph.image_data,p.customer_id
         FROM check_photos ph
         JOIN checks ch ON ch.id=ph.check_id
         JOIN properties p ON p.id=ch.property_id
        WHERE ph.id=$1`,
      [photoId]
    )).rows[0];
    if (!photo) throw new HttpError(404, 'Foto non trovata', 'NOT_FOUND');
    if (req.user.role === 'client' && req.user.customer_id !== photo.customer_id) {
      throw new HttpError(403, 'Foto non autorizzata', 'FORBIDDEN');
    }
    res.set('Content-Type', photo.mime_type);
    res.set('Content-Length', String(photo.size_bytes));
    res.set('Content-Disposition', `inline; filename="${safeOriginalName(photo.original_name)}"`);
    res.set('Cache-Control', 'private, max-age=300');
    res.set('X-Content-Type-Options', 'nosniff');
    res.send(photo.image_data);
  }));

  app.get('/api/admin/tasks', auth(), role('admin', 'helper'), asyncHandler(async (req, res) => {
    const status = enumValue(req.query.status || 'todo', ['todo', 'done', 'blocked'], { name: 'Stato', required: true });
    const tasks = (await q(
      `SELECT t.*,c.name customer_name,p.name property_name,p.address
         FROM tasks t LEFT JOIN customers c ON c.id=t.customer_id LEFT JOIN properties p ON p.id=t.property_id
        WHERE t.status=$1 ORDER BY t.due_date,t.priority DESC,t.created_at DESC`,
      [status]
    )).rows;
    res.json({ tasks });
  }));

  app.post('/api/admin/tasks', auth(), role('admin', 'helper'), asyncHandler(async (req, res) => {
    const title = text(req.body.title, { name: 'Titolo', required: true, max: 200 });
    const description = text(req.body.description, { name: 'Descrizione', max: 3000 });
    const type = text(req.body.type || 'controllo', { name: 'Tipo', required: true, max: 80 });
    const priority = enumValue(req.body.priority || 'normale', ['bassa', 'normale', 'alta'], { name: 'Priorità', required: true });
    const dueDate = isoDate(req.body.due_date, { name: 'Scadenza' });
    const customerId = req.body.customer_id ? uuid(req.body.customer_id, 'Cliente') : null;
    const propertyId = req.body.property_id ? uuid(req.body.property_id, 'Immobile') : null;
    const task = (await q(
      `INSERT INTO tasks(title,description,type,priority,due_date,customer_id,property_id)
       VALUES($1,$2,$3,$4,COALESCE($5,CURRENT_DATE),$6,$7) RETURNING *`,
      [title, description, type, priority, dueDate, customerId, propertyId]
    )).rows[0];
    res.status(201).json({ task });
  }));

  app.post('/api/admin/tasks/:id/done', auth(), role('admin', 'helper'), asyncHandler(async (req, res) => {
    const taskId = uuid(req.params.id, 'Attività');
    const task = (await q(
      `UPDATE tasks SET status='done',completed_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *`,
      [taskId]
    )).rows[0];
    if (!task) throw new HttpError(404, 'Attività non trovata', 'NOT_FOUND');
    res.json({ task });
  }));

  app.get('/api/admin/route-plan', auth(), role('admin', 'helper'), asyncHandler(async (req, res) => {
    const lat = numberValue(req.query.lat ?? 40.9663, { name: 'Latitudine', min: -90, max: 90, required: true });
    const lng = numberValue(req.query.lng ?? 8.8814, { name: 'Longitudine', min: -180, max: 180, required: true });
    const onlyDue = req.query.onlyDue !== '0';
    const conditions = [`p.active=TRUE`, `p.request_status='approved'`, `p.latitude IS NOT NULL`, `p.longitude IS NOT NULL`, paidSql('c')];
    if (onlyDue) conditions.push('p.next_check_date<=CURRENT_DATE');
    const rows = (await q(
      `SELECT p.id,p.name,p.address,p.latitude,p.longitude,p.package_type,c.name customer_name,c.phone customer_phone
         FROM properties p JOIN customers c ON c.id=p.customer_id
        WHERE ${conditions.join(' AND ')}`
    )).rows;
    const rad = (value) => Number(value) * Math.PI / 180;
    const distance = (a, b, c, d) => {
      const radius = 6371;
      const dLat = rad(c - a);
      const dLng = rad(d - b);
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(dLng / 2) ** 2;
      return 2 * radius * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    };
    const remaining = rows.map((item) => ({ ...item }));
    const ordered = [];
    let currentLat = lat;
    let currentLng = lng;
    let total = 0;
    while (remaining.length) {
      let index = 0;
      let best = Infinity;
      remaining.forEach((item, itemIndex) => {
        const km = distance(currentLat, currentLng, Number(item.latitude), Number(item.longitude));
        if (km < best) { best = km; index = itemIndex; }
      });
      const [item] = remaining.splice(index, 1);
      item.distance_from_previous_km = Number(best.toFixed(2));
      total += best;
      ordered.push(item);
      currentLat = Number(item.latitude);
      currentLng = Number(item.longitude);
    }
    res.json({ origin: { lat, lng }, totalKm: Number(total.toFixed(2)), properties: ordered });
  }));

  app.get('/api/admin/extra-payments', auth(), role('admin'), asyncHandler(async (_req, res) => {
    const payments = (await q(
      `SELECT e.*,c.name customer_name,c.email customer_email,c.phone customer_phone
         FROM extra_payments e JOIN customers c ON c.id=e.customer_id ORDER BY e.created_at DESC`
    )).rows;
    res.json({ payments });
  }));

  app.post('/api/admin/extra-payments', auth(), role('admin'), asyncHandler(async (req, res) => {
    const customerId = uuid(req.body.customer_id, 'Cliente');
    const amount = cents(req.body.amount_euro, { name: 'Importo', required: true });
    const description = text(req.body.description, { name: 'Descrizione', required: true, max: 1000 });
    const payment = (await q(
      `INSERT INTO extra_payments(customer_id,amount_cents,description) VALUES($1,$2,$3) RETURNING *`,
      [customerId, amount, description]
    )).rows[0];
    res.status(201).json({ payment });
  }));

  app.post('/api/admin/extra-payments/:id/cancel', auth(), role('admin'), asyncHandler(async (req, res) => {
    const paymentId = uuid(req.params.id, 'Pagamento');
    const payment = (await q(
      `UPDATE extra_payments SET status='canceled',payment_url=NULL,updated_at=NOW() WHERE id=$1 AND status='pending' RETURNING *`,
      [paymentId]
    )).rows[0];
    if (!payment) throw new HttpError(404, 'Pagamento non trovato o non annullabile', 'NOT_FOUND');
    res.json({ payment });
  }));

  app.get('/api/admin/manual-payments', auth(), role('admin'), asyncHandler(async (_req, res) => {
    const payments = (await q(
      `SELECT m.*,c.name customer_name FROM manual_payments m JOIN customers c ON c.id=m.customer_id ORDER BY m.created_at DESC LIMIT 200`
    )).rows;
    res.json({ payments });
  }));

  app.get('/api/client/contacts', auth(), role('client'), asyncHandler(async (_req, res) => {
    const contacts = (await q(`SELECT * FROM contact_channels WHERE active=TRUE ORDER BY sort_order,created_at`)).rows;
    res.json({ contacts });
  }));

  app.get('/api/admin/contacts', auth(), role('admin'), asyncHandler(async (_req, res) => {
    const contacts = (await q(`SELECT * FROM contact_channels ORDER BY active DESC,sort_order,created_at`)).rows;
    res.json({ contacts });
  }));

  app.post('/api/admin/contacts', auth(), role('admin'), asyncHandler(async (req, res) => {
    const label = text(req.body.label, { name: 'Nome contatto', required: true, max: 120 });
    const kind = enumValue(req.body.kind || 'altro', ['telefono', 'whatsapp', 'email', 'sito', 'altro'], { name: 'Tipo', required: true });
    const value = text(req.body.value, { name: 'Contatto', required: true, max: 300 });
    const note = text(req.body.note, { name: 'Nota', max: 500 });
    const sortOrder = numberValue(req.body.sort_order ?? 0, { name: 'Ordine', min: -1000, max: 1000, integer: true, required: true });
    const active = booleanValue(req.body.active, true);
    const contact = (await q(
      `INSERT INTO contact_channels(label,kind,value,note,sort_order,active) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [label, kind, value, note, sortOrder, active]
    )).rows[0];
    res.status(201).json({ contact });
  }));

  app.patch('/api/admin/contacts/:id', auth(), role('admin'), asyncHandler(async (req, res) => {
    const contactId = uuid(req.params.id, 'Contatto');
    const current = (await q('SELECT * FROM contact_channels WHERE id=$1', [contactId])).rows[0];
    if (!current) throw new HttpError(404, 'Contatto non trovato', 'NOT_FOUND');
    const label = req.body.label === undefined ? current.label : text(req.body.label, { name: 'Nome', required: true, max: 120 });
    const kind = req.body.kind === undefined ? current.kind : enumValue(req.body.kind, ['telefono', 'whatsapp', 'email', 'sito', 'altro'], { name: 'Tipo', required: true });
    const value = req.body.value === undefined ? current.value : text(req.body.value, { name: 'Contatto', required: true, max: 300 });
    const note = req.body.note === undefined ? current.note : text(req.body.note, { name: 'Nota', max: 500 });
    const sortOrder = req.body.sort_order === undefined ? current.sort_order : numberValue(req.body.sort_order, { name: 'Ordine', min: -1000, max: 1000, integer: true, required: true });
    const active = req.body.active === undefined ? current.active : booleanValue(req.body.active);
    const contact = (await q(
      `UPDATE contact_channels SET label=$2,kind=$3,value=$4,note=$5,sort_order=$6,active=$7,updated_at=NOW() WHERE id=$1 RETURNING *`,
      [contactId, label, kind, value, note, sortOrder, active]
    )).rows[0];
    res.json({ contact });
  }));

  app.get('/api/admin/plan-settings', auth(), role('admin'), asyncHandler(async (_req, res) => {
    res.json({ plans: await listPlans(pool, true) });
  }));

  app.patch('/api/admin/plan-settings/:id', auth(), role('admin'), asyncHandler(async (req, res) => {
    const planId = text(req.params.id, { name: 'Piano', required: true, max: 60 });
    const current = await getPlan(planId);
    const label = req.body.label === undefined ? current.label : text(req.body.label, { name: 'Nome piano', required: true, max: 120 });
    const priceCents = req.body.price_euro === undefined ? Number(current.price_cents) : cents(req.body.price_euro, { name: 'Prezzo', required: true });
    const fromPrice = req.body.from_price === undefined ? current.from_price : booleanValue(req.body.from_price);
    const priceLabel = req.body.price_label === undefined
      ? current.price_label
      : text(req.body.price_label, { name: 'Etichetta prezzo', required: true, max: 120 });
    const features = req.body.features === undefined && req.body.features_text === undefined
      ? current.features_json
      : listOfStrings(req.body.features ?? req.body.features_text, { name: 'Servizi', maxItems: 40, maxLength: 300 });
    const days = req.body.days === undefined ? Number(current.days) : numberValue(req.body.days, { name: 'Giorni', min: 1, max: 365, integer: true, required: true });
    const active = req.body.active === undefined ? current.active : booleanValue(req.body.active);
    const sortOrder = req.body.sort_order === undefined ? Number(current.sort_order) : numberValue(req.body.sort_order, { name: 'Ordine', min: -1000, max: 1000, integer: true, required: true });
    const plan = (await q(
      `UPDATE plan_settings
          SET label=$2,price_cents=$3,price_label=$4,features_json=$5::jsonb,days=$6,from_price=$7,active=$8,sort_order=$9,updated_at=NOW()
        WHERE id=$1 RETURNING *`,
      [planId, label, priceCents, priceLabel || `${fromPrice ? 'da ' : ''}${(priceCents / 100).toFixed(0)} €/mese`, JSON.stringify(features), days, fromPrice, active, sortOrder]
    )).rows[0];
    res.json({ plan });
  }));

  app.get('/api/admin/customer-custom-plans', auth(), role('admin'), asyncHandler(async (req, res) => {
    const params = [];
    let where = '';
    if (req.query.customer_id) {
      params.push(uuid(req.query.customer_id, 'Cliente'));
      where = 'WHERE ccp.customer_id=$1';
    }
    const plans = (await q(
      `SELECT ccp.*,c.name customer_name,c.email customer_email,p.name property_name,p.address property_address
         FROM customer_custom_plans ccp
         JOIN customers c ON c.id=ccp.customer_id
         LEFT JOIN properties p ON p.id=ccp.property_id
         ${where}
        ORDER BY ccp.created_at DESC`,
      params
    )).rows;
    res.json({ plans });
  }));

  app.post('/api/admin/customer-custom-plans', auth(), role('admin'), asyncHandler(async (req, res) => {
    const customerId = uuid(req.body.customer_id, 'Cliente');
    const propertyId = req.body.property_id ? uuid(req.body.property_id, 'Immobile') : null;
    const title = text(req.body.title || 'Piano personalizzato Home Care', { name: 'Nome piano', required: true, max: 180 });
    const notes = text(req.body.notes, { name: 'Note', max: 4000 });
    const rawServices = Array.isArray(req.body.services) ? req.body.services : [];
    if (rawServices.length > 40) throw new HttpError(400, 'Troppi servizi', 'VALIDATION_ERROR');
    const services = rawServices.map((item) => ({
      id: text(item.id || crypto.randomUUID(), { name: 'Servizio', required: true, max: 80 }),
      label: text(item.label, { name: 'Servizio', required: true, max: 180 }),
      price_cents: item.price_cents !== undefined
        ? numberValue(item.price_cents, { name: 'Prezzo servizio', min: 0, max: 100_000_000, integer: true, required: true })
        : (cents(item.price_euro, { name: 'Prezzo servizio', allowZero: true }) || 0),
    }));
    const basePrice = cents(req.body.base_price_euro, { name: 'Prezzo base', allowZero: true }) || 0;
    const servicesTotal = services.reduce((sum, item) => sum + item.price_cents, 0);
    const subtotal = basePrice + servicesTotal;
    const discountType = enumValue(req.body.discount_type || 'none', ['none', 'amount', 'percent'], { name: 'Tipo sconto', required: true });
    const discountRaw = numberValue(req.body.discount_value || 0, { name: 'Sconto', min: 0, max: discountType === 'percent' ? 100 : 1_000_000, required: true });
    const discountValueCents = discountType === 'amount' ? Math.round(discountRaw * 100) : 0;
    const discountPercent = discountType === 'percent' ? discountRaw : 0;
    const computedDiscount = Math.min(subtotal, discountType === 'percent' ? Math.round(subtotal * discountPercent / 100) : discountValueCents);
    const finalPrice = cents(req.body.final_price_euro, { name: 'Prezzo finale' }) || Math.max(0, subtotal - computedDiscount);
    if (!finalPrice) throw new HttpError(400, 'Prezzo finale non valido', 'PRICE_INVALID');
    const activate = booleanValue(req.body.activate, false);

    const plan = await transaction(async (client) => {
      const customer = (await q('SELECT id FROM customers WHERE id=$1 FOR UPDATE', [customerId], client)).rows[0];
      if (!customer) throw new HttpError(404, 'Cliente non trovato', 'NOT_FOUND');
      if (propertyId) {
        const property = (await q('SELECT id FROM properties WHERE id=$1 AND customer_id=$2', [propertyId, customerId], client)).rows[0];
        if (!property) throw new HttpError(400, 'Immobile non appartenente al cliente', 'PROPERTY_INVALID');
      }
      const inserted = (await q(
        `INSERT INTO customer_custom_plans(customer_id,property_id,title,services_json,base_price_cents,services_total_cents,subtotal_cents,
           discount_type,discount_value_cents,discount_percent,final_price_cents,notes,status)
         VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,'draft') RETURNING *`,
        [customerId, propertyId, title, JSON.stringify(services), basePrice, servicesTotal, subtotal, discountType, discountValueCents, discountPercent, finalPrice, notes],
        client
      )).rows[0];
      return activate ? activateCustomPlan(client, inserted) : inserted;
    });
    res.status(201).json({ plan });
  }));

  app.post('/api/admin/customer-custom-plans/:id/activate', auth(), role('admin'), asyncHandler(async (req, res) => {
    const planId = uuid(req.params.id, 'Piano');
    const plan = await transaction(async (client) => {
      const current = (await q('SELECT * FROM customer_custom_plans WHERE id=$1 FOR UPDATE', [planId], client)).rows[0];
      if (!current) throw new HttpError(404, 'Piano personalizzato non trovato', 'NOT_FOUND');
      if (current.status === 'archived') throw new HttpError(409, 'Un piano archiviato non può essere attivato', 'PLAN_ARCHIVED');
      return activateCustomPlan(client, current);
    });
    res.json({ plan });
  }));

  app.post('/api/admin/customer-custom-plans/:id/archive', auth(), role('admin'), asyncHandler(async (req, res) => {
    const planId = uuid(req.params.id, 'Piano');
    const plan = await transaction(async (client) => {
      const current = (await q('SELECT * FROM customer_custom_plans WHERE id=$1 FOR UPDATE', [planId], client)).rows[0];
      if (!current) throw new HttpError(404, 'Piano personalizzato non trovato', 'NOT_FOUND');
      const archived = (await q(
        `UPDATE customer_custom_plans SET status='archived',archived_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *`,
        [planId],
        client
      )).rows[0];
      await q(
        `UPDATE customers
            SET current_custom_plan_id=NULL,custom_monthly_price_cents=NULL,custom_plan_summary=NULL,
                payment_status='unpaid',paid_until=NULL,updated_at=NOW()
          WHERE id=$1 AND current_custom_plan_id=$2`,
        [current.customer_id, current.id],
        client
      );
      return archived;
    });
    res.json({ plan });
  }));

  app.post('/api/client/properties', auth(), role('client'), asyncHandler(async (req, res) => {
    const name = text(req.body.name, { name: 'Nome immobile', required: true, max: 160 });
    const address = text(req.body.address, { name: 'Indirizzo', required: true, max: 300 });
    const city = text(req.body.city || 'Badesi', { name: 'Comune', required: true, max: 120 });
    const zone = text(req.body.zone, { name: 'Zona', max: 120 });
    const propertyType = text(req.body.property_type, { name: 'Tipo immobile', max: 120 });
    const notes = text(req.body.notes, { name: 'Note', max: 4000 });
    const plan = await getPlan(req.body.package_type || 'base', pool, true);
    const property = await transaction(async (client) => {
      const row = (await q(
        `INSERT INTO properties(customer_id,name,address,city,zone,package_type,monthly_price_cents,next_check_date,active,notes,
           request_status,property_type,client_notes,requested_package_type,requested_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,CURRENT_DATE,FALSE,$8,'pending',$9,$8,$6,NOW()) RETURNING *`,
        [req.user.customer_id, name, address, city, zone, plan.id, Number(plan.price_cents), notes, propertyType],
        client
      )).rows[0];
      await q(
        `INSERT INTO messages(customer_id,sender_role,sender_name,body,read_by_client,read_by_admin)
         VALUES($1,'client',$2,$3,TRUE,FALSE)`,
        [req.user.customer_id, req.user.name || 'Cliente', `Ho inserito una richiesta per ${name}, ${address}. Piano richiesto: ${plan.label}.`],
        client
      );
      return row;
    });
    res.status(201).json({ property });
  }));

  app.get('/api/client/dashboard', auth(), role('client'), asyncHandler(async (req, res) => {
    const customerId = req.user.customer_id;
    const [customerResult, propertiesResult, reports, paymentsResult, customPlanResult, plans] = await Promise.all([
      q(`SELECT *,CASE WHEN ${paidSql('customers')} THEN TRUE ELSE FALSE END payment_valid FROM customers WHERE id=$1`, [customerId]),
      q(`SELECT * FROM properties WHERE customer_id=$1 ORDER BY created_at DESC`, [customerId]),
      reportRows('AND p.customer_id=$1', [customerId], pool, 80),
      q(`SELECT * FROM extra_payments WHERE customer_id=$1 ORDER BY created_at DESC`, [customerId]),
      q(`SELECT * FROM customer_custom_plans WHERE customer_id=$1 AND status='active' ORDER BY activated_at DESC LIMIT 1`, [customerId]),
      listPlans(),
    ]);
    const customer = customerResult.rows[0];
    if (!customer) throw new HttpError(404, 'Profilo cliente non trovato', 'NOT_FOUND');
    res.json({
      customer,
      properties: propertiesResult.rows,
      reports,
      payments: paymentsResult.rows,
      customPlan: customPlanResult.rows[0] || null,
      plans,
    });
  }));

  app.get('/api/client/messages', auth(), role('client'), asyncHandler(async (req, res) => {
    await q(`UPDATE messages SET read_by_client=TRUE WHERE customer_id=$1 AND sender_role='admin'`, [req.user.customer_id]);
    const messages = (await q(
      `SELECT * FROM messages WHERE customer_id=$1 ORDER BY created_at ASC LIMIT 300`,
      [req.user.customer_id]
    )).rows;
    res.json({ messages });
  }));

  app.post('/api/client/messages', auth(), role('client'), messageLimiter, asyncHandler(async (req, res) => {
    const body = text(req.body.body, { name: 'Messaggio', required: true, max: 3000 });
    const message = (await q(
      `INSERT INTO messages(customer_id,sender_role,sender_name,body,read_by_client,read_by_admin)
       VALUES($1,'client',$2,$3,TRUE,FALSE) RETURNING *`,
      [req.user.customer_id, req.user.name || 'Cliente', body]
    )).rows[0];
    res.status(201).json({ message });
  }));

  app.get('/api/admin/messages', auth(), role('admin'), asyncHandler(async (_req, res) => {
    const messages = (await q(
      `SELECT m.*,c.name customer_name,c.email customer_email,c.phone customer_phone
         FROM messages m JOIN customers c ON c.id=m.customer_id
        ORDER BY m.created_at DESC LIMIT 500`
    )).rows;
    res.json({ messages });
  }));

  app.post('/api/admin/messages', auth(), role('admin'), messageLimiter, asyncHandler(async (req, res) => {
    const customerId = uuid(req.body.customer_id, 'Cliente');
    const body = text(req.body.body, { name: 'Messaggio', required: true, max: 3000 });
    const message = (await q(
      `INSERT INTO messages(customer_id,sender_role,sender_name,body,read_by_client,read_by_admin)
       VALUES($1,'admin','Home Care',$2,FALSE,TRUE) RETURNING *`,
      [customerId, body]
    )).rows[0];
    res.status(201).json({ message });
  }));

  app.post('/api/client/plan-checkout', auth(), role('client'), asyncHandler(async (req, res) => {
    if (!stripeClient) throw new HttpError(503, 'Pagamenti online non ancora configurati', 'STRIPE_DISABLED');
    const billing = enumValue(req.body.billing || 'monthly', ['monthly', 'annual'], { name: 'Fatturazione', required: true });
    const requestedPackage = text(req.body.package_type, { name: 'Piano', max: 60 });
    const customer = (await q('SELECT * FROM customers WHERE id=$1', [req.user.customer_id])).rows[0];
    if (!customer) throw new HttpError(404, 'Cliente non trovato', 'NOT_FOUND');
    const packageType = requestedPackage || customer.current_package_type;
    if (!packageType) throw new HttpError(400, 'Scegli un piano', 'PLAN_REQUIRED');
    const plan = await getPlan(packageType, pool, packageType !== customer.current_package_type);
    const property = (await q(
      `SELECT * FROM properties
        WHERE customer_id=$1 AND active=TRUE AND request_status='approved' AND package_type=$2
        ORDER BY approved_at DESC NULLS LAST,created_at DESC LIMIT 1`,
      [customer.id, packageType]
    )).rows[0];
    if (!property) throw new HttpError(409, 'Il piano può essere pagato dopo l’approvazione di un immobile', 'PROPERTY_APPROVAL_REQUIRED');

    let monthlyCents;
    let description;
    if (packageType === 'personalizzato') {
      const customPlan = (await q(
        `SELECT * FROM customer_custom_plans WHERE customer_id=$1 AND status='active' ORDER BY activated_at DESC LIMIT 1`,
        [customer.id]
      )).rows[0];
      if (!customPlan || !customPlan.final_price_cents) {
        throw new HttpError(409, 'Il prezzo del piano personalizzato deve essere confermato da Home Care', 'CUSTOM_PLAN_REQUIRED');
      }
      monthlyCents = Number(customPlan.final_price_cents);
      description = customPlanSummary(customPlan).slice(0, 450);
    } else {
      monthlyCents = Number(property.monthly_price_cents || plan.price_cents);
      description = `Servizio Home Care ${plan.label} per ${property.name}`.slice(0, 450);
    }
    if (!Number.isInteger(monthlyCents) || monthlyCents <= 0) throw new HttpError(400, 'Importo piano non valido', 'PRICE_INVALID');

    let stripeCustomerId = customer.stripe_customer_id;
    if (!stripeCustomerId) {
      const stripeCustomer = await stripeClient.customers.create({
        name: customer.name,
        email: customer.email || undefined,
        phone: customer.phone || undefined,
        metadata: { customerId: customer.id },
      });
      stripeCustomerId = stripeCustomer.id;
      await q(`UPDATE customers SET stripe_customer_id=$2,updated_at=NOW() WHERE id=$1`, [customer.id, stripeCustomerId]);
    }

    const annual = billing === 'annual';
    const amount = annual ? monthlyCents * 12 : monthlyCents;
    const metadata = {
      kind: annual ? 'plan_annual' : 'plan_subscription',
      customerId: customer.id,
      packageType,
      propertyId: property.id,
      expectedAmountCents: String(amount),
      monthlyCents: String(monthlyCents),
    };
    const base = appBaseUrl(config, req);
    const sessionPayload = {
      customer: stripeCustomerId,
      client_reference_id: customer.id,
      mode: annual ? 'payment' : 'subscription',
      locale: 'it',
      line_items: [{
        quantity: 1,
        price_data: annual
          ? { currency: 'eur', unit_amount: amount, product_data: { name: `Home Care annuale - ${plan.label}`, description } }
          : { currency: 'eur', unit_amount: monthlyCents, recurring: { interval: 'month' }, product_data: { name: `Home Care - ${plan.label}`, description } },
      }],
      success_url: `${base}/?payment=success`,
      cancel_url: `${base}/?payment=cancel`,
      metadata,
    };
    if (!annual) sessionPayload.subscription_data = { metadata };
    const session = await stripeClient.checkout.sessions.create(sessionPayload);
    res.json({ url: session.url, billing, amount_cents: amount, package_type: packageType });
  }));

  app.post('/api/client/extra-payments/:id/pay', auth(), role('client'), asyncHandler(async (req, res) => {
    if (!stripeClient) throw new HttpError(503, 'Pagamenti online non ancora configurati', 'STRIPE_DISABLED');
    const paymentId = uuid(req.params.id, 'Preventivo');
    let payment = (await q(
      `SELECT e.*,c.name customer_name,c.email customer_email,c.phone customer_phone,c.stripe_customer_id
         FROM extra_payments e JOIN customers c ON c.id=e.customer_id
        WHERE e.id=$1 AND e.customer_id=$2`,
      [paymentId, req.user.customer_id]
    )).rows[0];
    if (!payment) throw new HttpError(404, 'Preventivo non trovato', 'NOT_FOUND');
    if (payment.status !== 'pending') throw new HttpError(409, 'Il preventivo non è più da pagare', 'PAYMENT_NOT_PENDING');

    if (payment.stripe_session_id && payment.payment_url && stripeClient.checkout.sessions.retrieve) {
      try {
        const oldSession = await stripeClient.checkout.sessions.retrieve(payment.stripe_session_id);
        if (oldSession.status === 'open') return res.json({ url: payment.payment_url, payment });
      } catch (_) { /* crea una nuova sessione */ }
    }

    let stripeCustomerId = payment.stripe_customer_id;
    if (!stripeCustomerId) {
      const stripeCustomer = await stripeClient.customers.create({
        name: payment.customer_name,
        email: payment.customer_email || undefined,
        phone: payment.customer_phone || undefined,
        metadata: { customerId: payment.customer_id },
      });
      stripeCustomerId = stripeCustomer.id;
      await q(`UPDATE customers SET stripe_customer_id=$2,updated_at=NOW() WHERE id=$1`, [payment.customer_id, stripeCustomerId]);
    }
    const base = appBaseUrl(config, req);
    const session = await stripeClient.checkout.sessions.create({
      customer: stripeCustomerId,
      client_reference_id: payment.customer_id,
      mode: 'payment',
      locale: 'it',
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: Number(payment.amount_cents),
          product_data: { name: 'Home Care - preventivo o servizio extra', description: payment.description.slice(0, 450) },
        },
      }],
      success_url: `${base}/?extra=success`,
      cancel_url: `${base}/?extra=cancel`,
      metadata: {
        kind: 'extra_payment',
        extraPaymentId: payment.id,
        customerId: payment.customer_id,
        expectedAmountCents: String(payment.amount_cents),
      },
    });
    payment = (await q(
      `UPDATE extra_payments SET stripe_session_id=$2,payment_url=$3,updated_at=NOW() WHERE id=$1 RETURNING *`,
      [payment.id, session.id, session.url]
    )).rows[0];
    res.json({ url: session.url, payment });
  }));

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint non trovato', code: 'NOT_FOUND' }));
  app.get('*', (_req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  app.use((error, _req, res, _next) => {
    if (res.headersSent) return;
    let status = Number(error.status || 500);
    let message = error.message || 'Errore interno del server';
    let code = error.code || 'INTERNAL_ERROR';
    if (error instanceof multer.MulterError) {
      status = 400;
      code = 'INVALID_UPLOAD';
      message = error.code === 'LIMIT_FILE_SIZE' ? 'Una foto supera il limite di 8 MB' : 'Caricamento foto non valido';
    }
    if (error.code === '23505') {
      status = 409;
      code = 'DUPLICATE_VALUE';
      message = 'Esiste già un elemento con questi dati';
    }
    if (status >= 500) {
      const errorId = crypto.randomUUID();
      console.error(`[${errorId}]`, error);
      message = 'Errore interno del server';
      code = 'INTERNAL_ERROR';
      return res.status(500).json({ error: message, code, errorId });
    }
    res.status(status).json({ error: message, code });
  });

  return app;
}

async function start() {
  const config = loadConfig();
  const pool = createPool(config);
  await pool.query('SELECT 1');
  const app = createApp({ config, pool });
  const server = app.listen(config.port, () => {
    console.log(`Home Care PWA ${APP_VERSION} avviata sulla porta ${config.port}`);
  });
  const shutdown = async (signal) => {
    console.log(`${signal}: arresto in corso...`);
    server.close(async () => {
      await pool.end().catch(() => null);
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
  return { app, server, pool, config };
}

module.exports = {
  APP_VERSION,
  HttpError,
  createApp,
  createPool,
  loadConfig,
  start,
  tokenHash,
  imageType,
};

if (require.main === module) {
  start().catch((error) => {
    console.error('Avvio non riuscito:', error);
    process.exit(1);
  });
}
