ALTER TABLE accounts ADD COLUMN paid_at timestamptz;
ALTER TABLE accounts ADD COLUMN payment_cash bigint CHECK (payment_cash BETWEEN 0 AND 9000000000000);
ALTER TABLE accounts ADD COLUMN payment_sinpe bigint CHECK (payment_sinpe BETWEEN 0 AND 9000000000000);
ALTER TABLE accounts ADD COLUMN payment_card bigint CHECK (payment_card BETWEEN 0 AND 9000000000000);
-- Preserve what was actually recorded. Older accounts without cash data remain unclassified.
UPDATE accounts SET paid_at=closed_at,
 payment_cash=cash_received-cash_change,
 payment_sinpe=CASE WHEN cash_received IS NOT NULL THEN 0 END,
 payment_card=CASE WHEN cash_received IS NOT NULL THEN 0 END
WHERE closed_at IS NOT NULL;
ALTER TABLE accounts ADD CONSTRAINT complete_payment CHECK (
 (payment_cash IS NULL AND payment_sinpe IS NULL AND payment_card IS NULL) OR
 (payment_cash IS NOT NULL AND payment_sinpe IS NOT NULL AND payment_card IS NOT NULL AND paid_at IS NOT NULL));
CREATE INDEX accounts_paid ON accounts(paid_at) WHERE paid_at IS NOT NULL;
CREATE TABLE register_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK (id),
 day_start time NOT NULL DEFAULT '00:00',
 opening_default bigint CHECK (opening_default BETWEEN 0 AND 9000000000000)
);
INSERT INTO register_settings(id) VALUES(true);
CREATE TABLE cash_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 occurred_at timestamptz NOT NULL,
 actor_id uuid NOT NULL REFERENCES users(id),
 method text NOT NULL CHECK (method IN ('cash','sinpe','card')),
 direction text NOT NULL CHECK (direction IN ('in','out')),
 amount bigint NOT NULL CHECK (amount BETWEEN 1 AND 9000000000000),
 currency text NOT NULL,
 reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
 reverses uuid UNIQUE REFERENCES cash_entries(id)
);
CREATE INDEX cash_entries_date ON cash_entries(occurred_at);
CREATE TRIGGER cash_entries_immutable BEFORE UPDATE OR DELETE ON cash_entries FOR EACH ROW EXECUTE FUNCTION immutable_history();
CREATE TABLE cash_closings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 actor_id uuid NOT NULL REFERENCES users(id),
 period_from timestamptz NOT NULL,
 period_to timestamptz NOT NULL CHECK (period_to > period_from),
 currency text NOT NULL,
 snapshot jsonb NOT NULL,
 count jsonb NOT NULL,
 opening bigint NOT NULL CHECK (opening BETWEEN 0 AND 9000000000000),
 actual_cash bigint NOT NULL,
 actual_sinpe bigint,
 actual_card bigint,
 expected_cash bigint NOT NULL,
 difference_cash bigint NOT NULL,
 note text NOT NULL,
 supersedes uuid REFERENCES cash_closings(id)
);
CREATE INDEX cash_closings_date ON cash_closings(created_at DESC);
CREATE TRIGGER cash_closings_immutable BEFORE UPDATE OR DELETE ON cash_closings FOR EACH ROW EXECUTE FUNCTION immutable_history();

ALTER TABLE audit ALTER COLUMN created_at SET DEFAULT clock_timestamp();
ALTER TABLE accounts ALTER COLUMN arrived_at SET DEFAULT clock_timestamp();

-- During a rolling deployment the previous server can still finish a cash sale.
CREATE FUNCTION capture_initial_payment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.closed_at IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.closed_at IS NULL) THEN
    NEW.paid_at := COALESCE(NEW.paid_at, clock_timestamp());
    IF NEW.payment_cash IS NULL AND NEW.cash_received IS NOT NULL THEN
      NEW.payment_cash := NEW.cash_received - NEW.cash_change;
      NEW.payment_sinpe := 0;
      NEW.payment_card := 0;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER initial_payment BEFORE INSERT OR UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION capture_initial_payment();
