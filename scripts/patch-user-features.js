const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const serverFile = path.join(root, 'server3.js');
const indexFile = path.join(root, 'public', 'index.html');
const stripePatchFile = path.join(root, 'scripts', 'start-stripe.js');

let server = fs.readFileSync(serverFile, 'utf8');
function patchServerOnce(marker, insert, label) {
  if (server.includes(insert.trim().slice(0, 80))) {
    console.log('Patch server già presente:', label);
    return;
  }
  if (!server.includes(marker)) {
    console.warn('Patch server non trovato:', label);
    return;
  }
  server = server.replace(marker, insert + marker);
  console.log('Patch server applicata:', label);
}

const passwordRoutes = `
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

`;
patchServerOnce("app.post('/api/auth/login', async (req, res) => {", passwordRoutes, 'password recovery routes');

const contactRoutes = `
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
app.patch('/api/admin/contacts/:id', auth(), adminOnly, async (req, res) => {
  const { label, kind, value, note, sort_order, active } = req.body;
  const contact = (await q('UPDATE contact_channels SET label=COALESCE($2,label),kind=COALESCE($3,kind),value=COALESCE($4,value),note=$5,sort_order=COALESCE($6,sort_order),active=COALESCE($7,active),updated_at=NOW() WHERE id=$1 RETURNING *', [req.params.id, label || null, kind || null, value || null, note || null, typeof sort_order === 'undefined' ? null : Number(sort_order), typeof active === 'boolean' ? active : null])).rows[0];
  if (!contact) return res.status(404).json({ error: 'Contatto non trovato' });
  res.json({ contact });
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

`;
patchServerOnce("app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));", contactRoutes, 'contacts and payment forwarding routes');
fs.writeFileSync(serverFile, server);

let html = fs.readFileSync(indexFile, 'utf8');
function patchHtmlOnce(marker, insert, label) {
  if (html.includes(insert.trim().slice(0, 70))) {
    console.log('Patch UI già presente:', label);
    return;
  }
  if (!html.includes(marker)) {
    console.warn('Patch UI non trovato:', label);
    return;
  }
  html = html.replace(marker, insert + marker);
  console.log('Patch UI applicata:', label);
}
function patchHtmlRegex(label, regex, replacement) {
  if (!regex.test(html)) {
    console.warn('Patch UI non trovato:', label);
    return;
  }
  html = html.replace(regex, replacement);
  console.log('Patch UI applicata:', label);
}

patchHtmlOnce('async function boot()', `
async function forgotPassword(){
  const email=prompt('Inserisci la tua email per ricevere il link di recupero password');
  if(!email)return;
  try{const r=await api('/api/auth/forgot-password',{method:'POST',body:JSON.stringify({email})});alert(r.message||'Controlla la tua email.')}catch(e){alert(e.message)}
}
function resetPasswordView(code){
  app.innerHTML=topPublic()+`<div class="wrap"><div class="loginBox"><h1>Imposta nuova password</h1><p class="muted">Scegli una nuova password per accedere a Home Care.</p><form id="resetForm"><label>Nuova password</label><input name="password" type="password" minlength="8" required><br><br><button class="btn" style="width:100%">Aggiorna password</button></form><div id="resetMsg"></div></div></div>`;
  document.getElementById('resetForm').onsubmit=async e=>{e.preventDefault();const msg=document.getElementById('resetMsg');try{const r=await api('/api/auth/reset-password',{method:'POST',body:JSON.stringify({code,password:new FormData(e.target).get('password')})});msg.innerHTML=note(r.message,'success');setTimeout(()=>authView('login'),1000)}catch(x){msg.innerHTML=note(x.message,'error')}};
}
`, 'password reset UI functions');

html = html.replace("async function boot(){try{S.config=await api('/api/config',{headers:{}})}catch(e){}if(!S.token)return publicHome();", "async function boot(){const reset=new URLSearchParams(location.search).get('reset');if(reset)return resetPasswordView(reset);try{S.config=await api('/api/config',{headers:{}})}catch(e){}if(!S.token)return publicHome();");
html = html.replace('<br><br><button class="btn" style="width:100%">Accedi</button></form>', '<br><br><button class="btn" style="width:100%">Accedi</button><p><button type="button" class="btn light small" onclick="forgotPassword()">Recupera password</button></p></form>');

html = html.replace('.mobileMenu{display:none}', '.chatQuick{position:fixed;right:18px;bottom:18px;z-index:50;border-radius:999px;box-shadow:0 12px 28px rgba(6,36,58,.25);font-size:18px}.mobileMenu{display:none}');
html = html.replace('<main class="main" id="main">Caricamento...</main></div>`;const d=await clientData();', '<main class="main" id="main">Caricamento...</main></div><button class="btn gold chatQuick" onclick="clientSet(\'chat\')">💬 Chat</button>`;const d=await clientData();');
html = html.replace("{id:'reports',label:'Report'},{id:'payments',label:'Pagamenti / Preventivi'},{id:'chat',label:'Chat Home Care'}", "{id:'reports',label:'Report'},{id:'payments',label:'Pagamenti / Preventivi'},{id:'chat',label:'Chat Home Care'},{id:'contacts',label:'Contatti'}");
html = html.replace("if(S.clientTab==='chat')clientChat()", "if(S.clientTab==='chat')clientChat();if(S.clientTab==='contacts')clientContacts()");
html = html.replace("{id:'payments',label:'Pagamenti'},{id:'messages',label:'Messaggi'},{id:'helpers',label:'Aiutanti'}", "{id:'payments',label:'Pagamenti'},{id:'messages',label:'Messaggi'},{id:'contacts',label:'Contatti'},{id:'helpers',label:'Aiutanti'}");
html = html.replace('payments:adminPayments,messages:adminMessages,helpers:adminHelpers', 'payments:adminPayments,messages:adminMessages,contacts:adminContacts,helpers:adminHelpers');

patchHtmlOnce('async function loadBase(){', `
async function clientContacts(){
  document.getElementById('main').innerHTML='<div class="card"><h2>Contatti Home Care</h2><p>Per comunicazioni operative usa preferibilmente la chat interna.</p><button class="btn gold" onclick="clientSet(\'chat\')">Apri chat Home Care</button><div id="contactList" style="margin-top:14px">Caricamento...</div></div>';
  try{const r=await api('/api/client/contacts');document.getElementById('contactList').innerHTML=r.contacts.length?r.contacts.map(c=>`<div class="notice"><b>${esc(c.label)}</b><br>${esc(c.kind)}: ${esc(c.value)}${c.note?'<br><span class="muted">'+esc(c.note)+'</span>':''}</div>`).join(''):'<p class="muted">Nessun contatto aggiuntivo inserito. Usa la chat interna.</p>'}catch(e){document.getElementById('contactList').innerHTML=note(e.message,'error')}
}
`, 'client contacts UI');

patchHtmlOnce('async function adminHelpers(){', `
async function adminContacts(){
  const r=await api('/api/admin/contacts');
  document.getElementById('main').innerHTML=`<div class="row"><div class="col4"><div class="card"><h2>Nuovo contatto</h2><form id="contactForm"><label>Nome</label><input name="label" required placeholder="WhatsApp, Email assistenza..."><label>Tipo</label><select name="kind"><option value="telefono">Telefono</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="altro">Altro</option></select><label>Valore</label><input name="value" required><label>Note</label><textarea name="note"></textarea><label>Ordine</label><input name="sort_order" type="number" value="0"><button class="btn">Salva contatto</button></form></div></div><div class="col8"><div class="card"><h2>Contatti visibili ai clienti</h2>${r.contacts.length?`<table><thead><tr><th>Nome</th><th>Tipo</th><th>Valore</th><th>Stato</th><th></th></tr></thead><tbody>${r.contacts.map(c=>`<tr><td>${esc(c.label)}</td><td>${esc(c.kind)}</td><td>${esc(c.value)}<br><span class="muted">${esc(c.note||'')}</span></td><td>${c.active?'Visibile':'Archiviato'}</td><td>${c.active?`<button class="btn small red" onclick="archiveContact('${c.id}')">Archivia</button>`:''}</td></tr>`).join('')}</tbody></table>`:'<p>Nessun contatto inserito.</p>'}</div></div></div>`;
  document.getElementById('contactForm').onsubmit=async e=>{e.preventDefault();await api('/api/admin/contacts',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});adminContacts()}
}
async function archiveContact(id){if(!confirm('Archiviare questo contatto?'))return;await api('/api/admin/contacts/'+id+'/archive',{method:'POST',body:'{}'});adminContacts()}
`, 'admin contacts UI');

// Pulsante inoltra nella tabella pagamenti generata dallo script Stripe.
let stripePatch = fs.readFileSync(stripePatchFile, 'utf8');
if (!stripePatch.includes('sendPayment(')) {
  stripePatch = stripePatch.replace("<a class=\"btn small gold\" target=\"_blank\" href=\"\\${p.payment_url}\">Link</a> ", "<a class=\"btn small gold\" target=\"_blank\" href=\"\\${p.payment_url}\">Link</a> <button class=\"btn small teal\" onclick=\"sendPayment('\\${p.id}')\">Inoltra</button> ");
  stripePatch = stripePatch.replace("async function editPayment(id,oldDesc,oldAmount){", "async function sendPayment(id){await api('/api/admin/extra-payments/'+id+'/send',{method:'POST',body:'{}'});alert('Pagamento inoltrato al cliente')}\nasync function editPayment(id,oldDesc,oldAmount){");
  fs.writeFileSync(stripePatchFile, stripePatch);
  console.log('Patch Stripe UI inoltra applicata.');
}

fs.writeFileSync(indexFile, html);
console.log('Funzioni utente extra applicate.');
