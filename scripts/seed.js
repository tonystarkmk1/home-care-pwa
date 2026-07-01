require('dotenv').config();

const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL non configurata');
  }
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
    throw new Error('ADMIN_EMAIL e ADMIN_PASSWORD devono essere configurati su Render');
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  try {
    const name = process.env.ADMIN_NAME || 'Admin Home Care';
    const email = process.env.ADMIN_EMAIL.toLowerCase().trim();
    const passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);

    await pool.query(
      `INSERT INTO users (name, email, password_hash, role, email_confirmed)
       VALUES ($1, $2, $3, 'admin', TRUE)
       ON CONFLICT (email) DO UPDATE SET
         name = EXCLUDED.name,
         password_hash = EXCLUDED.password_hash,
         role = 'admin',
         email_confirmed = TRUE,
         updated_at = NOW()`,
      [name, email, passwordHash]
    );

    console.log(`Admin iniziale pronto: ${email}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Errore seed database:', error);
  process.exit(1);
});
