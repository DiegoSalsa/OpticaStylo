-- Crear clientes, catálogo comercial, ventas, abonos e historial de operaciones.
INSERT INTO permissions (code, description) VALUES
  ('customers.read', 'Consultar clientes comerciales.'),
  ('customers.manage', 'Crear y actualizar clientes comerciales.'),
  ('products.read', 'Consultar el catálogo de productos.'),
  ('products.manage', 'Crear y actualizar el catálogo y sus precios.'),
  ('sales.payments_register', 'Registrar abonos y pagos de ventas.');

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM (
  VALUES
    ('ADMIN', 'customers.read'),
    ('ADMIN', 'customers.manage'),
    ('ADMIN', 'products.read'),
    ('ADMIN', 'products.manage'),
    ('ADMIN', 'sales.payments_register'),
    ('SALES', 'customers.read'),
    ('SALES', 'customers.manage'),
    ('SALES', 'products.read'),
    ('SALES', 'sales.payments_register')
) AS policy(role_code, permission_code)
JOIN roles ON roles.code = policy.role_code
JOIN permissions ON permissions.code = policy.permission_code;

CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID UNIQUE REFERENCES patients(id) ON DELETE RESTRICT,
  rut VARCHAR(10) NOT NULL UNIQUE,
  first_names VARCHAR(150) NOT NULL,
  last_names VARCHAR(150) NOT NULL,
  phone VARCHAR(16) NOT NULL,
  email VARCHAR(254) NOT NULL,
  address VARCHAR(500) NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT customers_rut_format CHECK (rut ~ '^[0-9]{1,8}-[0-9K]$'),
  CONSTRAINT customers_names_normalized CHECK (
    first_names = btrim(first_names)
    AND first_names <> ''
    AND last_names = btrim(last_names)
    AND last_names <> ''
  ),
  CONSTRAINT customers_phone_format CHECK (phone ~ '^\+?[0-9]{8,15}$'),
  CONSTRAINT customers_email_normalized CHECK (
    email = lower(btrim(email)) AND email <> ''
  ),
  CONSTRAINT customers_address_normalized CHECK (
    address = btrim(address) AND address <> ''
  )
);

CREATE INDEX customers_name_index ON customers (last_names, first_names);
CREATE INDEX customers_email_index ON customers (email);

CREATE TRIGGER customers_set_updated_at
BEFORE UPDATE ON customers
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku VARCHAR(80) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  category VARCHAR(30) NOT NULL,
  requires_prescription BOOLEAN NOT NULL DEFAULT FALSE,
  unit_price_cents BIGINT NOT NULL CHECK (unit_price_cents > 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT products_sku_normalized CHECK (
    sku = upper(btrim(sku)) AND sku <> ''
  ),
  CONSTRAINT products_name_normalized CHECK (
    name = btrim(name) AND name <> ''
  ),
  CONSTRAINT products_category CHECK (
    category IN ('FRAME', 'PRESCRIPTION_LENS', 'OTHER')
  )
);

CREATE INDEX products_active_category_index
  ON products (is_active, category, name);

CREATE TRIGGER products_set_updated_at
BEFORE UPDATE ON products
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

CREATE TABLE product_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  event_type VARCHAR(20) NOT NULL,
  changed_fields TEXT[] NOT NULL DEFAULT '{}',
  performed_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT product_events_type CHECK (event_type IN ('CREATED', 'UPDATED'))
);

CREATE INDEX product_events_product_index
  ON product_events (product_id, created_at, id);

CREATE TABLE sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_number BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  prescription_id UUID REFERENCES optical_prescriptions(id) ON DELETE RESTRICT,
  status VARCHAR(30) NOT NULL DEFAULT 'QUOTATION',
  payment_method VARCHAR(30),
  subtotal_cents BIGINT NOT NULL CHECK (subtotal_cents > 0),
  total_cents BIGINT NOT NULL CHECK (total_cents > 0),
  cancellation_reason VARCHAR(500),
  cancelled_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT sales_status CHECK (
    status IN (
      'QUOTATION',
      'PENDING',
      'PAID',
      'IN_PREPARATION',
      'READY',
      'DELIVERED',
      'CANCELLED'
    )
  ),
  CONSTRAINT sales_payment_method CHECK (
    payment_method IS NULL
    OR payment_method IN (
      'CASH',
      'BANK_TRANSFER',
      'MERCADO_PAGO',
      'TRANSBANK',
      'GETNET'
    )
  ),
  CONSTRAINT sales_total_consistency CHECK (subtotal_cents = total_cents),
  CONSTRAINT sales_cancellation_consistency CHECK (
    (
      status = 'CANCELLED'
      AND cancelled_at IS NOT NULL
      AND cancellation_reason IS NOT NULL
      AND char_length(cancellation_reason) BETWEEN 1 AND 500
    )
    OR (
      status <> 'CANCELLED'
      AND cancelled_at IS NULL
      AND cancellation_reason IS NULL
    )
  )
);

CREATE INDEX sales_customer_date_index ON sales (customer_id, created_at DESC);
CREATE INDEX sales_status_date_index ON sales (status, created_at DESC);
CREATE INDEX sales_prescription_index
  ON sales (prescription_id)
  WHERE prescription_id IS NOT NULL;

CREATE TRIGGER sales_set_updated_at
BEFORE UPDATE ON sales
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

CREATE TABLE sale_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_sku VARCHAR(80) NOT NULL,
  product_name VARCHAR(200) NOT NULL,
  product_category VARCHAR(30) NOT NULL,
  requires_prescription BOOLEAN NOT NULL,
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 100),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 1000),
  unit_price_cents BIGINT NOT NULL CHECK (unit_price_cents > 0),
  line_total_cents BIGINT GENERATED ALWAYS AS (quantity * unit_price_cents) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT sale_items_product_unique UNIQUE (sale_id, product_id),
  CONSTRAINT sale_items_position_unique UNIQUE (sale_id, position)
);

CREATE INDEX sale_items_sale_index ON sale_items (sale_id, position);

CREATE TABLE sale_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  payment_method VARCHAR(30) NOT NULL,
  reference VARCHAR(200),
  received_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT sale_payments_method CHECK (
    payment_method IN (
      'CASH',
      'BANK_TRANSFER',
      'MERCADO_PAGO',
      'TRANSBANK',
      'GETNET'
    )
  ),
  CONSTRAINT sale_payments_reference_normalized CHECK (
    reference IS NULL
    OR (reference = btrim(reference) AND reference <> '')
  )
);

CREATE INDEX sale_payments_sale_index
  ON sale_payments (sale_id, paid_at, id);

CREATE TABLE sale_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  event_type VARCHAR(30) NOT NULL,
  previous_status VARCHAR(30),
  new_status VARCHAR(30),
  details TEXT,
  performed_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT sale_events_type CHECK (
    event_type IN (
      'CREATED',
      'UPDATED',
      'STATUS_CHANGED',
      'PAYMENT_REGISTERED',
      'CANCELLED'
    )
  )
);

CREATE INDEX sale_events_sale_index
  ON sale_events (sale_id, created_at, id);
