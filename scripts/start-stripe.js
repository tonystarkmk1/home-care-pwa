const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const serverPath = path.join(root, 'server3.js');
const runtimePath = path.join(root, '.runtime-server-stripe.js');
const indexPath = path.join(root, 'public', 'index.html');

let code = fs.readFileSync(serverPath, 'utf8');

function patch(label, finder, replacement) {
  if (finder instanceof RegExp) {
    if (!finder.test(code)) {
      console.warn('Patch non applicata:', label);
      return;
    }
    code = code.replace(finder, replacement);
    console.log('Patch applicata:', label);
    return;
  }
  if (!code.includes(finder)) {
    console.warn('Patch non applicata:', label);
    return;
  }
  code = code.replace(finder, replacement);
  console.log('Patch applicata:', label);
}

const helpers = `
async function emailToCustomer(customerId, subject, message, link = '/') {
  const customer = (await q('SELECT email FROM customers WHERE id=$1', [customerId])).rows[0];
  if (!customer || !customer.email) return;
  const url = (PUBLIC_URL || '') + link;
  const html = '<div style="margin:0;padding:0;background:#f5f1e8;font-family:Arial,sans-serif;color:#06243a"><div style="max-width:620px;margin:0 auto;padding:30px"><div style="background:#fffdf7;border:1px solid #e1d6c8;border-radius:24px;padding:32px;text-align:center"><div style="font-size:30px;font-weight:800">Home <span style="color:#c7952d">Care</span></div><h1>'+subject+'</h1><p style="font-size:16px;line-height:1.6;color:#334155">'+message+'</p><a href="'+url+'" style="display:inline-block;background:#06243a;color:white;text-decoration:none;padding:14px 22px;border-radius:14px;font-weight:800;margin-top:16px">Apri Home Care</a></div></div></div>';
  await sendBrevo(customer.email, subject, html);
}
async function emailToAdmins(subject, message, link = '/') {
  const admins = (await q("SELECT email FROM users WHERE role='admin'")).rows;
  const url = (PUBLIC_URL || '') + link;
  const html = '<div style="margin:0;padding:0;background:#f5f1e8;font-family:Arial,sans-serif;color:#06243a"><div style="max-width:620px;margin:0 auto;padding:30px"><div style="background:#fffdf7;border:1px solid #e1d6c8;border-radius:24px;padding:32px;text-align:center"><div style="font-size:30px;font-weight:800">Home <span style="color:#c7952d">Care</span></div><h1>'+subject+'</h1><p style="font-size:16px;line-height:1.6;color:#334155">'+message+'</p><a href="'+url+'" style="display:inline-block;background:#06243a;color:white;text-decoration:none;padding:14px 22px;border-radius:14px;font-weight:800;margin-top:16px">Apri Home Care</a></div></div></div>';
  await Promise.all(admins.map((admin) => sendBrevo(admin.email, subject, html)));
}
`;
patch(
  'email helpers',
  "app.get('/api/config', (req, res) => res.json({ packages, checklists, stripeEnabled: Boolean(stripe), brevoEnabled: Boolean(BREVO_API_KEY && BREVO_SENDER_EMAIL) }));",
  "app.get('/api/config', (req, res) => res.json({ packages, checklists, stripeEnabled: Boolean(stripe), brevoEnabled: Boolean(BREVO_API_KEY && BREVO_SENDER_EMAIL) }));\n" + helpers
);

const webhook = `app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) return res.json({ received: true, disabled: true });
  let event;
  try {
    event = process.env.STRIPE_WEBHOOK_SECRET
      ? stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)
      : JSON.parse(req.body.toString());
  } catch (error) {
    return res.status(400).send('Webhook Error: ' + error.message);
  }
  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      if (session.metadata && session.metadata.kind === 'extra_payment') {
        const payment = (await q("UPDATE extra_payments SET status='paid',paid_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *", [session.metadata.extraPaymentId])).rows[0];
        if (payment) {
          await emailToCustomer(payment.customer_id, 'Pagamento ricevuto', 'Il pagamento richiesto è stato ricevuto correttamente.', '/?tab=payments');
          await emailToAdmins('Pagamento ricevuto', 'Un cliente ha saldato un pagamento extra o una manutenzione.', '/?admin=payments');
        }
      }
      if (session.metadata && session.metadata.kind === 'subscription' && session.metadata.customerId) {
        await q("UPDATE customers SET payment_status='paid',paid_until=NULL,stripe_customer_id=COALESCE(stripe_customer_id,$2),stripe_subscription_id=COALESCE(stripe_subscription_id,$3),updated_at=NOW() WHERE id=$1", [session.metadata.customerId, session.customer, session.subscription]);
      }
    }
    if (event.type === 'checkout.session.expired') {
      const session = event.data.object;
      if (session.metadata && session.metadata.kind === 'extra_payment') {
        const payment = (await q('SELECT * FROM extra_payments WHERE id=$1', [session.metadata.extraPaymentId])).rows[0];
        if (payment) await emailToCustomer(payment.customer_id, 'Pagamento non completato', 'Il link di pagamento è scaduto o il pagamento non è stato completato.', '/?tab=payments');
      }
    }
    if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object;
      if (invoice.customer) {
        const customer = (await q("UPDATE customers SET payment_status='past_due',updated_at=NOW() WHERE stripe_customer_id=$1 RETURNING *", [invoice.customer])).rows[0];
        if (customer) await emailToCustomer(customer.id, 'Pagamento non riuscito', 'Il pagamento del servizio non è andato a buon fine. Controlla il metodo di pagamento.', '/?tab=payments');
      }
    }
    res.json({ received: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Errore webhook Stripe' });
  }
});`;
patch(
  'stripe webhook',
  /app\.post\('\/api\/stripe\/webhook',[\s\S]*?\n\}\);\n\napp\.use\(express\.json/,
  webhook + "\n\napp.use(express.json"
);

const extraPayments = `async function createExtraCheckout(extraId, req) {
  const row = (await q('SELECT e.*,c.name customer_name,c.email customer_email,c.phone customer_phone,c.stripe_customer_id FROM extra_payments e JOIN customers c ON c.id=e.customer_id WHERE e.id=$1', [extraId])).rows[0];
  if (!row || !stripe) return row;
  let stripeCustomerId = row.stripe_customer_id;
  if (!stripeCustomerId) {
    const sc = await stripe.customers.create({ name: row.customer_name, email: row.customer_email || undefined, phone: row.customer_phone || undefined, metadata: { customerId: row.customer_id } });
    stripeCustomerId = sc.id;
    await q('UPDATE customers SET stripe_customer_id=$2,updated_at=NOW() WHERE id=$1', [row.customer_id, stripeCustomerId]);
  }
  const base = (PUBLIC_URL || appUrl(req)).replace(/\/$/, '');
  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: 'payment',
    line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: row.amount_cents, product_data: { name: 'Home Care - extra / manutenzione', description: row.description } } }],
    success_url: base + '/?payment=success',
    cancel_url: base + '/?payment=cancel',
    metadata: { kind: 'extra_payment', extraPaymentId: row.id, customerId: row.customer_id },
  });
  return (await q('UPDATE extra_payments SET stripe_session_id=$2,payment_url=$3,updated_at=NOW() WHERE id=$1 RETURNING *', [row.id, session.id, session.url])).rows[0];
}
app.get('/api/admin/extra-payments', auth(), adminOnly, async (req, res) => res.json({ payments: (await q('SELECT e.*,c.name customer_name,c.email customer_email,c.phone customer_phone FROM extra_payments e JOIN customers c ON c.id=e.customer_id ORDER BY e.created_at DESC')).rows }));
app.post('/api/admin/extra-payments', auth(), adminOnly, async (req, res) => {
  const { customer_id, amount_euro, description } = req.body;
  const amount = cents(amount_euro);
  if (!customer_id || !amount || !description) return res.status(400).json({ error: 'Cliente, importo e descrizione obbligatori' });
  let payment = (await q('INSERT INTO extra_payments(customer_id,amount_cents,description) VALUES($1,$2,$3) RETURNING *', [customer_id, amount, description])).rows[0];
  payment = await createExtraCheckout(payment.id, req);
  await emailToCustomer(customer_id, 'Nuovo pagamento disponibile', 'Hai un nuovo pagamento/preventivo da saldare: €' + (amount / 100).toFixed(2) + '.', '/?tab=payments');
  res.status(201).json({ payment, stripeDisabled: !stripe });
});
app.patch('/api/admin/extra-payments/:id', auth(), adminOnly, async (req, res) => {
  const { amount_euro, description } = req.body;
  const old = (await q('SELECT * FROM extra_payments WHERE id=$1', [req.params.id])).rows[0];
  if (!old) return res.status(404).json({ error: 'Pagamento non trovato' });
  if (old.status === 'paid') return res.status(400).json({ error: 'Non puoi modificare un pagamento già saldato' });
  const amount = amount_euro ? cents(amount_euro) : old.amount_cents;
  let payment = (await q('UPDATE extra_payments SET amount_cents=$2,description=$3,stripe_session_id=NULL,payment_url=NULL,updated_at=NOW() WHERE id=$1 RETURNING *', [req.params.id, amount, description || old.description])).rows[0];
  payment = await createExtraCheckout(payment.id, req);
  await emailToCustomer(payment.customer_id, 'Pagamento aggiornato', 'Un pagamento/preventivo è stato aggiornato da Home Care.', '/?tab=payments');
  res.json({ payment });
});
app.post('/api/admin/extra-payments/:id/cancel', auth(), adminOnly, async (req, res) => {
  const payment = (await q("UPDATE extra_payments SET status='canceled',payment_url=NULL,updated_at=NOW() WHERE id=$1 AND status<>'paid' RETURNING *", [req.params.id])).rows[0];
  if (!payment) return res.status(404).json({ error: 'Pagamento non trovato o già saldato' });
  await emailToCustomer(payment.customer_id, 'Pagamento annullato', 'Un pagamento/preventivo è stato annullato da Home Care.', '/?tab=payments');
  res.json({ payment });
});
app.get('/api/admin/manual-payments', auth(), adminOnly, async (req, res) => res.json({ payments: (await q('SELECT m.*,c.name customer_name FROM manual_payments m JOIN customers c ON c.id=m.customer_id ORDER BY m.created_at DESC LIMIT 100')).rows }));`;
patch(
  'extra payments routes',
  /app\.get\('\/api\/admin\/extra-payments',[\s\S]*?app\.get\('\/api\/admin\/manual-payments',[\s\S]*?\)\);/,
  extraPayments
);

patch(
  'client message email',
  "res.status(201).json({ message: (await q(\"INSERT INTO messages(customer_id,sender_role,sender_name,body,read_by_client,read_by_admin) VALUES($1,'client',$2,$3,TRUE,FALSE) RETURNING *\", [req.user.customer_id, req.user.name || 'Cliente', body])).rows[0] });",
  "const message = (await q(\"INSERT INTO messages(customer_id,sender_role,sender_name,body,read_by_client,read_by_admin) VALUES($1,'client',$2,$3,TRUE,FALSE) RETURNING *\", [req.user.customer_id, req.user.name || 'Cliente', body])).rows[0];\n  await emailToAdmins('Nuovo messaggio cliente', (req.user.name || 'Cliente') + ' ha scritto un nuovo messaggio.', '/?admin=messages');\n  res.status(201).json({ message });"
);
patch(
  'admin message email',
  "res.status(201).json({ message: (await q(\"INSERT INTO messages(customer_id,sender_role,sender_name,body,read_by_client,read_by_admin) VALUES($1,'admin','Home Care',$2,FALSE,TRUE) RETURNING *\", [customer_id, String(body).trim()])).rows[0] });",
  "const message = (await q(\"INSERT INTO messages(customer_id,sender_role,sender_name,body,read_by_client,read_by_admin) VALUES($1,'admin','Home Care',$2,FALSE,TRUE) RETURNING *\", [customer_id, String(body).trim()])).rows[0];\n  await emailToCustomer(customer_id, 'Nuovo messaggio da Home Care', 'Hai ricevuto un nuovo messaggio nella chat Home Care.', '/?tab=chat');\n  res.status(201).json({ message });"
);
patch(
  'new property request email',
  "await q(\"INSERT INTO messages(customer_id,sender_role,sender_name,body,read_by_client,read_by_admin) VALUES($1,'client',$2,$3,TRUE,FALSE)\", [req.user.customer_id, req.user.name || 'Cliente', `Ho inserito un nuovo immobile da affidare a Home Care: ${name}, ${address}`]);",
  "await emailToAdmins('Nuova richiesta immobile', (req.user.name || 'Cliente') + ' ha inserito un nuovo immobile da approvare: ' + name + ', ' + address, '/?admin=requests');"
);
patch(
  'property approved email',
  "await q(\"INSERT INTO messages(customer_id,sender_role,sender_name,body,read_by_client,read_by_admin) VALUES($1,'admin','Home Care',$2,FALSE,TRUE)\", [row.customer_id, 'Abbiamo approvato la richiesta per l’immobile: ' + row.name + '.']);",
  "await emailToCustomer(row.customer_id, 'Immobile approvato', 'La richiesta per il tuo immobile è stata approvata da Home Care.', '/?tab=properties');"
);
patch(
  'report email',
  "res.status(201).json({ check });",
  "await emailToCustomer(property.customer_id, 'Nuovo report disponibile', 'È disponibile un nuovo report per ' + property.name + '.', '/?tab=reports');\n  res.status(201).json({ check });"
);

// Aggiorna UI pagamenti lato cliente/admin.
let html = fs.readFileSync(indexPath, 'utf8');
function patchHtml(label, regex, replacement) {
  if (!regex.test(html)) console.warn('Patch UI non applicata:', label);
  html = html.replace(regex, replacement);
}
patchHtml(
  'client payments pay button',
  /function clientPayments\(d\)\{[\s\S]*?\nasync function clientChat/,
  `function clientPayments(d){document.getElementById('main').innerHTML=\`<div class="card"><h2>Pagamenti / Preventivi manutenzione</h2>\${d.payments.length?\`<table><thead><tr><th>Descrizione</th><th>Importo</th><th>Stato</th><th></th></tr></thead><tbody>\${d.payments.map(p=>\`<tr><td>\${esc(p.description)}</td><td>\${money(p.amount_cents)}</td><td><span class="badge \${p.status==='paid'?'ok':p.status==='canceled'?'bad':'warn'}">\${p.status==='pending'?'Da pagare':p.status==='paid'?'Pagato':'Annullato'}</span></td><td>\${p.status==='pending'&&p.payment_url?\`<a class="btn small gold" target="_blank" href="\${p.payment_url}">Paga ora</a>\`:''}</td></tr>\`).join('')}</tbody></table>\`:'<p>Nessun preventivo o extra.</p>'}</div>\`}
async function clientChat`
);
patchHtml(
  'admin payments controls',
  /async function adminPayments\(\)\{[\s\S]*?\nasync function adminMessages/,
  `async function adminPayments(){const[ex,mp]=await Promise.all([api('/api/admin/extra-payments'),api('/api/admin/manual-payments')]);document.getElementById('main').innerHTML=\`<div class="row"><div class="col4"><div class="card"><h3>Extra / preventivo manutenzione</h3><form id="extraForm"><label>Cliente</label><select name="customer_id">\${opts()}</select><label>Importo</label><input name="amount_euro" required><label>Descrizione</label><textarea name="description" required></textarea><button class="btn gold">Crea link pagamento</button></form></div></div><div class="col8"><div class="card"><h2>Pagamenti creati</h2><table><thead><tr><th>Cliente</th><th>Descrizione</th><th>Importo</th><th>Stato</th><th>Azioni</th></tr></thead><tbody>\${ex.payments.map(p=>\`<tr><td>\${esc(p.customer_name)}</td><td>\${esc(p.description)}</td><td>\${money(p.amount_cents)}</td><td><span class="badge \${p.status==='paid'?'ok':p.status==='canceled'?'bad':'warn'}">\${p.status}</span></td><td>\${p.payment_url&&p.status==='pending'?\`<a class="btn small gold" target="_blank" href="\${p.payment_url}">Link</a> \`:''}\${p.status==='pending'?\`<button class="btn small light" onclick="editPayment('\${p.id}','\${String(p.description).replace(/'/g,"\\\\'")}',\${(Number(p.amount_cents)||0)/100})">Modifica</button> <button class="btn small red" onclick="cancelPayment('\${p.id}')">Annulla</button>\`:''}</td></tr>\`).join('')}</tbody></table></div><div class="card"><h2>Pagamenti manuali</h2><table><tbody>\${mp.payments.map(p=>\`<tr><td>\${esc(p.customer_name)}</td><td>\${money(p.amount_cents)}</td><td>\${P[p.package_type]||p.package_type||'-'}</td><td>\${p.paid_until||''}</td></tr>\`).join('')}</tbody></table></div></div></div>\`;document.getElementById('extraForm').onsubmit=async e=>{e.preventDefault();await api('/api/admin/extra-payments',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});alert('Pagamento creato e notificato al cliente');adminPayments()}}
async function editPayment(id,oldDesc,oldAmount){const amount=prompt('Nuovo importo',oldAmount);if(amount===null)return;const description=prompt('Nuova descrizione',oldDesc);if(description===null)return;await api('/api/admin/extra-payments/'+id,{method:'PATCH',body:JSON.stringify({amount_euro:amount,description})});alert('Pagamento aggiornato');adminPayments()}
async function cancelPayment(id){if(!confirm('Annullare questo pagamento?'))return;await api('/api/admin/extra-payments/'+id+'/cancel',{method:'POST',body:'{}'});adminPayments()}
async function adminMessages`
);
fs.writeFileSync(indexPath, html);
fs.writeFileSync(runtimePath, code);
require(runtimePath);
