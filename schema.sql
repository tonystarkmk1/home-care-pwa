CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  notes TEXT,
  payment_status TEXT NOT NULL CHECK (payment_status IN ('paid', 'unpaid', 'past_due', 'canceled')) DEFAULT 'unpaid',
  paid_until DATE,
  manual_payment_note TEXT,
  last_manual_payment_at TIMESTAMPTZ,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'helper', 'client')) DEFAULT 'client',
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  email_confirmed BOOLEAN NOT NULL DEFAULT TRUE,
  email_confirm_code TEXT,
  email_confirm_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS properties (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  city TEXT DEFAULT 'Badesi',
  zone TEXT,
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  package_type TEXT NOT NULL CHECK (package_type IN ('base', 'comfort', 'premium', 'villa_giardino', 'localita_limitrofe')) DEFAULT 'base',
  monthly_price_cents INTEGER NOT NULL DEFAULT 3900,
  next_check_date DATE NOT NULL DEFAULT CURRENT_DATE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS checks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  due_date DATE NOT NULL DEFAULT CURRENT_DATE,
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('scheduled', 'done', 'skipped')) DEFAULT 'scheduled',
  notes TEXT,
  checklist_json JSONB DEFAULT '[]'::jsonb,
  photo_urls JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  property_id UUID REFERENCES properties(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'controllo',
  priority TEXT NOT NULL CHECK (priority IN ('bassa', 'normale', 'alta')) DEFAULT 'normale',
  status TEXT NOT NULL CHECK (status IN ('todo', 'done', 'blocked')) DEFAULT 'todo',
  due_date DATE DEFAULT CURRENT_DATE,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS extra_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'canceled')) DEFAULT 'pending',
  stripe_session_id TEXT,
  payment_url TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS manual_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  amount_cents INTEGER,
  method TEXT NOT NULL DEFAULT 'contanti',
  description TEXT,
  paid_until DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE customers ADD COLUMN IF NOT EXISTS paid_until DATE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS manual_payment_note TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_manual_payment_at TIMESTAMPTZ;

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_confirmed BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_confirm_code TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_confirm_expires_at TIMESTAMPTZ;
UPDATE users SET email_confirmed = TRUE WHERE role IN ('admin', 'helper') AND email_confirmed IS DISTINCT FROM TRUE;

CREATE INDEX IF NOT EXISTS idx_users_customer_id ON users(customer_id);
CREATE INDEX IF NOT EXISTS idx_users_email_confirm_code ON users(email_confirm_code);
CREATE INDEX IF NOT EXISTS idx_properties_customer_id ON properties(customer_id);
CREATE INDEX IF NOT EXISTS idx_properties_next_check ON properties(next_check_date);
CREATE INDEX IF NOT EXISTS idx_checks_property_id ON checks(property_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due_status ON tasks(status, due_date);
CREATE INDEX IF NOT EXISTS idx_extra_payments_customer_status ON extra_payments(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_manual_payments_customer_id ON manual_payments(customer_id);
