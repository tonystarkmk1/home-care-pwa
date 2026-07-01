const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server3.js');
let code = fs.readFileSync(serverPath, 'utf8');

const oldRoute = `app.post('/api/admin/properties/:id/approve', auth(), adminOnly, async (req, res) => {
  const { package_type } = req.body;
  const current = (await q('SELECT * FROM properties WHERE id=$1', [req.params.id])).rows[0];
  if (!current) return res.status(404).json({ error: 'Immobile non trovato' });
  const pkg = package_type || current.package_type || 'base';
  const cfg = packages[pkg] || packages.base;
  const row = (await q("UPDATE properties SET active=TRUE,request_status='approved',package_type=$2,monthly_price_cents=$3,approved_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *", [req.params.id, pkg, cfg.priceCents])).rows[0];
  await q('UPDATE customers SET current_package_type=$2,updated_at=NOW() WHERE id=$1', [row.customer_id, pkg]);
  await q("INSERT INTO messages(customer_id,sender_role,sender_name,body,read_by_client,read_by_admin) VALUES($1,'admin','Home Care',$2,FALSE,TRUE)", [row.customer_id, 'Abbiamo approvato la richiesta per l’immobile: ' + row.name + '.']);
  res.json({ property: row });
});`;

const newRoute = `app.post('/api/admin/properties/:id/approve', auth(), adminOnly, async (req, res) => {
  const { package_type } = req.body;
  const current = (await q('SELECT * FROM properties WHERE id=$1', [req.params.id])).rows[0];
  if (!current) return res.status(404).json({ error: 'Immobile non trovato' });
  const pkg = package_type || current.package_type || 'base';
  const cfg = packages[pkg] || packages.base;
  const row = (await q("UPDATE properties SET active=TRUE,request_status='approved',package_type=$2,monthly_price_cents=$3,approved_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *", [req.params.id, pkg, cfg.priceCents])).rows[0];
  await q('UPDATE customers SET current_package_type=$2,updated_at=NOW() WHERE id=$1', [row.customer_id, pkg]);
  let link = null;
  if (stripe) {
    const customer = (await q('SELECT * FROM customers WHERE id=$1', [row.customer_id])).rows[0];
    let stripeCustomerId = customer.stripe_customer_id;
    if (!stripeCustomerId) {
      const sc = await stripe.customers.create({ name: customer.name, email: customer.email || undefined, phone: customer.phone || undefined, metadata: { customerId: customer.id } });
      stripeCustomerId = sc.id;
      await q('UPDATE customers SET stripe_customer_id=$2,updated_at=NOW() WHERE id=$1', [customer.id, stripeCustomerId]);
    }
    const baseRaw = PUBLIC_URL || appUrl(req);
    const base = baseRaw.endsWith('/') ? baseRaw.slice(0, -1) : baseRaw;
    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: 'subscription',
      line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: cfg.priceCents, recurring: { interval: 'month' }, product_data: { name: 'Home Care - ' + cfg.label, description: row.name } } }],
      success_url: base + '/?subscription=success',
      cancel_url: base + '/?subscription=cancel',
      metadata: { kind: 'subscription', customerId: row.customer_id, propertyId: row.id, packageType: pkg },
    });
    link = session.url;
    await q('UPDATE customers SET stripe_customer_id=$2,updated_at=NOW() WHERE id=$1', [customer.id, stripeCustomerId]);
    if (customer.email) await sendBrevo(customer.email, 'Attiva il tuo abbonamento Home Care', '<p>La tua richiesta è stata approvata.</p><p>Importo mensile: €' + (cfg.priceCents / 100).toFixed(2) + '</p><p><a href="' + link + '">Attiva abbonamento</a></p>');
  }
  const msg = link ? 'Abbiamo approvato la richiesta per l’immobile: ' + row.name + '. Link abbonamento mensile: ' + link : 'Abbiamo approvato la richiesta per l’immobile: ' + row.name + '.';
  await q("INSERT INTO messages(customer_id,sender_role,sender_name,body,read_by_client,read_by_admin) VALUES($1,'admin','Home Care',$2,FALSE,TRUE)", [row.customer_id, msg]);
  res.json({ property: row, subscriptionUrl: link });
});`;

if (!code.includes(oldRoute)) {
  console.warn('Route approvazione non trovata o già aggiornata.');
} else {
  code = code.replace(oldRoute, newRoute);
  console.log('Route approvazione aggiornata con link abbonamento mensile.');
}

fs.writeFileSync(serverPath, code);
