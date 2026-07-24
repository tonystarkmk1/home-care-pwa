'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function poolOptions() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL non configurata');
  return {
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  };
}

async function main() {
  const pool = new Pool(poolOptions());
  const client = await pool.connect();
  try {
    const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
    await client.query(schema);

    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_code TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires_at TIMESTAMPTZ;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

      ALTER TABLE customers ADD COLUMN IF NOT EXISTS current_package_type TEXT;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS custom_monthly_price_cents INTEGER;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS custom_plan_summary TEXT;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS current_custom_plan_id UUID;

      ALTER TABLE manual_payments ADD COLUMN IF NOT EXISTS package_type TEXT;

      ALTER TABLE properties ADD COLUMN IF NOT EXISTS request_status TEXT NOT NULL DEFAULT 'approved';
      ALTER TABLE properties ADD COLUMN IF NOT EXISTS property_type TEXT;
      ALTER TABLE properties ADD COLUMN IF NOT EXISTS client_notes TEXT;
      ALTER TABLE properties ADD COLUMN IF NOT EXISTS requested_package_type TEXT;
      ALTER TABLE properties ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ;
      ALTER TABLE properties ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
      ALTER TABLE properties ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;
    `);

    await client.query(`
      UPDATE properties SET request_status='approved' WHERE request_status IS NULL OR request_status='active';
      UPDATE properties SET request_status='rejected' WHERE request_status NOT IN ('pending','approved','rejected');

      UPDATE customers SET current_package_type='personalizzato' WHERE current_package_type='localita_limitrofe';
      UPDATE properties SET package_type='personalizzato' WHERE package_type='localita_limitrofe';
      UPDATE manual_payments SET package_type='personalizzato' WHERE package_type='localita_limitrofe';

      UPDATE customers c
         SET current_package_type=NULL
       WHERE current_package_type IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM plan_settings p WHERE p.id=c.current_package_type);

      UPDATE properties p
         SET package_type='base', monthly_price_cents=COALESCE(NULLIF(monthly_price_cents,0),3900)
       WHERE NOT EXISTS (SELECT 1 FROM plan_settings ps WHERE ps.id=p.package_type);

      UPDATE manual_payments m
         SET package_type=NULL
       WHERE package_type IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM plan_settings p WHERE p.id=m.package_type);
    `);

    await client.query(`
      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
      ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','helper','client'));

      ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_package_type_check;
      ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_request_status_check;
      ALTER TABLE properties ADD CONSTRAINT properties_request_status_check CHECK (request_status IN ('pending','approved','rejected'));

      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_customer_id_fkey;
      ALTER TABLE users ADD CONSTRAINT users_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;

      ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_customer_id_fkey;
      ALTER TABLE messages ADD CONSTRAINT messages_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;

      ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_current_package_type_fkey;
      ALTER TABLE customers ADD CONSTRAINT customers_current_package_type_fkey FOREIGN KEY (current_package_type) REFERENCES plan_settings(id) ON UPDATE CASCADE ON DELETE SET NULL;

      ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_package_type_fkey;
      ALTER TABLE properties ADD CONSTRAINT properties_package_type_fkey FOREIGN KEY (package_type) REFERENCES plan_settings(id) ON UPDATE CASCADE;

      ALTER TABLE manual_payments DROP CONSTRAINT IF EXISTS manual_payments_package_type_fkey;
      ALTER TABLE manual_payments ADD CONSTRAINT manual_payments_package_type_fkey FOREIGN KEY (package_type) REFERENCES plan_settings(id) ON UPDATE CASCADE ON DELETE SET NULL;
    `);

    await client.query(`
      WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY activated_at DESC NULLS LAST, created_at DESC, id DESC) AS rn
          FROM customer_custom_plans
         WHERE status='active'
      )
      UPDATE customer_custom_plans p
         SET status='draft', activated_at=NULL, updated_at=NOW()
        FROM ranked r
       WHERE p.id=r.id AND r.rn>1;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_custom_plan_per_customer
        ON customer_custom_plans(customer_id)
        WHERE status='active';
    `);

    await client.query(`
      ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_current_custom_plan_id_fkey;
      ALTER TABLE customers ADD CONSTRAINT customers_current_custom_plan_id_fkey
        FOREIGN KEY (current_custom_plan_id) REFERENCES customer_custom_plans(id) ON DELETE SET NULL;
    `);

    const duplicateEmails = await client.query(`
      SELECT LOWER(email) AS email, COUNT(*)::int AS count
        FROM users
       GROUP BY LOWER(email)
      HAVING COUNT(*) > 1
       LIMIT 10
    `);
    if (duplicateEmails.rows.length) {
      const examples = duplicateEmails.rows.map((row) => `${row.email} (${row.count})`).join(', ');
      throw new Error(`Email duplicate senza distinzione maiuscole/minuscole: ${examples}. Unisci gli account prima di continuare.`);
    }

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER(email));
      CREATE INDEX IF NOT EXISTS idx_users_password_reset_code ON users(password_reset_code);
      CREATE INDEX IF NOT EXISTS idx_customers_current_custom_plan ON customers(current_custom_plan_id);
      CREATE INDEX IF NOT EXISTS idx_check_photos_check ON check_photos(check_id);
      CREATE INDEX IF NOT EXISTS idx_customers_stripe_customer ON customers(stripe_customer_id);
    `);

    await client.query('COMMIT');
    console.log('Migrazione database completata e verificata.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => null);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Errore migrazione database:', error);
  process.exit(1);
});
