'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const write = (file, content) => fs.writeFileSync(path.join(root, file), content);

function replaceOnce(file, search, replacement, marker = replacement) {
  const current = read(file);
  if (current.includes(marker)) return false;
  assert.ok(current.includes(search), `${file}: frammento da sostituire non trovato`);
  write(file, current.replace(search, replacement));
  return true;
}

function appendOnce(file, marker, addition) {
  const current = read(file);
  if (current.includes(marker)) return false;
  write(file, `${current.trimEnd()}\n\n${addition.trim()}\n`);
  return true;
}

const schemaAddition = String.raw`
-- OPERATIONS_V2_START
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_notifications BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS property_occupancies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  note TEXT,
  source_role TEXT NOT NULL DEFAULT 'client' CHECK (source_role IN ('client','admin')),
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_property_occupancies_property_dates
  ON property_occupancies(property_id,start_date,end_date);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link_tab TEXT,
  read_at TIMESTAMPTZ,
  email_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (email_status IN ('pending','sending','sent','skipped','failed')),
  email_attempts INTEGER NOT NULL DEFAULT 0 CHECK (email_attempts BETWEEN 0 AND 20),
  email_sent_at TIMESTAMPTZ,
  email_error TEXT,
  dedupe_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_user_dedupe
  ON notifications(user_id,dedupe_key);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications(user_id,created_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_email_queue
  ON notifications(email_status,created_at) WHERE email_status IN ('pending','sending');

CREATE OR REPLACE FUNCTION home_care_next_available_date(p_property_id UUID,p_candidate DATE)
RETURNS DATE
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  candidate DATE := GREATEST(COALESCE(p_candidate,CURRENT_DATE),CURRENT_DATE);
  occupied_until DATE;
BEGIN
  LOOP
    SELECT MAX(end_date)
      INTO occupied_until
      FROM property_occupancies
     WHERE property_id=p_property_id
       AND candidate BETWEEN start_date AND end_date;
    EXIT WHEN occupied_until IS NULL;
    candidate := occupied_until + 1;
  END LOOP;
  RETURN candidate;
END;
$$;

CREATE OR REPLACE FUNCTION home_care_notify_message_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.sender_role='admin' THEN
    INSERT INTO notifications(user_id,kind,title,body,link_tab,dedupe_key)
    SELECT u.id,'message','Nuovo messaggio da Home Care',LEFT(NEW.body,1000),'chat','message:'||NEW.id::text
      FROM users u
     WHERE u.customer_id=NEW.customer_id AND u.role='client'
    ON CONFLICT (user_id,dedupe_key) DO NOTHING;
  ELSE
    INSERT INTO notifications(user_id,kind,title,body,link_tab,dedupe_key)
    SELECT u.id,'message','Nuovo messaggio da '||NEW.sender_name,LEFT(NEW.body,1000),'messages','message:'||NEW.id::text
      FROM users u
     WHERE u.role='admin'
    ON CONFLICT (user_id,dedupe_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_home_care_notify_message ON messages;
CREATE TRIGGER trg_home_care_notify_message
AFTER INSERT ON messages
FOR EACH ROW EXECUTE FUNCTION home_care_notify_message_insert();

CREATE OR REPLACE FUNCTION home_care_notify_check_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status='done' THEN
    INSERT INTO notifications(user_id,kind,title,body,link_tab,dedupe_key)
    SELECT u.id,'report','Nuovo report disponibile','Il report del controllo di '||p.name||' è pronto.','reports','check-done:'||NEW.id::text
      FROM properties p
      JOIN users u ON u.customer_id=p.customer_id AND u.role='client'
     WHERE p.id=NEW.property_id
    ON CONFLICT (user_id,dedupe_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_home_care_notify_check ON checks;
CREATE TRIGGER trg_home_care_notify_check
AFTER INSERT ON checks
FOR EACH ROW EXECUTE FUNCTION home_care_notify_check_insert();

CREATE OR REPLACE FUNCTION home_care_notify_customer_payment_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  notification_title TEXT;
  notification_body TEXT;
  notification_key TEXT;
BEGIN
  IF NEW.payment_status IS NOT DISTINCT FROM OLD.payment_status
     AND NEW.paid_until IS NOT DISTINCT FROM OLD.paid_until THEN
    RETURN NEW;
  END IF;

  IF NEW.payment_status='paid' THEN
    notification_title := 'Pagamento registrato';
    notification_body := CASE WHEN NEW.paid_until IS NULL
      THEN 'Il servizio Home Care risulta attivo.'
      ELSE 'Il servizio Home Care risulta pagato fino al '||TO_CHAR(NEW.paid_until,'DD/MM/YYYY')||'.' END;
  ELSE
    notification_title := 'Pagamento da regolarizzare';
    notification_body := 'Lo stato del servizio è '||NEW.payment_status||'. Apri Pagamenti per verificare.';
  END IF;
  notification_key := 'customer-payment:'||NEW.id::text||':'||NEW.payment_status||':'||COALESCE(NEW.paid_until::text,'none')||':'||txid_current()::text;

  INSERT INTO notifications(user_id,kind,title,body,link_tab,dedupe_key)
  SELECT u.id,'payment',notification_title,notification_body,'payments',notification_key
    FROM users u
   WHERE u.customer_id=NEW.id AND u.role='client'
  ON CONFLICT (user_id,dedupe_key) DO NOTHING;

  IF NEW.payment_status='paid' THEN
    INSERT INTO notifications(user_id,kind,title,body,link_tab,dedupe_key)
    SELECT u.id,'payment','Pagamento cliente registrato',NEW.name||': '||notification_body,'payments',notification_key
      FROM users u WHERE u.role='admin'
    ON CONFLICT (user_id,dedupe_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_home_care_notify_customer_payment ON customers;
CREATE TRIGGER trg_home_care_notify_customer_payment
AFTER UPDATE OF payment_status,paid_until ON customers
FOR EACH ROW EXECUTE FUNCTION home_care_notify_customer_payment_update();

CREATE OR REPLACE FUNCTION home_care_notify_extra_payment_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  customer_name TEXT;
  key_value TEXT;
BEGIN
  SELECT name INTO customer_name FROM customers WHERE id=NEW.customer_id;
  IF TG_OP='INSERT' THEN
    key_value := 'extra-payment-created:'||NEW.id::text;
    INSERT INTO notifications(user_id,kind,title,body,link_tab,dedupe_key)
    SELECT u.id,'payment','Nuovo preventivo disponibile',NEW.description||' · €'||TO_CHAR(NEW.amount_cents/100.0,'FM999999990.00'),'payments',key_value
      FROM users u WHERE u.customer_id=NEW.customer_id AND u.role='client'
    ON CONFLICT (user_id,dedupe_key) DO NOTHING;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    key_value := 'extra-payment-status:'||NEW.id::text||':'||NEW.status;
    INSERT INTO notifications(user_id,kind,title,body,link_tab,dedupe_key)
    SELECT u.id,'payment',CASE WHEN NEW.status='paid' THEN 'Pagamento ricevuto' ELSE 'Preventivo aggiornato' END,
           NEW.description||' · Stato: '||NEW.status,'payments',key_value
      FROM users u WHERE u.customer_id=NEW.customer_id AND u.role='client'
    ON CONFLICT (user_id,dedupe_key) DO NOTHING;
    IF NEW.status='paid' THEN
      INSERT INTO notifications(user_id,kind,title,body,link_tab,dedupe_key)
      SELECT u.id,'payment','Preventivo pagato',COALESCE(customer_name,'Cliente')||': '||NEW.description,'payments',key_value
        FROM users u WHERE u.role='admin'
      ON CONFLICT (user_id,dedupe_key) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_home_care_notify_extra_payment_insert ON extra_payments;
CREATE TRIGGER trg_home_care_notify_extra_payment_insert
AFTER INSERT ON extra_payments
FOR EACH ROW EXECUTE FUNCTION home_care_notify_extra_payment_change();
DROP TRIGGER IF EXISTS trg_home_care_notify_extra_payment_update ON extra_payments;
CREATE TRIGGER trg_home_care_notify_extra_payment_update
AFTER UPDATE OF status ON extra_payments
FOR EACH ROW EXECUTE FUNCTION home_care_notify_extra_payment_change();
-- OPERATIONS_V2_END
`;

appendOnce('schema.sql', '-- OPERATIONS_V2_START', schemaAddition);

replaceOnce(
  'server3.js',
  "const { Pool } = require('pg');\n",
  "const { Pool } = require('pg');\nconst { installOperationalFeatures } = require('./src/operations-v2');\n",
  "require('./src/operations-v2')"
);

replaceOnce(
  'server3.js',
  "        WHERE p.active=TRUE AND p.request_status='approved' AND p.next_check_date<=CURRENT_DATE\n",
  "        WHERE p.active=TRUE AND p.request_status='approved' AND p.next_check_date<=CURRENT_DATE\n          AND NOT EXISTS (SELECT 1 FROM property_occupancies o WHERE o.property_id=p.id AND CURRENT_DATE BETWEEN o.start_date AND o.end_date)\n",
  'property_occupancies o WHERE o.property_id=p.id AND CURRENT_DATE BETWEEN o.start_date AND o.end_date'
);

replaceOnce(
  'server3.js',
  "      if (!property.payment_valid) throw new HttpError(402, 'Pagamento non regolare: controllo sospeso', 'PAYMENT_REQUIRED');\n      const row = (await q(\n",
  "      if (!property.payment_valid) throw new HttpError(402, 'Pagamento non regolare: controllo sospeso', 'PAYMENT_REQUIRED');\n      const occupied = (await q(\n        `SELECT id,start_date,end_date FROM property_occupancies\n          WHERE property_id=$1 AND CURRENT_DATE BETWEEN start_date AND end_date LIMIT 1`,\n        [propertyId],\n        client\n      )).rows[0];\n      if (occupied) throw new HttpError(409, `La casa risulta occupata fino al ${occupied.end_date}. Il controllo non è necessario.`, 'PROPERTY_OCCUPIED');\n      const row = (await q(\n",
  "'PROPERTY_OCCUPIED'"
);

replaceOnce(
  'server3.js',
  '        `UPDATE properties SET next_check_date=CURRENT_DATE+$2::int,updated_at=NOW() WHERE id=$1`,\n',
  '        `UPDATE properties SET next_check_date=home_care_next_available_date($1,CURRENT_DATE+$2::int),updated_at=NOW() WHERE id=$1`,\n',
  'next_check_date=home_care_next_available_date($1,CURRENT_DATE+$2::int)'
);

replaceOnce(
  'server3.js',
  "    const conditions = [`p.active=TRUE`, `p.request_status='approved'`, `p.latitude IS NOT NULL`, `p.longitude IS NOT NULL`, paidSql('c')];\n",
  "    const conditions = [`p.active=TRUE`, `p.request_status='approved'`, `p.latitude IS NOT NULL`, `p.longitude IS NOT NULL`, paidSql('c'), `NOT EXISTS (SELECT 1 FROM property_occupancies o WHERE o.property_id=p.id AND CURRENT_DATE BETWEEN o.start_date AND o.end_date)`];\n",
  'property_occupancies o WHERE o.property_id=p.id AND CURRENT_DATE BETWEEN o.start_date AND o.end_date)`];'
);

replaceOnce(
  'server3.js',
  "  app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint non trovato', code: 'NOT_FOUND' }));\n",
  "  installOperationalFeatures({\n    app, q, transaction, auth, role, asyncHandler, upload, uuid, text, isoDate, listOfStrings,\n    HttpError, config, mailer, imageType, safeOriginalName,\n  });\n\n  app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint non trovato', code: 'NOT_FOUND' }));\n",
  'installOperationalFeatures({'
);

replaceOnce(
  'server3.js',
  "  const shutdown = async (signal) => {\n    console.log(`${signal}: arresto in corso...`);\n    server.close(async () => {\n",
  "  const shutdown = async (signal) => {\n    console.log(`${signal}: arresto in corso...`);\n    app.locals.operationsV2?.stop?.();\n    server.close(async () => {\n",
  'app.locals.operationsV2?.stop?.()'
);

replaceOnce(
  'src/operations-v2.js',
  '        WHERE p.id=$1`,\n',
  '        WHERE p.id=$1 FOR UPDATE OF p`,\n',
  'WHERE p.id=$1 FOR UPDATE OF p'
);

replaceOnce(
  'src/operations-v2.js',
  `  async function adjustNextCheck(client, propertyId) {
    await q(
      \`UPDATE properties
          SET next_check_date=home_care_next_available_date(id,GREATEST(next_check_date,CURRENT_DATE)),updated_at=NOW()
        WHERE id=$1\`,
      [propertyId],
      client
    );
  }
`,
  `  async function recalculateNextCheck(client, propertyId) {
    const scheduling = (await q(
      \`SELECT ps.days,MAX(ch.completed_at::date) last_completed
         FROM properties p JOIN plan_settings ps ON ps.id=p.package_type
         LEFT JOIN checks ch ON ch.property_id=p.id AND ch.status='done'
        WHERE p.id=$1 GROUP BY ps.days\`,
      [propertyId],
      client
    )).rows[0];
    if (!scheduling) return;
    const candidate = scheduling.last_completed
      ? new Date(Date.parse(\`${'${scheduling.last_completed}'}T00:00:00Z\`) + Number(scheduling.days || 30) * 86_400_000).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    await q(
      \`UPDATE properties SET next_check_date=home_care_next_available_date(id,$2::date),updated_at=NOW() WHERE id=$1\`,
      [propertyId, candidate],
      client
    );
  }
`,
  'async function recalculateNextCheck'
);

for (const search of [
  'await adjustNextCheck(client, propertyId);',
  'await adjustNextCheck(client, current.property_id);',
]) {
  const content = read('src/operations-v2.js');
  if (content.includes(search)) write('src/operations-v2.js', content.replaceAll(search, search.replace('adjustNextCheck', 'recalculateNextCheck')));
}

replaceOnce(
  'src/operations-v2.js',
  "      await q('DELETE FROM property_occupancies WHERE id=$1', [occupancyId], client);\n      const description =",
  "      await q('DELETE FROM property_occupancies WHERE id=$1', [occupancyId], client);\n      await recalculateNextCheck(client, current.property_id);\n      const description =",
  "await recalculateNextCheck(client, current.property_id);\n      const description"
);

replaceOnce(
  'src/operations-v2.js',
  "      await notifyCustomer(client, current.customer_id, 'report', 'Report aggiornato', `Il report di ${current.property_name} è stato aggiornato da Home Care.`, 'reports', `report-updated:${reportId}:${updated.updated_at}`);\n",
  "      await recalculateNextCheck(client, current.property_id);\n      await notifyCustomer(client, current.customer_id, 'report', 'Report aggiornato', `Il report di ${current.property_name} è stato aggiornato da Home Care.`, 'reports', `report-updated:${reportId}:${updated.updated_at}`);\n",
  "recalculateNextCheck(client, current.property_id);\n      await notifyCustomer"
);

replaceOnce(
  'src/operations-v2.js',
  "          WHERE n.email_status='pending' AND n.email_attempts<3\n",
  "          WHERE (n.email_status='pending' OR (n.email_status='sending' AND n.created_at<NOW()-INTERVAL '10 minutes'))\n            AND n.email_attempts<3\n",
  "n.email_status='sending' AND n.created_at<NOW()-INTERVAL '10 minutes'"
);

replaceOnce(
  'src/operations-v2.js',
  "          [notification.id, result?.sent ? 'sent' : 'pending', result?.sent ? null : String(result?.reason || 'Invio non completato')]\n",
  "          [notification.id, result?.sent ? 'sent' : (notification.email_attempts >= 3 ? 'failed' : 'pending'), result?.sent ? null : String(result?.reason || 'Invio non completato').slice(0, 1000)]\n",
  "notification.email_attempts >= 3 ? 'failed'"
);

replaceOnce(
  'public/operations-v2.js',
  "  function dateIT(value) {\n",
  "  function cssEscape(value) {\n    const text = String(value || '');\n    return window.CSS?.escape ? window.CSS.escape(text) : text.replace(/[\\\"']/g, '\\\\$&');\n  }\n\n  function dateIT(value) {\n",
  'function cssEscape(value)'
);

{
  const file = 'public/operations-v2.js';
  const current = read(file);
  const updated = current.replaceAll('CSS.escape(tab)', 'cssEscape(tab)');
  if (updated !== current) write(file, updated);
}

replaceOnce(
  'public/operations-v2.js',
  "        const data = formDataObject(form);\n        data.checklist_json =",
  "        const data = formDataObject(form);\n        if (data.completed_at) {\n          const completed = new Date(data.completed_at);\n          if (Number.isNaN(completed.getTime())) throw new Error('Data e ora del report non valide.');\n          data.completed_at = completed.toISOString();\n        }\n        data.checklist_json =",
  "data.completed_at = completed.toISOString()"
);

replaceOnce(
  'public/operations-v2.css',
  '.hc-photo-wrap { position: relative; }\n',
  '.hc-photo-wrap { position: relative; aspect-ratio: 4 / 3; overflow: hidden; border-radius: 13px; }\n.hc-photo-wrap .photo-link { width: 100%; height: 100%; display: block; }\n',
  '.hc-photo-wrap .photo-link'
);

{
  const file = 'public/index.html';
  let content = read(file);
  if (!content.includes('/operations-v2.css')) {
    content = content.replace('<link rel="stylesheet" href="/app.css?v=40">', '<link rel="stylesheet" href="/app.css?v=41">\n  <link rel="stylesheet" href="/operations-v2.css?v=41">');
  }
  content = content.replaceAll('?v=40', '?v=41');
  content = content.replace(
    '  <script src="/app.js?v=41" defer></script>\n  <script src="/install-app.js?v=41" defer></script>',
    '  <script src="/app.js?v=41" defer></script>\n  <script src="/operations-v2.js?v=41" defer></script>\n  <script src="/pwa-v2.js?v=41" defer></script>'
  );
  assert.ok(content.includes('/operations-v2.js?v=41'), 'index: operations-v2.js non collegato');
  assert.ok(content.includes('/pwa-v2.js?v=41'), 'index: pwa-v2.js non collegato');
  write(file, content);
}

{
  const file = 'public/sw.js';
  let content = read(file);
  content = content.replace("const SW_VERSION = 'home-care-v40';", "const SW_VERSION = 'home-care-v41';");
  content = content.replace("  '/install-app.js',", "  '/operations-v2.css',\n  '/operations-v2.js',\n  '/pwa-v2.js',");
  content = content.replaceAll('?v=40', '?v=41');
  assert.ok(content.includes("'/pwa-v2.js'"), 'service worker: pwa-v2.js non incluso');
  write(file, content);
}

{
  const file = 'package.json';
  const pkg = JSON.parse(read(file));
  pkg.version = '1.1.0';
  pkg.engines = { node: '22.23.1' };
  pkg.scripts.check = 'node --check server3.js && node --check src/operations-v2.js && node --check scripts/migrate.js && node --check scripts/seed.js && node --check scripts/start-stable.js && node --check scripts/validate-static.js && node --check scripts/apply-operations-v2.js && node --check public/app.js && node --check public/operations-v2.js && node --check public/pwa-v2.js && node --check public/sw.js && node --check tests/app.test.js && npm run validate:static';
  write(file, `${JSON.stringify(pkg, null, 2)}\n`);
}

{
  const file = 'scripts/validate-static.js';
  let content = read(file);
  content = content.replace("  'public/install-app.js', 'public/sw.js', 'public/manifest.json', 'public/offline.html',", "  'public/pwa-v2.js', 'public/operations-v2.js', 'public/operations-v2.css', 'public/sw.js', 'public/manifest.json', 'public/offline.html',");
  content = content.replace("const installer = read('public/install-app.js');", "const installer = read('public/pwa-v2.js');\nconst operations = read('public/operations-v2.js');\nconst operationsCss = read('public/operations-v2.css');\nconst schema = read('schema.sql');");
  content = content.replace('assert.match(index, /install-app\\.js/);', 'assert.match(index, /pwa-v2\\.js/);\nassert.match(index, /operations-v2\\.js/);\nassert.match(index, /operations-v2\\.css/);');
  content = content.replace("assert.equal(packageJson.engines.node, '>=20.11');", "assert.equal(packageJson.engines.node, '22.23.1');");
  if (!content.includes("assert.match(operationsCss, /\\.action-sheet\\.open/)")) {
    content = content.replace(
      'assert.match(worker, /cache:\\s*\'no-store\'/);',
      "assert.match(worker, /cache:\\s*'no-store'/);\nassert.match(operations, /data-hc-action/);\nassert.match(operationsCss, /\\.action-sheet\\.open/);\nassert.match(schema, /CREATE TABLE IF NOT EXISTS property_occupancies/);\nassert.match(schema, /CREATE TABLE IF NOT EXISTS notifications/);\nassert.match(schema, /home_care_next_available_date/);"
    );
  }
  content = content.replace("assert.equal(manifest.display, 'standalone');", "assert.equal(manifest.id, '/');\nassert.equal(manifest.display, 'standalone');\nassert.deepEqual(manifest.display_override, ['standalone']);");
  write(file, content);
}

replaceOnce(
  'tests/app.test.js',
  "const stripeSessions = [];\n",
  "const stripeSessions = [];\n\nfunction datePlus(days) {\n  const date = new Date();\n  date.setUTCDate(date.getUTCDate() + days);\n  return date.toISOString().slice(0, 10);\n}\n",
  'function datePlus(days)'
);

const testsAddition = String.raw`

test('occupazioni, notifiche e gestione completa di report e immobili funzionano', async () => {
  const payment = await admin.request(`/api/admin/customers/${ownerCustomerId}/manual-payment`, {
    method: 'POST',
    json: { amount_euro: '39.00', paid_until: '2099-12-31', method: 'bonifico', description: 'Test operazioni', package_type: 'base' },
  });
  assert.equal(payment.response.status, 200, JSON.stringify(payment.data));

  const propertyRequest = await owner.request('/api/client/properties', {
    method: 'POST',
    json: { name: 'Casa Operazioni V2', address: 'Via Operazioni 41', city: 'Badesi', package_type: 'base' },
  });
  assert.equal(propertyRequest.response.status, 201, JSON.stringify(propertyRequest.data));
  const propertyId = propertyRequest.data.property.id;
  const approval = await admin.request(`/api/admin/properties/${propertyId}/approve`, {
    method: 'POST',
    json: { package_type: 'base', monthly_price_euro: '39.00' },
  });
  assert.equal(approval.response.status, 200, JSON.stringify(approval.data));

  const occupancy = await owner.request('/api/client/occupancies', {
    method: 'POST',
    json: { property_id: propertyId, start_date: datePlus(0), end_date: datePlus(1), note: 'Casa occupata per test' },
  });
  assert.equal(occupancy.response.status, 201, JSON.stringify(occupancy.data));
  const occupancyId = occupancy.data.occupancy.id;

  const dueChecks = await admin.request('/api/admin/due-checks');
  assert.equal(dueChecks.response.status, 200);
  assert.equal(dueChecks.data.checks.some((item) => item.id === propertyId), false);

  const blockedForm = new FormData();
  blockedForm.append('property_id', propertyId);
  blockedForm.append('notes', 'Non deve essere eseguito');
  blockedForm.append('checklist_json', '[]');
  const blocked = await admin.request('/api/admin/checks/complete', { method: 'POST', body: blockedForm });
  assert.equal(blocked.response.status, 409, JSON.stringify(blocked.data));
  assert.equal(blocked.data.code, 'PROPERTY_OCCUPIED');

  const adminNotifications = await admin.request('/api/notifications');
  assert.equal(adminNotifications.response.status, 200);
  assert.ok(adminNotifications.data.notifications.some((item) => item.kind === 'occupancy'));

  const editedOccupancy = await owner.request(`/api/client/occupancies/${occupancyId}`, {
    method: 'PATCH',
    json: { start_date: datePlus(0), end_date: datePlus(2), note: 'Periodo aggiornato' },
  });
  assert.equal(editedOccupancy.response.status, 200, JSON.stringify(editedOccupancy.data));
  const deletedOccupancy = await owner.request(`/api/client/occupancies/${occupancyId}`, { method: 'DELETE', json: {} });
  assert.equal(deletedOccupancy.response.status, 200, JSON.stringify(deletedOccupancy.data));

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X7W6WQAAAABJRU5ErkJggg==', 'base64');
  const completeForm = new FormData();
  completeForm.append('property_id', propertyId);
  completeForm.append('notes', 'Report originale');
  completeForm.append('checklist_json', JSON.stringify(['Porta controllata']));
  completeForm.append('photos', new Blob([png], { type: 'image/png' }), 'report.png');
  const completed = await admin.request('/api/admin/checks/complete', { method: 'POST', body: completeForm });
  assert.equal(completed.response.status, 201, JSON.stringify(completed.data));
  const reportId = completed.data.check.id;

  const reportUpdate = await admin.request(`/api/admin/reports/${reportId}`, {
    method: 'PATCH',
    json: { notes: 'Report modificato', checklist_json: ['Porta controllata', 'Finestre controllate'], completed_at: new Date(Date.now() - 60_000).toISOString() },
  });
  assert.equal(reportUpdate.response.status, 200, JSON.stringify(reportUpdate.data));

  const addPhotos = new FormData();
  addPhotos.append('photos', new Blob([png], { type: 'image/png' }), 'aggiunta.png');
  const photoUpload = await admin.request(`/api/admin/reports/${reportId}/photos`, { method: 'POST', body: addPhotos });
  assert.equal(photoUpload.response.status, 201, JSON.stringify(photoUpload.data));

  const dashboard = await owner.request('/api/client/dashboard');
  const editedReport = dashboard.data.reports.find((item) => item.id === reportId);
  assert.equal(editedReport.notes, 'Report modificato');
  assert.deepEqual(editedReport.checklist_json, ['Porta controllata', 'Finestre controllate']);
  assert.ok(editedReport.photos.length >= 2);

  const photoDelete = await admin.request(`/api/admin/photos/${editedReport.photos[0].id}`, { method: 'DELETE', json: {} });
  assert.equal(photoDelete.response.status, 200, JSON.stringify(photoDelete.data));
  const reportDelete = await admin.request(`/api/admin/reports/${reportId}`, { method: 'DELETE', json: {} });
  assert.equal(reportDelete.response.status, 200, JSON.stringify(reportDelete.data));

  const wrongDelete = await admin.request(`/api/admin/properties/${propertyId}`, {
    method: 'DELETE',
    json: { confirm_name: 'Nome errato', confirmation: 'ELIMINA' },
  });
  assert.equal(wrongDelete.response.status, 400);
  const propertyDelete = await admin.request(`/api/admin/properties/${propertyId}`, {
    method: 'DELETE',
    json: { confirm_name: 'Casa Operazioni V2', confirmation: 'ELIMINA' },
  });
  assert.equal(propertyDelete.response.status, 200, JSON.stringify(propertyDelete.data));

  const ownerNotifications = await owner.request('/api/notifications');
  assert.equal(ownerNotifications.response.status, 200);
  assert.ok(ownerNotifications.data.notifications.some((item) => item.kind === 'report'));
  const firstNotification = ownerNotifications.data.notifications[0];
  const readNotification = await owner.request(`/api/notifications/${firstNotification.id}/read`, { method: 'PATCH', json: {} });
  assert.equal(readNotification.response.status, 200);

  const emailTest = await admin.request('/api/admin/notifications/test-email', { method: 'POST', json: {} });
  assert.equal(emailTest.response.status, 503);
  assert.equal(emailTest.data.code, 'EMAIL_DISABLED');
});
`;
appendOnce('tests/app.test.js', "test('occupazioni, notifiche e gestione completa", testsAddition);

console.log('Operations V2 applicata senza patch runtime.');
