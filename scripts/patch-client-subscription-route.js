const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'server3.js');
let code = fs.readFileSync(file, 'utf8');

const route = `
app.post('/api/client/properties/:id/pay', auth(), clientOnly, async (req, res) => {
  if (!stripe) return res.status(400).json({ error: 'Stripe non configurato' });
  const billing = req.body.billing === 'annual' ? 'annual' : 'monthly';
  const property = (await q('SELECT p.*,c.name customer_name,c.email customer_email,c.phone customer_phone,c.stripe_customer_id FROM properties p JOIN customers c ON c.id=p.customer_id WHERE p.id=$1 AND p.customer_id=$2', [req.params.id, req.user.customer_id])).rows[0];
  if (!property) return res.status(404).json({ error: 'Immobile non trovato' });
  if (!property.active) return res.status(400).json({ error: 'Immobile non ancora attivo' });
  const cfg = packages[property.package_type] || packages.base;
  const monthlyCents = Number(property.monthly_price_cents || cfg.priceCents || 0);
  if (!monthlyCents) return res.status(400).json({ error: 'Importo piano non valido' });
  let stripeCustomerId = property.stripe_customer_id;
  if (!stripeCustomerId) {
    const sc = await stripe.customers.create({ name: property.customer_name, email: property.customer_email || undefined, phone: property.customer_phone || undefined, metadata: { customerId: property.customer_id } });
    stripeCustomerId = sc.id;
    await q('UPDATE customers SET stripe_customer_id=$2,updated_at=NOW() WHERE id=$1', [property.customer_id, stripeCustomerId]);
  }
  const rawBase = PUBLIC_URL || appUrl(req);
  const base = rawBase.endsWith('/') ? rawBase.slice(0, -1) : rawBase;
  const annual = billing === 'annual';
  const priceData = annual
    ? { currency: 'eur', unit_amount: monthlyCents * 12, product_data: { name: 'Home Care annuale - ' + (cfg.label || property.package_type), description: property.name } }
    : { currency: 'eur', unit_amount: monthlyCents, recurring: { interval: 'month' }, product_data: { name: 'Home Care - ' + (cfg.label || property.package_type), description: property.name } };
  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: annual ? 'payment' : 'subscription',
    line_items: [{ quantity: 1, price_data: priceData }],
    success_url: base + (annual ? '/?annual=success' : '/?subscription=success'),
    cancel_url: base + '/?payment=cancel',
    metadata: { kind: annual ? 'annual_property_payment' : 'subscription', customerId: property.customer_id, propertyId: property.id, packageType: property.package_type },
  });
  res.json({ url: session.url, billing });
});

`;

if (!code.includes("app.post('/api/client/properties/:id/pay'")) {
  const marker = "app.get('/api/client/messages', auth(), clientOnly, async (req, res) => {";
  if (code.includes(marker)) code = code.replace(marker, route + marker);
}

fs.writeFileSync(file, code);
console.log('Route checkout cliente immobile aggiunta.');
