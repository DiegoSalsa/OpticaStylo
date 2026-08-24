ALTER TABLE customers
  ALTER COLUMN last_names DROP NOT NULL,
  ALTER COLUMN phone DROP NOT NULL,
  ALTER COLUMN email DROP NOT NULL,
  ALTER COLUMN address DROP NOT NULL,
  DROP CONSTRAINT customers_names_normalized,
  DROP CONSTRAINT customers_phone_format,
  DROP CONSTRAINT customers_email_normalized,
  DROP CONSTRAINT customers_address_normalized,
  ADD CONSTRAINT customers_names_normalized CHECK (
    first_names = btrim(first_names)
    AND first_names <> ''
    AND (
      last_names IS NULL
      OR (last_names = btrim(last_names) AND last_names <> '')
    )
  ),
  ADD CONSTRAINT customers_phone_format CHECK (
    phone IS NULL OR phone ~ '^\+?[0-9]{8,15}$'
  ),
  ADD CONSTRAINT customers_email_normalized CHECK (
    email IS NULL OR (email = lower(btrim(email)) AND email <> '')
  ),
  ADD CONSTRAINT customers_address_normalized CHECK (
    address IS NULL OR (address = btrim(address) AND address <> '')
  );

ALTER TABLE sales
  ADD COLUMN request_key VARCHAR(80),
  ADD CONSTRAINT sales_request_key_normalized CHECK (
    request_key IS NULL OR (request_key = btrim(request_key) AND request_key <> '')
  );

CREATE UNIQUE INDEX sales_actor_request_key_unique
  ON sales (created_by, request_key)
  WHERE request_key IS NOT NULL;

CREATE TABLE discount_authorization_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  authorized_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  reason VARCHAR(300) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  sale_id UUID REFERENCES sales(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT discount_authorization_grants_reason CHECK (
    reason = btrim(reason) AND reason <> ''
  ),
  CONSTRAINT discount_authorization_grants_use CHECK (
    (consumed_at IS NULL AND sale_id IS NULL)
    OR (consumed_at IS NOT NULL AND sale_id IS NOT NULL)
  )
);

CREATE INDEX discount_authorization_grants_requested_index
  ON discount_authorization_grants (requested_by, expires_at DESC);

ALTER TABLE sale_payments
  ADD COLUMN request_key VARCHAR(80),
  ADD COLUMN cash_received_cents BIGINT,
  ADD COLUMN change_cents BIGINT,
  ADD CONSTRAINT sale_payments_request_key_normalized CHECK (
    request_key IS NULL OR (request_key = btrim(request_key) AND request_key <> '')
  ),
  ADD CONSTRAINT sale_payments_cash_consistency CHECK (
    (
      payment_method = 'CASH'
      AND cash_received_cents IS NOT NULL
      AND change_cents IS NOT NULL
      AND cash_received_cents >= amount_cents
      AND change_cents = cash_received_cents - amount_cents
    )
    OR (
      payment_method <> 'CASH'
      AND cash_received_cents IS NULL
      AND change_cents IS NULL
    )
  );

CREATE UNIQUE INDEX sale_payments_request_key_unique
  ON sale_payments (sale_id, request_key)
  WHERE request_key IS NOT NULL;

CREATE TABLE cash_register_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status VARCHAR(10) NOT NULL DEFAULT 'OPEN',
  opening_amount_cents BIGINT NOT NULL CHECK (opening_amount_cents >= 0),
  closing_counted_cents BIGINT,
  expected_amount_cents BIGINT,
  difference_cents BIGINT,
  opening_notes VARCHAR(500),
  closing_notes VARCHAR(500),
  opened_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  closed_at TIMESTAMPTZ,
  is_test_configuration BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT cash_register_sessions_status CHECK (status IN ('OPEN', 'CLOSED')),
  CONSTRAINT cash_register_sessions_closure CHECK (
    (
      status = 'OPEN'
      AND closing_counted_cents IS NULL
      AND expected_amount_cents IS NULL
      AND difference_cents IS NULL
      AND closed_by IS NULL
      AND closed_at IS NULL
    )
    OR (
      status = 'CLOSED'
      AND closing_counted_cents IS NOT NULL
      AND expected_amount_cents IS NOT NULL
      AND difference_cents IS NOT NULL
      AND closed_by IS NOT NULL
      AND closed_at IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX cash_register_one_open_session
  ON cash_register_sessions (status)
  WHERE status = 'OPEN';

CREATE TABLE cash_register_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES cash_register_sessions(id) ON DELETE RESTRICT,
  movement_type VARCHAR(20) NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  reason VARCHAR(500) NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT cash_register_movements_type CHECK (
    movement_type IN ('MANUAL_IN', 'MANUAL_OUT')
  ),
  CONSTRAINT cash_register_movements_reason CHECK (
    reason = btrim(reason) AND reason <> ''
  )
);

CREATE INDEX cash_register_movements_session_date_index
  ON cash_register_movements (session_id, created_at, id);
