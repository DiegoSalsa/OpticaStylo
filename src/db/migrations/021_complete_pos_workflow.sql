-- Completar el POS presencial sobre las capacidades comerciales ya desplegadas.
INSERT INTO permissions (code, description) VALUES
  ('sales.discounts_authorize', 'Autorizar descuentos en ventas presenciales.'),
  ('sales.reports_read', 'Consultar reportes operativos de ventas.');

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM (
  VALUES
    ('ADMIN', 'sales.discounts_authorize'),
    ('ADMIN', 'sales.reports_read'),
    ('SALES', 'patients.read_basic'),
    ('SALES', 'patients.manage_basic'),
    ('SALES', 'sales.reports_read')
) AS policy(role_code, permission_code)
JOIN roles ON roles.code = policy.role_code
JOIN permissions ON permissions.code = policy.permission_code;

ALTER TABLE external_prescriptions
  ADD COLUMN patient_id UUID REFERENCES patients(id) ON DELETE RESTRICT;

CREATE INDEX external_prescriptions_patient_date_index
  ON external_prescriptions (patient_id, created_at DESC)
  WHERE patient_id IS NOT NULL;

ALTER TABLE sales
  ADD COLUMN patient_id UUID REFERENCES patients(id) ON DELETE RESTRICT,
  ADD COLUMN discount_authorized_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN discount_authorized_at TIMESTAMPTZ,
  ADD COLUMN quotation_valid_until TIMESTAMPTZ;

UPDATE sales
SET
  discount_authorized_by = created_by,
  discount_authorized_at = created_at
WHERE discount_cents > 0 AND created_by IS NOT NULL;

UPDATE sales
SET quotation_valid_until = created_at + INTERVAL '30 days'
WHERE status = 'QUOTATION';

ALTER TABLE sales
  DROP CONSTRAINT sales_total_consistency,
  ADD CONSTRAINT sales_total_consistency CHECK (
    total_cents = subtotal_cents + shipping_fee_cents - discount_cents
  ),
  ADD CONSTRAINT sales_discount_authorization_consistency CHECK (
    (
      discount_cents = 0
      AND discount_authorized_by IS NULL
      AND discount_authorized_at IS NULL
    )
    OR (
      discount_cents > 0
      AND discount_authorized_by IS NOT NULL
      AND discount_authorized_at IS NOT NULL
    )
  );

CREATE INDEX sales_patient_date_index
  ON sales (patient_id, created_at DESC)
  WHERE patient_id IS NOT NULL;

CREATE TABLE sale_optical_additions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  name VARCHAR(160) NOT NULL,
  description VARCHAR(500),
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 50),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 100),
  unit_price_cents BIGINT NOT NULL CHECK (unit_price_cents > 0),
  line_total_cents BIGINT GENERATED ALWAYS AS (quantity * unit_price_cents) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT sale_optical_additions_name CHECK (name = btrim(name) AND name <> ''),
  CONSTRAINT sale_optical_additions_description CHECK (
    description IS NULL OR (description = btrim(description) AND description <> '')
  ),
  CONSTRAINT sale_optical_additions_position_unique UNIQUE (sale_id, position)
);

CREATE INDEX sale_optical_additions_sale_index
  ON sale_optical_additions (sale_id, position);

CREATE TABLE sale_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  sale_id UUID NOT NULL UNIQUE REFERENCES sales(id) ON DELETE RESTRICT,
  payload JSONB NOT NULL,
  emailed_to VARCHAR(254),
  email_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  email_provider_id VARCHAR(200),
  email_error VARCHAR(500),
  generated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  email_updated_at TIMESTAMPTZ,
  CONSTRAINT sale_receipts_email_status CHECK (
    email_status IN ('PENDING', 'SENT', 'FAILED', 'SIMULATED')
  ),
  CONSTRAINT sale_receipts_email_normalized CHECK (
    emailed_to IS NULL OR (emailed_to = lower(btrim(emailed_to)) AND emailed_to <> '')
  )
);

CREATE INDEX sale_receipts_issued_at_index ON sale_receipts (issued_at DESC);

ALTER TABLE sale_events
  DROP CONSTRAINT sale_events_type,
  ADD CONSTRAINT sale_events_type CHECK (
    event_type IN (
      'CREATED', 'UPDATED', 'STATUS_CHANGED', 'PAYMENT_REGISTERED',
      'PAYMENT_STATUS_CHANGED', 'DISCOUNT_AUTHORIZED', 'RECEIPT_ISSUED',
      'EMAIL_SENT', 'EMAIL_FAILED', 'CANCELLED'
    )
  );
