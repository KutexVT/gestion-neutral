CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_.-]{3,40}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'waiter')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  csrf text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE login_attempts (
  key text PRIMARY KEY,
  count int NOT NULL,
  window_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bytes bytea NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  photo_id uuid NOT NULL REFERENCES photos(id),
  price int NOT NULL CHECK (price BETWEEN 0 AND 1000000000),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  stock int NOT NULL CHECK (stock BETWEEN 0 AND 1000000),
  active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('customer', 'personal')),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  created_by uuid NOT NULL REFERENCES users(id),
  arrived_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  closed_by uuid REFERENCES users(id),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  calculated_total bigint NOT NULL DEFAULT 0 CHECK (calculated_total BETWEEN 0 AND 9000000000000),
  final_total bigint CHECK (final_total BETWEEN 0 AND 9000000000000),
  adjusted_by uuid REFERENCES users(id),
  version int NOT NULL DEFAULT 1,
  CHECK (closed_at IS NULL OR (kind = 'customer' AND closed_at >= arrived_at AND final_total IS NOT NULL)),
  CHECK (closed_at IS NOT NULL OR final_total IS NULL)
);
CREATE UNIQUE INDEX personal_account ON accounts(created_by) WHERE kind = 'personal';
CREATE INDEX accounts_created ON accounts(created_by, arrived_at DESC);
CREATE INDEX accounts_status ON accounts(closed_at, kind);
CREATE TABLE consumption (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  product_id uuid NOT NULL REFERENCES products(id),
  product_name text NOT NULL,
  unit_price int NOT NULL CHECK (unit_price BETWEEN 0 AND 1000000000),
  quantity int NOT NULL CHECK (quantity BETWEEN 0 AND 100000),
  recorded_by uuid NOT NULL REFERENCES users(id),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consumption_account ON consumption(account_id);
CREATE TABLE stock_moves (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES products(id),
  account_id uuid REFERENCES accounts(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  delta int NOT NULL,
  stock_before int NOT NULL,
  stock_after int NOT NULL CHECK (stock_after >= 0),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (stock_after = stock_before + delta)
);
CREATE TABLE invoices (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  revision int NOT NULL,
  snapshot jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, revision)
);
CREATE TABLE audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL,
  entity_id uuid,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_date ON audit(created_at DESC, id DESC);
CREATE TABLE operations (
  actor_id uuid NOT NULL REFERENCES users(id),
  key uuid NOT NULL,
  fingerprint text NOT NULL,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, key)
);
CREATE FUNCTION immutable_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'El historial es inmutable'; END;
$$;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON audit FOR EACH ROW EXECUTE FUNCTION immutable_history();
CREATE TRIGGER invoice_immutable BEFORE UPDATE OR DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION immutable_history();
CREATE TRIGGER moves_immutable BEFORE UPDATE OR DELETE ON stock_moves FOR EACH ROW EXECUTE FUNCTION immutable_history();
