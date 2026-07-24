require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL non configurata');
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  try {
    const schemaPath = path.join(__dirname, '..', 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(schema);
    await pool.query('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check');
    await pool.query("ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'helper', 'client'))");
    await pool.query('ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_package_type_check');

    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_code TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires_at TIMESTAMPTZ;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS current_package_type TEXT;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS custom_monthly_price_cents INTEGER;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS custom_plan_summary TEXT;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS current_custom_plan_id UUID;
      ALTER TABLE manual_payments ADD COLUMN IF NOT EXISTS package_type TEXT;
      ALTER TABLE properties ADD COLUMN IF NOT EXISTS request_status TEXT NOT NULL DEFAULT 'active';
      ALTER TABLE properties ADD COLUMN IF NOT EXISTS property_type TEXT;
      ALTER TABLE properties ADD COLUMN IF NOT EXISTS client_notes TEXT;
      ALTER TABLE properties ADD COLUMN IF NOT EXISTS requested_package_type TEXT;
      ALTER TABLE properties ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ;
      ALTER TABLE properties ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        customer_id UUID NOT NULL REFERENCES customers(id),
        sender_role TEXT NOT NULL CHECK (sender_role IN ('admin', 'client')),
        sender_name TEXT NOT NULL,
        body TEXT NOT NULL,
        read_by_admin BOOLEAN NOT NULL DEFAULT FALSE,
        read_by_client BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS contact_channels (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        label TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'altro',
        value TEXT NOT NULL,
        note TEXT,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS customer_custom_plans (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        services_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        base_price_cents INTEGER NOT NULL DEFAULT 0,
        services_total_cents INTEGER NOT NULL DEFAULT 0,
        subtotal_cents INTEGER NOT NULL DEFAULT 0,
        discount_type TEXT NOT NULL DEFAULT 'none',
        discount_value_cents INTEGER NOT NULL DEFAULT 0,
        discount_percent NUMERIC(7,2) NOT NULL DEFAULT 0,
        final_price_cents INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        activated_at TIMESTAMPTZ,
        archived_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_users_password_reset_code ON users(password_reset_code);
      CREATE INDEX IF NOT EXISTS idx_messages_customer_created ON messages(customer_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_contact_channels_active ON contact_channels(active, sort_order);
      CREATE INDEX IF NOT EXISTS idx_properties_request_status ON properties(request_status);
      CREATE INDEX IF NOT EXISTS idx_customers_current_package ON customers(current_package_type);
      CREATE INDEX IF NOT EXISTS idx_customers_current_custom_plan ON customers(current_custom_plan_id);
      CREATE INDEX IF NOT EXISTS idx_manual_payments_package ON manual_payments(package_type);
      CREATE INDEX IF NOT EXISTS idx_customer_custom_plans_customer ON customer_custom_plans(customer_id, status);
      CREATE INDEX IF NOT EXISTS idx_customer_custom_plans_property ON customer_custom_plans(property_id);
    `);

    console.log('Migrazione database completata.');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Errore migrazione database:', error);
  process.exit(1);
});