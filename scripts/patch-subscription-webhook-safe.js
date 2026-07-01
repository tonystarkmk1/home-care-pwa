const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server3.js');
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
      if (session.metadata && session.metadata.kind === 'subscription' && session.metadata.customerId) {
        await q("UPDATE customers SET payment_status='paid',paid_until=NULL,stripe_customer_id=COALESCE(stripe_customer_id,$2),stripe_subscription_id=COALESCE(stripe_subscription_id,$3),updated_at=NOW() WHERE id=$1", [session.metadata.customerId, session.customer, session.subscription]);
      }
      if (session.metadata && session.metadata.kind === 'annual_property_payment' && session.metadata.customerId) {
        await q("UPDATE customers SET payment_status='paid',paid_until=(CURRENT_DATE + INTERVAL '1 year')::date,stripe_customer_id=COALESCE(stripe_customer_id,$2),updated_at=NOW() WHERE id=$1", [session.metadata.customerId, session.customer]);
      }
      if (session.metadata && session.metadata.kind === 'extra_payment' && session.metadata.extraPaymentId) {
        await q("UPDATE extra_payments SET status='paid',paid_at=NOW(),updated_at=NOW() WHERE id=$1", [session.metadata.extraPaymentId]);
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

if (!code.includes(oldWebhook)) {
  console.warn('Webhook Stripe non trovato o già aggiornato.');
} else {
  code = code.replace(oldWebhook, newWebhook);
  console.log('Webhook Stripe aggiornato per abbonamenti mensili e pagamenti annuali.');
}

fs.writeFileSync(serverPath, code);
