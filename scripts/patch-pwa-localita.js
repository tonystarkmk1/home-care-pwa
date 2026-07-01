const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const indexFile = path.join(root, 'public', 'index.html');
const serverFile = path.join(root, 'server3.js');
const stripePatchFile = path.join(root, 'scripts', 'start-stripe.js');

function replaceOnce(content, marker, replacement, label) {
  if (!content.includes(marker)) {
    console.warn('Marker non trovato:', label);
    return content;
  }
  return content.replace(marker, replacement);
}

// UI PWA + colore pulsanti + approvazione con prezzo mensile personalizzato.
let html = fs.readFileSync(indexFile, 'utf8');
if (!html.includes('apple-mobile-web-app-capable')) {
  html = html.replace(
    '<link rel="manifest" href="/manifest.json">',
    '<link rel="manifest" href="/manifest.json">\n  <link rel="apple-touch-icon" href="/icon-192.svg">\n  <meta name="mobile-web-app-capable" content="yes">\n  <meta name="apple-mobile-web-app-capable" content="yes">\n  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">\n  <meta name="apple-mobile-web-app-title" content="Home Care">\n  <meta name="application-name" content="Home Care">'
  );
}
if (!html.includes('let deferredInstallPrompt')) {
  const installCode = [
    "let deferredInstallPrompt=null;",
    "window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();deferredInstallPrompt=e});",
    "async function installApp(){",
    "  if(deferredInstallPrompt){deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;return}",
    "  alert('Per installare Home Care usa il menu del browser e scegli Aggiungi a schermata Home o Installa app.');",
    "}",
  ].join('\n') + '\n';
  html = html.replace('async function boot()', installCode + 'async function boot()');
}
html = html.replace("class=\"btn ${id==='base'?'gold':'teal'}\"", "class=\"btn teal\"");
html = html.replace("<button class=\"btn light small\" onclick=\"authView('login')\">Accedi</button>", "<button class=\"btn light small\" onclick=\"installApp()\">Installa app</button> <button class=\"btn light small\" onclick=\"authView('login')\">Accedi</button>");
html = html.replace("<button class=\"btn light small\" onclick=\"logout()\">Esci</button>", "<button class=\"btn light small\" onclick=\"installApp()\">Installa app</button> <button class=\"btn light small\" onclick=\"logout()\">Esci</button>");

const adminOverride = `
async function adminRequests(){
  const r=await api('/api/admin/property-requests');
  const defaultPrice={base:39,comfort:79,premium:199,villa_giardino:300,localita_limitrofe:150};
  document.getElementById('main').innerHTML='<div class="card"><h2>Richieste immobili da approvare</h2>'+
    (r.requests.length?'<table><thead><tr><th>Cliente</th><th>Immobile</th><th>Servizio richiesto</th><th>Prezzo mensile</th><th>Note</th><th></th></tr></thead><tbody>'+
    r.requests.map(function(p){
      const current=p.package_type||'base';
      return '<tr><td>'+esc(p.customer_name)+'<br>'+esc(p.customer_phone)+'<br>'+esc(p.customer_email)+'</td><td><b>'+esc(p.name)+'</b><br>'+esc(p.address)+'<br>'+esc(p.city)+' '+esc(p.zone)+'</td><td><select id="pkg-'+p.id+'">'+PLAN_LIST.map(function(k){return '<option value="'+k+'" '+(current===k?'selected':'')+'>'+P[k]+'</option>';}).join('')+'</select></td><td><input id="price-'+p.id+'" type="number" min="1" step="1" value="'+(defaultPrice[current]||150)+'"><br><span class="muted">Per Località Limitrofe e Villa & Giardino imposta il prezzo definitivo prima di approvare.</span></td><td>'+esc(p.client_notes||p.notes||'')+'</td><td><button class="btn small green" onclick="approveProp(\''+p.id+'\')">Approva e invia link mensile</button></td></tr>';
    }).join('')+'</tbody></table>':'<p>Nessuna richiesta in attesa.</p>')+'</div>';
}
async function approveProp(id){
  const package_type=document.getElementById('pkg-'+id)?.value;
  const monthly_price_euro=document.getElementById('price-'+id)?.value;
  await api('/api/admin/properties/'+id+'/approve',{method:'POST',body:JSON.stringify({package_type,monthly_price_euro})});
  alert('Immobile approvato. Se Stripe è configurato, il cliente riceverà il link per l’abbonamento mensile.');
  adminSet('requests');
}
`;
if (!html.includes('Approva e invia link mensile')) {
  html = html.replace('async function adminCustomers(){', adminOverride + '\nasync function adminCustomers(){');
}
fs.writeFileSync(indexFile, html);

// Server: approvazione con prezzo scelto da admin e checkout subscription mensile.
let server = fs.readFileSync(serverFile, 'utf8');
const approveRoute = `app.post('/api/admin/properties/:id/approve', auth(), adminOnly, async (req, res) => {
  const { package_type, monthly_price_euro } = req.body;
  const current = (await q('SELECT * FROM properties WHERE id=$1', [req.params.id])).rows[0];
  if (!current) return res.status(404).json({ error: 'Immobile non trovato' });
  const pkg = package_type || current.package_type || 'base';
  const cfg = packages[pkg] || packages.base;
  const customPrice = cents(monthly_price_euro);
  if ((pkg === 'localita_limitrofe' || pkg === 'villa_giardino') && !customPrice) return res.status(400).json({ error: 'Per questo piano devi indicare il prezzo mensile definitivo' });
  const monthlyCents = customPrice || cfg.priceCents;
  const row = (await q("UPDATE properties SET active=TRUE,request_status='approved',package_type=$2,monthly_price_cents=$3,approved_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *", [req.params.id, pkg, monthlyCents])).rows[0];
  await q('UPDATE customers SET current_package_type=$2,updated_at=NOW() WHERE id=$1', [row.customer_id, pkg]);
  let payment = null;
  if (stripe) {
    const customer = (await q('SELECT * FROM customers WHERE id=$1', [row.customer_id])).rows[0];
    let stripeCustomerId = customer.stripe_customer_id;
    if (!stripeCustomerId) {
      const sc = await stripe.customers.create({ name: customer.name, email: customer.email || undefined, phone: customer.phone || undefined, metadata: { customerId: customer.id } });
      stripeCustomerId = sc.id;
      await q('UPDATE customers SET stripe_customer_id=$2,updated_at=NOW() WHERE id=$1', [customer.id, stripeCustomerId]);
    }
    payment = (await q('INSERT INTO extra_payments(customer_id,amount_cents,description,status) VALUES($1,$2,$3,$4) RETURNING *', [row.customer_id, monthlyCents, 'Abbonamento mensile ' + (packages[pkg]?.label || pkg) + ' - ' + row.name, 'pending'])).rows[0];
    const base = (PUBLIC_URL || appUrl(req)).replace(/\/$/, '');
    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: 'subscription',
      line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: monthlyCents, recurring: { interval: 'month' }, product_data: { name: 'Home Care - ' + (packages[pkg]?.label || pkg), description: row.name + ' - ' + (row.address || '') } } }],
      success_url: base + '/?subscription=success',
      cancel_url: base + '/?subscription=cancel',
      metadata: { kind: 'subscription', customerId: row.customer_id, propertyId: row.id, packageType: pkg, extraPaymentId: payment.id },
    });
    payment = (await q('UPDATE extra_payments SET stripe_session_id=$2,payment_url=$3,updated_at=NOW() WHERE id=$1 RETURNING *', [payment.id, session.id, session.url])).rows[0];
    const html = '<div style="margin:0;padding:0;background:#f5f1e8;font-family:Arial,sans-serif;color:#06243a"><div style="max-width:620px;margin:0 auto;padding:30px"><div style="background:#fffdf7;border:1px solid #e1d6c8;border-radius:24px;padding:32px;text-align:center"><div style="font-size:30px;font-weight:800">Home <span style="color:#c7952d">Care</span></div><h1>Servizio approvato</h1><p style="font-size:16px;line-height:1.6;color:#334155">La tua richiesta è stata approvata. Puoi attivare l’abbonamento mensile cliccando sul pulsante.</p><p><b>Importo mensile: €' + (monthlyCents/100).toFixed(2) + '</b></p><a href="' + payment.payment_url + '" style="display:inline-block;background:#06243a;color:white;text-decoration:none;padding:14px 22px;border-radius:14px;font-weight:800;margin-top:16px">Attiva abbonamento</a></div></div></div>';
    if (customer.email) await sendBrevo(customer.email, 'Attiva il tuo abbonamento Home Care', html);
  }
  const msg = payment && payment.payment_url ? 'Abbiamo approvato la richiesta per l’immobile: ' + row.name + '. Link abbonamento: ' + payment.payment_url : 'Abbiamo approvato la richiesta per l’immobile: ' + row.name + '.';
  await q("INSERT INTO messages(customer_id,sender_role,sender_name,body,read_by_client,read_by_admin) VALUES($1,'admin','Home Care',$2,FALSE,TRUE)", [row.customer_id, msg]);
  res.json({ property: row, payment });
});

app.get('/api/admin/due-checks'`;
server = server.replace(/app\.post\('\/api\/admin\/properties\/:id\/approve',[\s\S]*?\n\}\);\n\napp\.get\('\/api\/admin\/due-checks'/, approveRoute);
fs.writeFileSync(serverFile, server);

// Stripe webhook: quando il checkout subscription è completato marca anche il pagamento come pagato.
let stripeScript = fs.readFileSync(stripePatchFile, 'utf8');
if (!stripeScript.includes("session.metadata.extraPaymentId) await q(\"UPDATE extra_payments SET status='paid'")) {
  stripeScript = stripeScript.replace(
    "await q(\"UPDATE customers SET payment_status='paid',paid_until=NULL,stripe_customer_id=COALESCE(stripe_customer_id,$2),stripe_subscription_id=COALESCE(stripe_subscription_id,$3),updated_at=NOW() WHERE id=$1\", [session.metadata.customerId, session.customer, session.subscription]);",
    "await q(\"UPDATE customers SET payment_status='paid',paid_until=NULL,stripe_customer_id=COALESCE(stripe_customer_id,$2),stripe_subscription_id=COALESCE(stripe_subscription_id,$3),updated_at=NOW() WHERE id=$1\", [session.metadata.customerId, session.customer, session.subscription]);\n        if (session.metadata.extraPaymentId) await q(\"UPDATE extra_payments SET status='paid',paid_at=NOW(),updated_at=NOW() WHERE id=$1\", [session.metadata.extraPaymentId]);"
  );
}
fs.writeFileSync(stripePatchFile, stripeScript);

console.log('Patch PWA, colori e prezzi personalizzati Località Limitrofe applicata.');
