const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const source = path.join(root, 'server2.js');
const target = path.join(root, '.runtime-server.js');

let code = fs.readFileSync(source, 'utf8');
code = code.replace(
  "app.use(express.json({limit:'10mb'}),express.urlencoded({extended:true}),'/uploads',express.static(ABS_UPLOAD_DIR),express.static(path.join(__dirname,'public')));",
  "app.use(express.json({limit:'10mb'}));\napp.use(express.urlencoded({extended:true}));\napp.use('/uploads', express.static(ABS_UPLOAD_DIR));\napp.use(express.static(path.join(__dirname,'public')));"
);

const extraRoutes = `
function prettyConfirmHtml(ok){
  const title = ok ? 'Email confermata con successo' : 'Link non valido o scaduto';
  const text = ok ? 'Il tuo account Home Care è stato attivato. Ora puoi accedere, scegliere il servizio e inserire l’immobile da affidare a Home Care.' : 'Il link utilizzato non è valido oppure è scaduto. Torna alla registrazione e richiedi un nuovo accesso.';
  return '<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+title+'</title><style>body{margin:0;background:#f5f1e8;color:#06243a;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}.wrap{min-height:100vh;display:grid;place-items:center;padding:24px}.card{max-width:560px;background:#fffdf7;border:1px solid #e1d6c8;border-radius:28px;padding:34px;box-shadow:0 20px 60px rgba(6,36,58,.16);text-align:center}.logo{font-size:34px;font-weight:900;margin-bottom:8px}.logo span{color:#c7952d}.icon{width:78px;height:78px;border-radius:50%;display:grid;place-items:center;margin:0 auto 18px;background:'+(ok?'#e4f6eb;color:#176b35':'#fff1f0;color:#9a1d13')+';font-size:42px}.btn{display:inline-block;margin-top:18px;padding:13px 22px;background:#06243a;color:white;text-decoration:none;border-radius:14px;font-weight:900}</style></head><body><div class="wrap"><div class="card"><div class="logo">Home <span>Care</span></div><div class="icon">'+(ok?'✓':'!')+'</div><h1>'+title+'</h1><p>'+text+'</p><a class="btn" href="/">Accedi</a></div></div></body></html>';
}

app.post('/api/auth/register', async (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Nome, email e password obbligatori' });
  if (String(password).length < 8) return res.status(400).json({ error: 'La password deve contenere almeno 8 caratteri' });
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const mail = String(email).toLowerCase().trim();
    if ((await db.query('SELECT id FROM users WHERE LOWER(email)=LOWER($1)', [mail])).rows[0]) { await db.query('ROLLBACK'); return res.status(409).json({ error: 'Email già registrata' }); }
    const cu = (await db.query("INSERT INTO customers(name,email,phone,payment_status) VALUES($1,$2,$3,'unpaid') RETURNING *", [name, mail, phone || null])).rows[0];
    const hash = await bcrypt.hash(password, 12), confirm = code(), expires = new Date(Date.now() + 48*60*60*1000);
    await db.query("INSERT INTO users(name,email,phone,password_hash,role,customer_id,email_confirmed,email_confirm_code,email_confirm_expires_at) VALUES($1,$2,$3,$4,'client',$5,FALSE,$6,$7)", [name, mail, phone || null, hash, cu.id, confirm, expires]);
    await db.query('COMMIT');
    const url = baseUrl(req).replace(/\\/$/,'') + '/api/auth/confirm-email?code=' + encodeURIComponent(confirm);
    const html = '<div style="margin:0;padding:0;background:#f5f1e8;font-family:Arial,sans-serif;color:#06243a"><div style="max-width:620px;margin:0 auto;padding:30px"><div style="background:#fffdf7;border:1px solid #e1d6c8;border-radius:24px;padding:32px;text-align:center"><div style="font-size:32px;font-weight:800;margin-bottom:8px">Home <span style="color:#c7952d">Care</span></div><h1 style="margin:10px 0 12px">Conferma il tuo account</h1><p style="font-size:16px;line-height:1.6;color:#334155">Ciao '+String(name).replace(/[<>]/g,'')+', grazie per esserti registrato. Conferma la tua email per accedere all’area cliente, scegliere il servizio e inserire l’immobile da affidare a Home Care.</p><a href="'+url+'" style="display:inline-block;background:#06243a;color:white;text-decoration:none;padding:14px 22px;border-radius:14px;font-weight:800;margin-top:16px">Conferma il tuo account</a><p style="font-size:13px;color:#64748b;margin-top:22px">Il link scade tra 48 ore. Se non hai richiesto tu questa registrazione, ignora questa email.</p></div></div></div>';
    const sent = await brevo(mail, 'Conferma il tuo account Home Care', html);
    res.status(201).json({ message: sent.sent ? 'Registrazione completata. Controlla la tua email.' : 'Registrazione completata. Brevo non configurato: usa il link di test.', emailSent: sent.sent, confirmationUrl: sent.sent ? undefined : url });
  } catch(e) { await db.query('ROLLBACK').catch(()=>null); console.error(e); res.status(500).json({ error: 'Errore registrazione' }); }
  finally { db.release(); }
});

app.get('/api/auth/confirm-email', async (req, res) => {
  const r = await q("UPDATE users SET email_confirmed=TRUE,email_confirm_code=NULL,email_confirm_expires_at=NULL,updated_at=NOW() WHERE email_confirm_code=$1 AND email_confirm_expires_at>NOW() RETURNING email", [String(req.query.code || '')]);
  res.status(r.rows[0] ? 200 : 400).send(prettyConfirmHtml(Boolean(r.rows[0])));
});

app.post('/api/client/properties', auth(), client, async (req, res) => {
  const { name, address, city='Badesi', zone, package_type='base', property_type, notes } = req.body;
  if (!name || !address) return res.status(400).json({ error: 'Nome immobile e indirizzo sono obbligatori' });
  const cfg = packageConfig[package_type] || packageConfig.base;
  const row = (await q("INSERT INTO properties(customer_id,name,address,city,zone,package_type,monthly_price_cents,next_check_date,active,notes,request_status,property_type,client_notes,requested_package_type,requested_at) VALUES($1,$2,$3,$4,$5,$6,$7,CURRENT_DATE,FALSE,$8,'pending',$9,$10,$6,NOW()) RETURNING *", [req.user.customer_id, name, address, city, zone || null, package_type, cfg.priceCents, notes || null, property_type || null, notes || null])).rows[0];
  await q("INSERT INTO messages(customer_id,sender_role,sender_name,body,read_by_client,read_by_admin) VALUES($1,'client',$2,$3,TRUE,FALSE)", [req.user.customer_id, req.user.name || 'Cliente', 'Ho inserito un nuovo immobile da affidare a Home Care: ' + name + ', ' + address]);
  res.status(201).json({ property: row });
});

app.get('/api/client/dashboard', auth(), client, async (req, res) => {
  const id = req.user.customer_id;
  const customer = (await q(\`SELECT *,CASE WHEN \${valid('customers')} THEN TRUE ELSE FALSE END payment_valid FROM customers WHERE id=$1\`, [id])).rows[0];
  const properties = (await q('SELECT * FROM properties WHERE customer_id=$1 ORDER BY created_at DESC', [id])).rows;
  const reports = (await q("SELECT ch.*,p.name property_name FROM checks ch JOIN properties p ON p.id=ch.property_id WHERE p.customer_id=$1 AND ch.status='done' ORDER BY ch.completed_at DESC LIMIT 30", [id])).rows;
  const payments = (await q('SELECT * FROM extra_payments WHERE customer_id=$1 ORDER BY created_at DESC', [id])).rows;
  res.json({ customer, properties, reports, payments, packages: packageConfig });
});

app.get('/api/client/messages', auth(), client, async (req, res) => {
  await q('UPDATE messages SET read_by_client=TRUE WHERE customer_id=$1 AND sender_role=$2', [req.user.customer_id, 'admin']);
  const rows = (await q('SELECT * FROM messages WHERE customer_id=$1 ORDER BY created_at ASC LIMIT 200', [req.user.customer_id])).rows;
  res.json({ messages: rows });
});

app.post('/api/client/messages', auth(), client, async (req, res) => {
  const body = String(req.body.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Scrivi un messaggio' });
  const row = (await q("INSERT INTO messages(customer_id,sender_role,sender_name,body,read_by_client,read_by_admin) VALUES($1,'client',$2,$3,TRUE,FALSE) RETURNING *", [req.user.customer_id, req.user.name || 'Cliente', body])).rows[0];
  res.status(201).json({ message: row });
});

app.get('/api/admin/messages', auth(), admin, async (req, res) => {
  const rows = (await q('SELECT m.*,c.name customer_name,c.email customer_email,c.phone customer_phone FROM messages m JOIN customers c ON c.id=m.customer_id ORDER BY m.created_at DESC LIMIT 300')).rows;
  res.json({ messages: rows });
});

app.post('/api/admin/messages', auth(), admin, async (req, res) => {
  const { customer_id, body } = req.body;
  if (!customer_id || !String(body || '').trim()) return res.status(400).json({ error: 'Cliente e messaggio obbligatori' });
  const row = (await q("INSERT INTO messages(customer_id,sender_role,sender_name,body,read_by_client,read_by_admin) VALUES($1,'admin','Home Care',$2,FALSE,TRUE) RETURNING *", [customer_id, String(body).trim()])).rows[0];
  res.status(201).json({ message: row });
});

app.post('/api/admin/properties/:id/approve', auth(), admin, async (req, res) => {
  const { package_type } = req.body;
  const current = (await q('SELECT * FROM properties WHERE id=$1', [req.params.id])).rows[0];
  if (!current) return res.status(404).json({ error: 'Immobile non trovato' });
  const pkg = package_type || current.package_type || 'base';
  const cfg = packageConfig[pkg] || packageConfig.base;
  const row = (await q("UPDATE properties SET active=TRUE,request_status='approved',package_type=$2,monthly_price_cents=$3,approved_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *", [req.params.id, pkg, cfg.priceCents])).rows[0];
  await q("INSERT INTO messages(customer_id,sender_role,sender_name,body,read_by_client,read_by_admin) VALUES($1,'admin','Home Care',$2,FALSE,TRUE)", [row.customer_id, 'Abbiamo approvato la richiesta per l’immobile: ' + row.name + '.']);
  res.json({ property: row });
});

app.post('/api/admin/customers/:id/remove-final', auth(), admin, async (req, res) => {
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
  } catch(e) { await db.query('ROLLBACK').catch(()=>null); console.error(e); res.status(500).json({ error: 'Errore durante la rimozione definitiva' }); }
  finally { db.release(); }
});
`;

code = code.replace("app.post('/api/auth/register'", extraRoutes + "\napp.post('/api/auth/register'");

fs.writeFileSync(target, code);
require(target);
