const fs = require('fs');
const path = require('path');

const serverFile = path.join(__dirname, '..', 'server3.js');
let server = fs.readFileSync(serverFile, 'utf8');

function addBefore(marker, insert, label) {
  if (server.includes(insert.trim().slice(0, 70))) return console.log('Già presente:', label);
  if (!server.includes(marker)) return console.warn('Marker non trovato:', label);
  server = server.replace(marker, insert + marker);
  console.log('Aggiunto:', label);
}

addBefore("app.post('/api/auth/login', async (req, res) => {", `
app.post('/api/auth/forgot-password', async (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  if (!email) return res.status(400).json({ error: 'Inserisci la tua email' });
  const user = (await q('SELECT * FROM users WHERE LOWER(email)=LOWER($1)', [email])).rows[0];
  if (user) {
    const resetCode = code();
    const expires = new Date(Date.now() + 2 * 60 * 60 * 1000);
    await q('UPDATE users SET password_reset_code=$2,password_reset_expires_at=$3,updated_at=NOW() WHERE id=$1', [user.id, resetCode, expires]);
    const url = appUrl(req).replace(/\\/$/, '') + '/?reset=' + encodeURIComponent(resetCode);
    const html = '<div style="margin:0;padding:0;background:#f5f1e8;font-family:Arial,sans-serif;color:#06243a"><div style="max-width:620px;margin:0 auto;padding:30px"><div style="background:#fffdf7;border:1px solid #e1d6c8;border-radius:24px;padding:32px;text-align:center"><div style="font-size:30px;font-weight:800">Home <span style="color:#c7952d">Care</span></div><h1>Recupera password</h1><p style="font-size:16px;line-height:1.6;color:#334155">Clicca sul pulsante per impostare una nuova password. Il link scade tra 2 ore.</p><a href="' + url + '" style="display:inline-block;background:#06243a;color:white;text-decoration:none;padding:14px 22px;border-radius:14px;font-weight:800;margin-top:16px">Imposta nuova password</a></div></div></div>';
    await sendBrevo(user.email, 'Recupera password - Home Care', html);
  }
  res.json({ message: 'Se l’email è registrata, riceverai un link per impostare una nuova password.' });
});

app.post('/api/auth/reset-password', async (req, res) => {
  const resetCode = String(req.body.code || '');
  const password = String(req.body.password || '');
  if (!resetCode || password.length < 8) return res.status(400).json({ error: 'Link non valido o password troppo corta' });
  const user = (await q('SELECT * FROM users WHERE password_reset_code=$1 AND password_reset_expires_at>NOW()', [resetCode])).rows[0];
  if (!user) return res.status(400).json({ error: 'Link non valido o scaduto' });
  const hash = await bcrypt.hash(password, 12);
  await q('UPDATE users SET password_hash=$2,password_reset_code=NULL,password_reset_expires_at=NULL,updated_at=NOW() WHERE id=$1', [user.id, hash]);
  res.json({ message: 'Password aggiornata. Ora puoi accedere.' });
});

`, 'recupero password');

addBefore("app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));", `
app.get('/api/client/contacts', auth(), clientOnly, async (req, res) => {
  const contacts = (await q('SELECT * FROM contact_channels WHERE active=TRUE ORDER BY sort_order ASC, created_at ASC')).rows;
  res.json({ contacts });
});
app.get('/api/admin/contacts', auth(), adminOnly, async (req, res) => {
  const contacts = (await q('SELECT * FROM contact_channels ORDER BY active DESC, sort_order ASC, created_at ASC')).rows;
  res.json({ contacts });
});
app.post('/api/admin/contacts', auth(), adminOnly, async (req, res) => {
  const { label, kind = 'altro', value, note, sort_order = 0, active = true } = req.body;
  if (!label || !value) return res.status(400).json({ error: 'Nome contatto e valore obbligatori' });
  const contact = (await q('INSERT INTO contact_channels(label,kind,value,note,sort_order,active) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [label, kind, value, note || null, Number(sort_order) || 0, Boolean(active)])).rows[0];
  res.status(201).json({ contact });
});
app.post('/api/admin/contacts/:id/archive', auth(), adminOnly, async (req, res) => {
  const contact = (await q('UPDATE contact_channels SET active=FALSE,updated_at=NOW() WHERE id=$1 RETURNING *', [req.params.id])).rows[0];
  if (!contact) return res.status(404).json({ error: 'Contatto non trovato' });
  res.json({ contact });
});
app.post('/api/admin/extra-payments/:id/send', auth(), adminOnly, async (req, res) => {
  let payment = (await q('SELECT e.*,c.name customer_name,c.email customer_email FROM extra_payments e JOIN customers c ON c.id=e.customer_id WHERE e.id=$1', [req.params.id])).rows[0];
  if (!payment) return res.status(404).json({ error: 'Pagamento non trovato' });
  if (payment.status !== 'pending') return res.status(400).json({ error: 'Puoi inoltrare solo pagamenti in sospeso' });
  if (!payment.payment_url && typeof createExtraCheckout === 'function') payment = await createExtraCheckout(payment.id, req);
  if (!payment.payment_url) return res.status(400).json({ error: 'Link pagamento non disponibile. Verifica Stripe.' });
  const html = '<div style="margin:0;padding:0;background:#f5f1e8;font-family:Arial,sans-serif;color:#06243a"><div style="max-width:620px;margin:0 auto;padding:30px"><div style="background:#fffdf7;border:1px solid #e1d6c8;border-radius:24px;padding:32px;text-align:center"><div style="font-size:30px;font-weight:800">Home <span style="color:#c7952d">Care</span></div><h1>Pagamento da saldare</h1><p style="font-size:16px;line-height:1.6;color:#334155">' + payment.description + '</p><p><b>Importo: €' + (Number(payment.amount_cents || 0) / 100).toFixed(2) + '</b></p><a href="' + payment.payment_url + '" style="display:inline-block;background:#06243a;color:white;text-decoration:none;padding:14px 22px;border-radius:14px;font-weight:800;margin-top:16px">Paga ora</a></div></div></div>';
  if (payment.customer_email) await sendBrevo(payment.customer_email, 'Pagamento Home Care da saldare', html);
  res.json({ payment, message: 'Pagamento inoltrato al cliente' });
});

`, 'contatti e inoltro pagamento');

fs.writeFileSync(serverFile, server);
