-- Permitir que una venta en línea se origine sin un usuario interno.
ALTER TABLE sales
  ALTER COLUMN created_by DROP NOT NULL,
  ALTER COLUMN updated_by DROP NOT NULL;
