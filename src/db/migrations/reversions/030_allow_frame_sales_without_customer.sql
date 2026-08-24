DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM sales WHERE customer_id IS NULL) THEN
    RAISE EXCEPTION 'No se puede revertir la migración mientras existan ventas sin cliente registrado.';
  END IF;
END $$;

ALTER TABLE sales
  ALTER COLUMN customer_id SET NOT NULL;
