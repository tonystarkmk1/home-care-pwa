CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS plan_settings (
  id TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9_]+$'),
  label TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  price_label TEXT NOT NULL,
  features_json JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(features_json) = 'array'),
  days INTEGER NOT NULL DEFAULT 30 CHECK (days BETWEEN 1 AND 365),
  from_price BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  notes TEXT,
  current_package_type TEXT REFERENCES plan_settings(id) ON UPDATE CASCADE ON DELETE SET NULL,
  custom_monthly_price_cents INTEGER CHECK (custom_monthly_price_cents IS NULL OR custom_monthly_price_cents > 0),
  custom_plan_summary TEXT,
  current_custom_plan_id UUID,
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
  email TEXT NOT NULL,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'helper', 'client')) DEFAULT 'client',
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  email_confirmed BOOLEAN NOT NULL DEFAULT TRUE,
  email_confirm_code TEXT,
  email_confirm_expires_at TIMESTAMPTZ,
  password_reset_code TEXT,
  password_reset_expires_at TIMESTAMPTZ,
  token_version INTEGER NOT NULL DEFAULT 0,
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
  package_type TEXT NOT NULL REFERENCES plan_settings(id) ON UPDATE CASCADE,
  monthly_price_cents INTEGER NOT NULL CHECK (monthly_price_cents > 0),
  next_check_date DATE NOT NULL DEFAULT CURRENT_DATE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  request_status TEXT NOT NULL CHECK (request_status IN ('pending', 'approved', 'rejected')) DEFAULT 'approved',
  property_type TEXT,
  client_notes TEXT,
  requested_package_type TEXT,
  requested_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
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
  checklist_json JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(checklist_json) = 'array'),
  photo_urls JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(photo_urls) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS check_photos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  check_id UUID NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  original_name TEXT,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 8388608),
  sha256 TEXT NOT NULL,
  image_data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
  amount_cents INTEGER CHECK (amount_cents IS NULL OR amount_cents > 0),
  package_type TEXT REFERENCES plan_settings(id) ON UPDATE CASCADE ON DELETE SET NULL,
  method TEXT NOT NULL DEFAULT 'contanti',
  description TEXT,
  paid_until DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
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
  services_json JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(services_json) = 'array'),
  base_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (base_price_cents >= 0),
  services_total_cents INTEGER NOT NULL DEFAULT 0 CHECK (services_total_cents >= 0),
  subtotal_cents INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  discount_type TEXT NOT NULL DEFAULT 'none' CHECK (discount_type IN ('none', 'amount', 'percent')),
  discount_value_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_value_cents >= 0),
  discount_percent NUMERIC(7,2) NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100),
  final_price_cents INTEGER NOT NULL CHECK (final_price_cents > 0),
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  activated_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stripe_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_customer_id ON users(customer_id);
CREATE INDEX IF NOT EXISTS idx_users_email_confirm_code ON users(email_confirm_code);
CREATE INDEX IF NOT EXISTS idx_users_password_reset_code ON users(password_reset_code);
CREATE INDEX IF NOT EXISTS idx_customers_current_package ON customers(current_package_type);
CREATE INDEX IF NOT EXISTS idx_customers_stripe_customer ON customers(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_properties_customer_id ON properties(customer_id);
CREATE INDEX IF NOT EXISTS idx_properties_next_check ON properties(next_check_date);
CREATE INDEX IF NOT EXISTS idx_properties_request_status ON properties(request_status);
CREATE INDEX IF NOT EXISTS idx_checks_property_id ON checks(property_id);
CREATE INDEX IF NOT EXISTS idx_check_photos_check ON check_photos(check_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due_status ON tasks(status, due_date);
CREATE INDEX IF NOT EXISTS idx_extra_payments_customer_status ON extra_payments(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_manual_payments_customer_id ON manual_payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_messages_customer_created ON messages(customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_contact_channels_active ON contact_channels(active, sort_order);
CREATE INDEX IF NOT EXISTS idx_customer_custom_plans_customer ON customer_custom_plans(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_customer_custom_plans_property ON customer_custom_plans(property_id);
INSERT INTO plan_settings(id,label,price_cents,price_label,features_json,days,from_price,active,sort_order)
VALUES
  ('base','Base',3900,'39 €/mese','["1 controllo completo al mese","Verifica accessi, porte e finestre","Controllo generale interno ed esterno","Report fotografico dopo ogni visita"]'::jsonb,30,FALSE,TRUE,10),
  ('comfort','Comfort',7900,'79 €/mese','["2 controlli completi al mese","Aerazione ambienti","Verifica visiva degli impianti accessibili","Ritiro posta o piccole consegne","Report fotografico"]'::jsonb,15,FALSE,TRUE,20),
  ('premium','Premium',19900,'199 €/mese','["Controllo settimanale","Preparazione casa con almeno 15 giorni di preavviso","Verifiche periodiche approfondite","Report fotografico dettagliato","Priorità nella pianificazione"]'::jsonb,7,FALSE,TRUE,30),
  ('villa_giardino','Villa & Giardino',30000,'da 300 €/mese','["Tutto il servizio Premium","Verifica delle aree esterne","Cura ordinaria del giardino","Verifica irrigazione, cancelli e recinzioni","Report fotografico dettagliato"]'::jsonb,7,TRUE,TRUE,40),
  ('personalizzato','Personalizzato',3900,'da 39 €/mese','["Base obbligatorio con 1 controllo mensile","Servizi aggiuntivi scelti con Home Care","Prezzo definitivo confermato prima del pagamento"]'::jsonb,30,TRUE,TRUE,50),
  ('localita_limitrofe','Località Limitrofe (legacy)',15000,'da 150 €/mese','["Piano storico mantenuto solo per migrazione"]'::jsonb,30,TRUE,FALSE,90)
ON CONFLICT (id) DO NOTHING;
