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

    await pool.query(`
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS current_package_type TEXT;
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

      CREATE INDEX IF NOT EXISTS idx_messages_customer_created ON messages(customer_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_properties_request_status ON properties(request_status);
      CREATE INDEX IF NOT EXISTS idx_customers_current_package ON customers(current_package_type);
      CREATE INDEX IF NOT EXISTS idx_manual_payments_package ON manual_payments(package_type);
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
