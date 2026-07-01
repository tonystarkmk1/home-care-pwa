const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const serverPath = path.join(root, 'server3.js');
const indexPath = path.join(root, 'public', 'index.html');

let server = fs.readFileSync(serverPath, 'utf8');

function insertBefore(content, marker, insert, label) {
  if (content.includes(insert.trim().slice(0, 80))) {
    console.log('Già presente:', label);
    return content;
  }
  if (!content.includes(marker)) {
    console.warn('Marker non trovato:', label);
    return content;
  }
  console.log('Aggiunto:', label);
  return content.replace(marker, insert + marker);
}

function replaceExact(content, oldText, newText, label) {
  if (content.includes(newText.trim().slice(0, 80))) {
    console.log('Già presente:', label);
    return content;
  }
  if (!content.includes(oldText)) {
    console.warn('Blocco non trovato:', label);
    return content;
  }
  console.log('Sostituito:', label);
  return content.replace(oldText, newText);
}

const oldWebhook = `app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) return res.json({ received: true, disabled: true });
  res.json({ received: true });
});`;

const newWebhook = `app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
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
      if (session.metadata && session.metadata.kind === 'preventivo' && session.metadata.paymentId) {
        const payment = (await q("UPDATE extra_payments SET status='paid',paid_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *", [session.metadata.paymentId])).rows[0];
        if (payment) {
          const customer = (await q('SELECT email FROM customers WHERE id=$1', [payment.customer_id])).rows[0];
          if (customer && customer.email) {
            const html = '<div style="font-family:Arial,sans-serif;color:#06243a"><h1>Pagamento ricevuto</h1><p>Il pagamento Home Care è stato ricevuto correttamente.</p></div>';
            await sendBrevo(customer.email, 'Pagamento ricevuto - Home Care', html);
          }
        }
      }
      if (session.metadata && session.metadata.kind === 'subscription' && session.metadata.customerId) {
        await q("UPDATE customers SET payment_status='paid',paid_until=NULL,stripe_customer_id=COALESCE(stripe_customer_id,$2),stripe_subscription_id=COALESCE(stripe_subscription_id,$3),updated_at=NOW() WHERE id=$1", [session.metadata.customerId, session.customer, session.subscription]);
      }
    }
    if (event.type === 'checkout.session.expired') {
      const session = event.data.object;
      if (session.metadata && session.metadata.kind === 'preventivo' && session.metadata.paymentId) {
        const payment = (await q('SELECT * FROM extra_payments WHERE id=$1', [session.metadata.paymentId])).rows[0];
        if (payment) {
          const customer = (await q('SELECT email FROM customers WHERE id=$1', [payment.customer_id])).rows[0];
          if (customer && customer.email) await sendBrevo(customer.email, 'Pagamento non completato - Home Care', '<p>Il link di pagamento è scaduto o il pagamento non è stato completato.</p>');
        }
      }
    }
    if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object;
      if (invoice.customer) {
        const customer = (await q("UPDATE customers SET payment_status='past_due',updated_at=NOW() WHERE stripe_customer_id=$1 RETURNING *", [invoice.customer])).rows[0];
        if (customer && customer.email) await sendBrevo(customer.email, 'Pagamento non riuscito - Home Care', '<p>Il pagamento del servizio non è andato a buon fine.</p>');
      }
    }
    res.json({ received: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Errore webhook Stripe' });
  }
});`;
server = replaceExact(server, oldWebhook, newWebhook, 'webhook Stripe preventivi');

const preventiviRoutes = `
async function createPreventivoCheckout(paymentId, req) {
  const payment = (await q('SELECT e.*,c.name customer_name,c.email customer_email,c.phone customer_phone,c.stripe_customer_id FROM extra_payments e JOIN customers c ON c.id=e.customer_id WHERE e.id=$1', [paymentId])).rows[0];
  if (!payment || !stripe) return payment;
  let stripeCustomerId = payment.stripe_customer_id;
  if (!stripeCustomerId) {
    const sc = await stripe.customers.create({ name: payment.customer_name, email: payment.customer_email || undefined, phone: payment.customer_phone || undefined, metadata: { customerId: payment.customer_id } });
    stripeCustomerId = sc.id;
    await q('UPDATE customers SET stripe_customer_id=$2,updated_at=NOW() WHERE id=$1', [payment.customer_id, stripeCustomerId]);
  }
  const rawBase = PUBLIC_URL || appUrl(req);
  const base = rawBase.endsWith('/') ? rawBase.slice(0, -1) : rawBase;
  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: 'payment',
    line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: payment.amount_cents, product_data: { name: 'Home Care - preventivo / extra', description: payment.description } } }],
    success_url: base + '/?payment=success',
    cancel_url: base + '/?payment=cancel',
    metadata: { kind: 'preventivo', paymentId: payment.id, customerId: payment.customer_id },
  });
  return (await q('UPDATE extra_payments SET stripe_session_id=$2,payment_url=$3,updated_at=NOW() WHERE id=$1 RETURNING *', [payment.id, session.id, session.url])).rows[0];
}

app.post('/api/admin/preventivi', auth(), adminOnly, async (req, res) => {
  const { customer_id, amount_euro, description } = req.body;
  const amount = cents(amount_euro);
  if (!customer_id || !amount || !description) return res.status(400).json({ error: 'Cliente, importo e descrizione obbligatori' });
  let payment = (await q('INSERT INTO extra_payments(customer_id,amount_cents,description,status) VALUES($1,$2,$3,$4) RETURNING *', [customer_id, amount, description, 'pending'])).rows[0];
  payment = await createPreventivoCheckout(payment.id, req);
  const customer = (await q('SELECT email FROM customers WHERE id=$1', [customer_id])).rows[0];
  if (customer && customer.email && payment.payment_url) {
    const html = '<div style="margin:0;padding:0;background:#f5f1e8;font-family:Arial,sans-serif;color:#06243a"><div style="max-width:620px;margin:0 auto;padding:30px"><div style="background:#fffdf7;border:1px solid #e1d6c8;border-radius:24px;padding:32px;text-align:center"><div style="font-size:30px;font-weight:800">Home <span style="color:#c7952d">Care</span></div><h1>Preventivo da saldare</h1><p style="font-size:16px;line-height:1.6;color:#334155">' + description + '</p><p><b>Importo: €' + (amount / 100).toFixed(2) + '</b></p><a href="' + payment.payment_url + '" style="display:inline-block;background:#06243a;color:white;text-decoration:none;padding:14px 22px;border-radius:14px;font-weight:800;margin-top:16px">Paga ora</a></div></div></div>';
    await sendBrevo(customer.email, 'Preventivo Home Care da saldare', html);
  }
  res.status(201).json({ payment, stripeDisabled: !stripe });
});

app.patch('/api/admin/preventivi/:id', auth(), adminOnly, async (req, res) => {
  const current = (await q('SELECT * FROM extra_payments WHERE id=$1', [req.params.id])).rows[0];
  if (!current) return res.status(404).json({ error: 'Preventivo non trovato' });
  if (current.status === 'paid') return res.status(400).json({ error: 'Non puoi modificare un preventivo già pagato' });
  const amount = req.body.amount_euro ? cents(req.body.amount_euro) : current.amount_cents;
  let payment = (await q('UPDATE extra_payments SET amount_cents=$2,description=$3,stripe_session_id=NULL,payment_url=NULL,updated_at=NOW() WHERE id=$1 RETURNING *', [req.params.id, amount, req.body.description || current.description])).rows[0];
  payment = await createPreventivoCheckout(payment.id, req);
  res.json({ payment });
});

app.post('/api/admin/preventivi/:id/cancel', auth(), adminOnly, async (req, res) => {
  const payment = (await q("UPDATE extra_payments SET status='canceled',payment_url=NULL,updated_at=NOW() WHERE id=$1 AND status<>'paid' RETURNING *", [req.params.id])).rows[0];
  if (!payment) return res.status(404).json({ error: 'Preventivo non trovato o già pagato' });
  res.json({ payment });
});

app.post('/api/admin/preventivi/:id/send', auth(), adminOnly, async (req, res) => {
  let payment = (await q('SELECT e.*,c.email customer_email FROM extra_payments e JOIN customers c ON c.id=e.customer_id WHERE e.id=$1', [req.params.id])).rows[0];
  if (!payment) return res.status(404).json({ error: 'Preventivo non trovato' });
  if (payment.status !== 'pending') return res.status(400).json({ error: 'Puoi inoltrare solo preventivi in sospeso' });
  if (!payment.payment_url) payment = await createPreventivoCheckout(payment.id, req);
  if (payment.customer_email && payment.payment_url) await sendBrevo(payment.customer_email, 'Preventivo Home Care da saldare', '<p>' + payment.description + '</p><p><a href="' + payment.payment_url + '">Paga ora</a></p>');
  res.json({ payment, message: 'Preventivo inoltrato al cliente' });
});

`;
server = insertBefore(server, "app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));", preventiviRoutes, 'routes preventivi');
fs.writeFileSync(serverPath, server);

let html = fs.readFileSync(indexPath, 'utf8');
const uiPatch = `
function clientPayments(d){document.getElementById('main').innerHTML='<div class="card"><h2>Pagamenti / Preventivi manutenzione</h2>'+(d.payments.length?'<table><thead><tr><th>Descrizione</th><th>Importo</th><th>Stato</th><th></th></tr></thead><tbody>'+d.payments.map(function(p){return '<tr><td>'+esc(p.description)+'</td><td>'+money(p.amount_cents)+'</td><td><span class="badge '+(p.status==='paid'?'ok':p.status==='canceled'?'bad':'warn')+'">'+(p.status==='pending'?'Da pagare':p.status==='paid'?'Pagato':'Annullato')+'</span></td><td>'+((p.status==='pending'&&p.payment_url)?'<a class="btn small gold" target="_blank" href="'+p.payment_url+'">Paga ora</a>':'')+'</td></tr>';}).join('')+'</tbody></table>':'<p>Nessun preventivo o extra.</p>')+'</div>'}
async function adminPayments(){const ex=await api('/api/admin/extra-payments'),mp=await api('/api/admin/manual-payments');document.getElementById('main').innerHTML='<div class="row"><div class="col4"><div class="card"><h3>Nuovo preventivo / extra</h3><form id="extraForm"><label>Cliente</label><select name="customer_id">'+opts()+'</select><label>Importo</label><input name="amount_euro" required><label>Descrizione</label><textarea name="description" required></textarea><button class="btn gold">Crea e inoltra preventivo</button></form></div></div><div class="col8"><div class="card"><h2>Preventivi e pagamenti</h2><table><thead><tr><th>Cliente</th><th>Descrizione</th><th>Importo</th><th>Stato</th><th>Azioni</th></tr></thead><tbody>'+ex.payments.map(function(p){return '<tr><td>'+esc(p.customer_name)+'</td><td>'+esc(p.description)+'</td><td>'+money(p.amount_cents)+'</td><td><span class="badge '+(p.status==='paid'?'ok':p.status==='canceled'?'bad':'warn')+'">'+p.status+'</span></td><td>'+((p.payment_url&&p.status==='pending')?'<a class="btn small gold" target="_blank" href="'+p.payment_url+'">Link</a> ':'')+(p.status==='pending'?'<button class="btn small teal" onclick="sendPreventivo(\''+p.id+'\')">Inoltra</button> <button class="btn small light" onclick="editPreventivo(\''+p.id+'\','+(Number(p.amount_cents||0)/100)+')">Modifica</button> <button class="btn small red" onclick="cancelPreventivo(\''+p.id+'\')">Annulla</button>':'')+'</td></tr>';}).join('')+'</tbody></table></div><div class="card"><h2>Pagamenti manuali</h2><table><tbody>'+mp.payments.map(function(p){return '<tr><td>'+esc(p.customer_name)+'</td><td>'+money(p.amount_cents)+'</td><td>'+(P[p.package_type]||p.package_type||'-')+'</td><td>'+(p.paid_until||'')+'</td></tr>';}).join('')+'</tbody></table></div></div></div>';document.getElementById('extraForm').onsubmit=async function(e){e.preventDefault();await api('/api/admin/preventivi',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});alert('Preventivo creato e inoltrato al cliente');adminPayments()}}
async function sendPreventivo(id){await api('/api/admin/preventivi/'+id+'/send',{method:'POST',body:'{}'});alert('Preventivo inoltrato')}
async function editPreventivo(id,oldAmount){const amount=prompt('Nuovo importo',oldAmount);if(amount===null)return;const description=prompt('Nuova descrizione');if(description===null)return;await api('/api/admin/preventivi/'+id,{method:'PATCH',body:JSON.stringify({amount_euro:amount,description})});adminPayments()}
async function cancelPreventivo(id){if(!confirm('Annullare questo preventivo?'))return;await api('/api/admin/preventivi/'+id+'/cancel',{method:'POST',body:'{}'});adminPayments()}
`;
if (!html.includes('Crea e inoltra preventivo')) {
  html = html.replace("if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});boot();", uiPatch + "\nif('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});boot();");
}
fs.writeFileSync(indexPath, html);
console.log('Preventivi sicuri applicati.');
