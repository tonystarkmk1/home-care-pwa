'use strict';

require('dotenv').config();

const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} deve essere configurata`);
  return value;
}

async function main() {
  const databaseUrl = required('DATABASE_URL');
  const email = required('ADMIN_EMAIL').toLowerCase();
  const password = required('ADMIN_PASSWORD');
  const name = String(process.env.ADMIN_NAME || 'Admin Home Care').trim();

  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('ADMIN_EMAIL non valida');
  if (password.length < 12) throw new Error('ADMIN_PASSWORD deve contenere almeno 12 caratteri');

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = (await client.query('SELECT id FROM users WHERE LOWER(email)=LOWER($1)', [email])).rows[0];
    if (!existing) {
      const passwordHash = await bcrypt.hash(password, 12);
      await client.query(
        `INSERT INTO users(name,email,password_hash,role,email_confirmed)
         VALUES($1,$2,$3,'admin',TRUE)`,
        [name, email, passwordHash]
      );
      console.log(`Admin creato: ${email}`);
    } else if (process.env.RESET_ADMIN_PASSWORD === 'true') {
      const passwordHash = await bcrypt.hash(password, 12);
      await client.query(
        `UPDATE users
            SET name=$2,password_hash=$3,role='admin',email_confirmed=TRUE,token_version=token_version+1,updated_at=NOW()
          WHERE id=$1`,
        [existing.id, name, passwordHash]
      );
      console.log(`Admin aggiornato e password reimpostata: ${email}`);
    } else {
      await client.query(
        `UPDATE users SET name=$2,role='admin',email_confirmed=TRUE,updated_at=NOW() WHERE id=$1`,
        [existing.id, name]
      );
      console.log(`Admin già presente: ${email}. Password non modificata.`);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => null);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Errore seed database:', error);
  process.exit(1);
});
