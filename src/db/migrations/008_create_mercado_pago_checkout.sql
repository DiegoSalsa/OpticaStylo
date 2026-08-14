-- Integrar Checkout Pro mediante intentos idempotentes y webhooks auditables.
INSERT INTO permissions (code, description) VALUES
  ('sales.mercado_pago_checkout', 'Crear cobros de Checkout Pro para ventas pendientes.');

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM (
  VALUES
    ('ADMIN', 'sales.mercado_pago_checkout'),
    ('SALES', 'sales.mercado_pago_checkout')
) AS policy(role_code, permission_code)
JOIN roles ON roles.code = policy.role_code
JOIN permissions ON permissions.code = policy.permission_code;

CREATE TABLE payment_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  provider VARCHAR(30) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'CREATED',
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'CLP',
  idempotency_key UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  external_preference_id VARCHAR(200) UNIQUE,
  external_payment_id VARCHAR(200) UNIQUE,
  checkout_url TEXT,
  sandbox_checkout_url TEXT,
  provider_status VARCHAR(100),
  provider_status_detail VARCHAR(200),
  failure_reason VARCHAR(500),
  initiated_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT payment_attempts_provider CHECK (provider IN ('MERCADO_PAGO')),
  CONSTRAINT payment_attempts_status CHECK (
    status IN (
      'CREATED',
      'PENDING',
      'APPROVED',
      'REJECTED',
      'CANCELLED',
      'FAILED',
      'REQUIRES_REVIEW'
    )
  ),
  CONSTRAINT payment_attempts_currency CHECK (currency = 'CLP'),
  CONSTRAINT payment_attempts_external_data CHECK (
    (
      external_preference_id IS NULL
      AND checkout_url IS NULL
      AND sandbox_checkout_url IS NULL
    )
    OR (
      external_preference_id IS NOT NULL
      AND checkout_url IS NOT NULL
    )
  ),
  CONSTRAINT payment_attempts_expiration CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX payment_attempts_active_sale_provider_index
  ON payment_attempts (sale_id, provider)
  WHERE status IN ('CREATED', 'PENDING', 'APPROVED');

CREATE INDEX payment_attempts_sale_date_index
  ON payment_attempts (sale_id, created_at DESC);

CREATE TRIGGER payment_attempts_set_updated_at
BEFORE UPDATE ON payment_attempts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

ALTER TABLE sale_payments
  ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN provider_attempt_id UUID UNIQUE
    REFERENCES payment_attempts(id) ON DELETE RESTRICT,
  ALTER COLUMN received_by DROP NOT NULL,
  ADD CONSTRAINT sale_payments_source CHECK (source IN ('MANUAL', 'PROVIDER')),
  ADD CONSTRAINT sale_payments_source_consistency CHECK (
    (source = 'MANUAL' AND provider_attempt_id IS NULL AND received_by IS NOT NULL)
    OR (source = 'PROVIDER' AND provider_attempt_id IS NOT NULL)
  );

ALTER TABLE sale_events
  ALTER COLUMN performed_by DROP NOT NULL,
  DROP CONSTRAINT sale_events_type,
  ADD CONSTRAINT sale_events_type CHECK (
    event_type IN (
      'CREATED',
      'UPDATED',
      'STATUS_CHANGED',
      'PAYMENT_REGISTERED',
      'PAYMENT_STATUS_CHANGED',
      'CANCELLED'
    )
  );

CREATE TABLE payment_provider_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider VARCHAR(30) NOT NULL,
  request_id VARCHAR(200) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  external_object_id VARCHAR(200) NOT NULL,
  payload JSONB NOT NULL,
  processing_status VARCHAR(20) NOT NULL DEFAULT 'RECEIVED',
  processing_error VARCHAR(500),
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMPTZ,
  CONSTRAINT payment_provider_events_provider CHECK (provider IN ('MERCADO_PAGO')),
  CONSTRAINT payment_provider_events_processing_status CHECK (
    processing_status IN ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED')
  ),
  CONSTRAINT payment_provider_events_request_unique UNIQUE (provider, request_id)
);

CREATE INDEX payment_provider_events_object_index
  ON payment_provider_events (provider, external_object_id, received_at DESC);
