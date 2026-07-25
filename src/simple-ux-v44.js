'use strict';

function installSimpleUxV44(dependencies) {
  const {
    app, q, transaction, auth, role, asyncHandler, text, HttpError,
  } = dependencies;

  if (!app || !q || !transaction || !auth || !role || !asyncHandler || !text || !HttpError) {
    throw new Error('Dipendenze simple-ux-v44 incomplete');
  }

  app.post('/api/client/plan-selection', auth(), role('client'), asyncHandler(async (req, res) => {
    const packageType = text(req.body.package_type, {
      name: 'Piano',
      required: true,
      max: 60,
    });

    const result = await transaction(async (client) => {
      const plan = (await q(
        `SELECT id,label,price_cents,price_label,features_json,from_price
           FROM plan_settings
          WHERE id=$1 AND active=TRUE`,
        [packageType],
        client
      )).rows[0];
      if (!plan) throw new HttpError(400, 'Piano non disponibile', 'PLAN_INVALID');

      const customer = (await q(
        `SELECT c.*,
                EXISTS(
                  SELECT 1 FROM properties p
                   WHERE p.customer_id=c.id
                     AND p.active=TRUE
                     AND p.request_status='approved'
                ) AS has_approved_property,
                EXISTS(
                  SELECT 1 FROM customer_custom_plans cp
                   WHERE cp.customer_id=c.id AND cp.status='active'
                ) AS has_active_custom_plan
           FROM customers c
          WHERE c.id=$1
          FOR UPDATE OF c`,
        [req.user.customer_id],
        client
      )).rows[0];
      if (!customer) throw new HttpError(404, 'Profilo cliente non trovato', 'NOT_FOUND');

      const changingPlan = Boolean(customer.current_package_type && customer.current_package_type !== plan.id);
      const serviceAlreadyConfigured = Boolean(
        customer.has_approved_property
        || customer.has_active_custom_plan
        || customer.payment_status === 'paid'
      );
      if (changingPlan && serviceAlreadyConfigured) {
        throw new HttpError(
          409,
          'Per cambiare un piano già attivo contatta Home Care: verificheremo insieme prezzo e servizi.',
          'PLAN_CHANGE_REQUIRES_ADMIN'
        );
      }

      const updated = (await q(
        `UPDATE customers
            SET current_package_type=$2,
                current_custom_plan_id=CASE WHEN $2='personalizzato' THEN current_custom_plan_id ELSE NULL END,
                custom_monthly_price_cents=CASE WHEN $2='personalizzato' THEN custom_monthly_price_cents ELSE NULL END,
                custom_plan_summary=CASE WHEN $2='personalizzato' THEN custom_plan_summary ELSE NULL END,
                updated_at=NOW()
          WHERE id=$1
          RETURNING *`,
        [customer.id, plan.id],
        client
      )).rows[0];

      await q(
        `INSERT INTO notifications(user_id,kind,title,body,link_tab,dedupe_key)
         SELECT u.id,'plan','Piano scelto dal cliente',$1,'customers',$2
           FROM users u
          WHERE u.role='admin'
         ON CONFLICT (user_id,dedupe_key) DO NOTHING`,
        [
          `${updated.name} ha scelto il piano ${plan.label}.`,
          `client-plan-selection:${updated.id}:${plan.id}`,
        ],
        client
      );

      return {
        customer: updated,
        plan: {
          id: plan.id,
          label: plan.label,
          price_cents: Number(plan.price_cents),
          price_label: plan.price_label,
          features: Array.isArray(plan.features_json) ? plan.features_json : [],
          from_price: Boolean(plan.from_price),
        },
      };
    });

    res.json(result);
  }));
}

module.exports = { installSimpleUxV44 };
