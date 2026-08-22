-- Agregar datos de prueba para validar el flujo completo de cristales en desarrollo.
ALTER TABLE products
  ADD COLUMN is_test_data BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX products_public_catalog_index
  ON products (is_active, is_test_data, category, name);

WITH administrador AS (
  SELECT users.id
  FROM users
  JOIN user_roles ON user_roles.user_id = users.id
  JOIN roles ON roles.id = user_roles.role_id
  WHERE users.is_active = TRUE AND roles.code = 'ADMIN'
  ORDER BY users.created_at
  LIMIT 1
),
productos_prueba (sku, name, price) AS (
  VALUES
    ('PRUEBA-CRISTAL-MONOF', 'Cristal monofocal de prueba', 19990::BIGINT),
    ('PRUEBA-CRISTAL-AZUL', 'Cristal con filtro azul de prueba', 29990::BIGINT),
    ('PRUEBA-CRISTAL-PROG', 'Cristal progresivo de prueba', 39990::BIGINT)
)
INSERT INTO products (
  sku,
  name,
  category,
  requires_prescription,
  unit_price_cents,
  is_active,
  is_test_data,
  created_by,
  updated_by
)
SELECT
  productos_prueba.sku,
  productos_prueba.name,
  'PRESCRIPTION_LENS',
  TRUE,
  productos_prueba.price,
  TRUE,
  TRUE,
  administrador.id,
  administrador.id
FROM productos_prueba
CROSS JOIN administrador
ON CONFLICT (sku) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  requires_prescription = EXCLUDED.requires_prescription,
  unit_price_cents = EXCLUDED.unit_price_cents,
  is_active = EXCLUDED.is_active,
  is_test_data = TRUE,
  updated_by = EXCLUDED.updated_by;
