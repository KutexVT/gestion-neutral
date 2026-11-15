ALTER TABLE products ADD COLUMN purchase_cost int CHECK (purchase_cost BETWEEN 0 AND 1000000000);
ALTER TABLE consumption ADD COLUMN unit_cost int CHECK (unit_cost BETWEEN 0 AND 1000000000);
-- Existing costs remain unknown. Current catalog costs cannot reconstruct past purchases.
CREATE FUNCTION capture_purchase_cost() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.unit_cost := (SELECT purchase_cost FROM products WHERE id=NEW.product_id);
  ELSIF NEW.unit_cost IS DISTINCT FROM OLD.unit_cost THEN
    RAISE EXCEPTION 'El costo registrado de una entrega no se puede cambiar';
  END IF;
  RETURN NEW;
END;
$$;
-- Also captures deliveries created by the previous server during a rolling deployment.
CREATE TRIGGER consumption_cost BEFORE INSERT OR UPDATE ON consumption FOR EACH ROW EXECUTE FUNCTION capture_purchase_cost();
