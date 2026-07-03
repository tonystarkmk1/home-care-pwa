const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const indexPath = path.join(root, 'public', 'index.html');
const serverPath = path.join(root, 'server3.js');

function patchIndex() {
  let html = fs.readFileSync(indexPath, 'utf8');

  if (!html.includes('/client-pay-date-v1.js')) {
    html = html.replace('<script>\nconst app=', '<script src="/client-pay-date-v1.js?v=2"></script>\n<script>\nconst app=');
  } else {
    html = html.replace(/\/client-pay-date-v1\.js\?v=\d+/g, '/client-pay-date-v1.js?v=2');
  }

  if (!html.includes('window.applyClientPayDateV1')) {
    if (html.includes('if(window.applyCustomPlanV1)window.applyCustomPlanV1();if(window.applyContactsV1)window.applyContactsV1();boot();')) {
      html = html.replace('if(window.applyCustomPlanV1)window.applyCustomPlanV1();if(window.applyContactsV1)window.applyContactsV1();boot();', 'if(window.applyCustomPlanV1)window.applyCustomPlanV1();if(window.applyContactsV1)window.applyContactsV1();if(window.applyClientPayDateV1)window.applyClientPayDateV1();boot();');
    } else if (html.includes('if(window.applyCustomPlanV1)window.applyCustomPlanV1();boot();')) {
      html = html.replace('if(window.applyCustomPlanV1)window.applyCustomPlanV1();boot();', 'if(window.applyCustomPlanV1)window.applyCustomPlanV1();if(window.applyClientPayDateV1)window.applyClientPayDateV1();boot();');
    } else {
      html = html.replace("if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});boot();", "if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});if(window.applyClientPayDateV1)window.applyClientPayDateV1();boot();");
    }
  }

  fs.writeFileSync(indexPath, html);
}

function patchServer() {
  let code = fs.readFileSync(serverPath, 'utf8');

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
      const meta = session.metadata || {};
      if ((meta.kind === 'plan_subscription' || meta.kind === 'subscription') && meta.customerId) {
        await q("UPDATE customers SET payment_status='paid',paid_until=NULL,current_package_type=COALESCE($4,current_package_type),stripe_customer_id=COALESCE(stripe_customer_id,$2),stripe_subscription_id=COALESCE(stripe_subscription_id,$3),updated_at=NOW() WHERE id=$1", [meta.customerId, session.customer, session.subscription, meta.packageType || null]);
      }
      if ((meta.kind === 'plan_annual' || meta.kind === 'annual_property_payment') && meta.customerId) {
        await q("UPDATE customers SET payment_status='paid',paid_until=(CURRENT_DATE + INTERVAL '1 year')::date,current_package_type=COALESCE($3,current_package_type),stripe_customer_id=COALESCE(stripe_customer_id,$2),updated_at=NOW() WHERE id=$1", [meta.customerId, session.customer, meta.packageType || null]);
      }
      if (meta.kind === 'extra_payment' && meta.extraPaymentId) {
        await q("UPDATE extra_payments SET status='paid',paid_at=NOW(),updated_at=NOW() WHERE id=$1", [meta.extraPaymentId]);
      }
    }
    if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object;
      if (invoice.customer) await q("UPDATE customers SET payment_status='past_due',updated_at=NOW() WHERE stripe_customer_id=$1", [invoice.customer]);
    }
    res.json({ received: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Errore webhook Stripe' });
  }
});`;

  if (code.includes(oldWebhook)) {
    code = code.replace(oldWebhook, newWebhook);
  }

  if (!code.includes("app.post('/api/client/plan-checkout'")) {
    const route = `
app.post('/api/client/plan-checkout', auth(), clientOnly, async (req, res) => {
  if (!stripe) return res.status(400).json({ error: 'Stripe non configurato' });
  const billing = req.body.billing === 'annual' ? 'annual' : 'monthly';
  const requestedPackage = req.body.package_type || null;
  const customer = (await q('SELECT * FROM customers WHERE id=$1', [req.user.customer_id])).rows[0];
  if (!customer) return res.status(404).json({ error: 'Cliente non trovato' });
  const pkg = requestedPackage || customer.current_package_type || 'base';
  const cfg = packages[pkg] || packages.base;
  const property = (await q("SELECT * FROM properties WHERE customer_id=$1 AND active=TRUE ORDER BY approved_at DESC NULLS LAST, created_at DESC LIMIT 1", [customer.id])).rows[0];
  const usePropertyPrice = property && property.package_type === pkg && property.monthly_price_cents;
  const customMonthly = pkg === 'personalizzato' ? cents(req.body.custom_monthly_price_euro) : null;
  const monthlyCents = Number(customMonthly || (usePropertyPrice ? property.monthly_price_cents : cfg.priceCents));
  if (!monthlyCents) return res.status(400).json({ error: 'Importo piano non valido' });
  let stripeCustomerId = customer.stripe_customer_id;
  if (!stripeCustomerId) {
    const sc = await stripe.customers.create({ name: customer.name, email: customer.email || undefined, phone: customer.phone || undefined, metadata: { customerId: customer.id } });
    stripeCustomerId = sc.id;
    await q('UPDATE customers SET stripe_customer_id=$2,updated_at=NOW() WHERE id=$1', [customer.id, stripeCustomerId]);
  }
  const rawBase = PUBLIC_URL || appUrl(req);
  const base = rawBase.endsWith('/') ? rawBase.slice(0, -1) : rawBase;
  const annual = billing === 'annual';
  const description = pkg === 'personalizzato' && req.body.custom_summary ? String(req.body.custom_summary).slice(0, 450) : (annual ? 'Pagamento annuale piano Home Care' : 'Abbonamento mensile Home Care');
  const priceData = annual
    ? { currency: 'eur', unit_amount: monthlyCents * 12, product_data: { name: 'Home Care annuale - ' + (cfg.label || pkg), description } }
    : { currency: 'eur', unit_amount: monthlyCents, recurring: { interval: 'month' }, product_data: { name: 'Home Care - ' + (cfg.label || pkg), description } };
  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: annual ? 'payment' : 'subscription',
    line_items: [{ quantity: 1, price_data: priceData }],
    success_url: base + (annual ? '/?annual=success' : '/?subscription=success'),
    cancel_url: base + '/?payment=cancel',
    metadata: { kind: annual ? 'plan_annual' : 'plan_subscription', customerId: customer.id, packageType: pkg, monthlyCents: String(monthlyCents) },
  });
  res.json({ url: session.url, billing, amount_cents: annual ? monthlyCents * 12 : monthlyCents, package_type: pkg });
});

`;
    const marker = "app.get('/api/client/messages', auth(), clientOnly, async (req, res) => {";
    if (!code.includes(marker)) throw new Error('Marker client messages non trovato');
    code = code.replace(marker, route + marker);
  }

  fs.writeFileSync(serverPath, code);
}

try {
  patchIndex();
  patchServer();
  console.log('Patch pagamenti piano e date V2 applicata.');
} catch (error) {
  console.warn('Patch pagamenti piano e date V2 non applicata:', error.message);
}
