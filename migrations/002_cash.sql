ALTER TABLE accounts ADD COLUMN cash_received bigint CHECK (cash_received BETWEEN 0 AND 9000000000000);
ALTER TABLE accounts ADD COLUMN cash_change bigint CHECK (cash_change BETWEEN 0 AND 9000000000000);
ALTER TABLE accounts ADD CONSTRAINT cash_complete CHECK (
  (cash_received IS NULL AND cash_change IS NULL) OR
  (closed_at IS NOT NULL AND cash_received IS NOT NULL AND cash_change IS NOT NULL AND cash_received >= cash_change)
);
CREATE INDEX accounts_sales_date ON accounts(closed_at, closed_by) WHERE closed_at IS NOT NULL;
CREATE INDEX audit_actor_date ON audit(actor_id, created_at DESC);
CREATE INDEX moves_actor_date ON stock_moves(actor_id, created_at DESC);
