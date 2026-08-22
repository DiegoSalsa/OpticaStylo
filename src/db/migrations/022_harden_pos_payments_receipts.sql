-- Endurecer abonos, comprobantes y autorizaciones de descuentos del POS.
ALTER TABLE sale_receipts
  DROP CONSTRAINT sale_receipts_sale_id_key,
  ADD COLUMN payment_id UUID REFERENCES sale_payments(id) ON DELETE RESTRICT,
  ADD COLUMN receipt_type VARCHAR(20);

UPDATE sale_receipts
SET receipt_type = CASE
  WHEN payload ->> 'status' = 'PAID' THEN 'FINAL'
  ELSE 'PAYMENT'
END;

ALTER TABLE sale_receipts
  ALTER COLUMN receipt_type SET NOT NULL,
  ADD CONSTRAINT sale_receipts_type CHECK (
    receipt_type IN ('PAYMENT', 'FINAL')
  );

CREATE UNIQUE INDEX sale_receipts_payment_unique
  ON sale_receipts (payment_id)
  WHERE payment_id IS NOT NULL;

CREATE UNIQUE INDEX sale_receipts_final_sale_unique
  ON sale_receipts (sale_id)
  WHERE receipt_type = 'FINAL';

CREATE INDEX sale_receipts_sale_date_index
  ON sale_receipts (sale_id, issued_at DESC, receipt_number DESC);

CREATE TABLE discount_authorization_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempted_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  authorizer_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  authorizer_email VARCHAR(254) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ,
  CONSTRAINT discount_authorization_attempts_email CHECK (
    authorizer_email = lower(btrim(authorizer_email))
    AND authorizer_email <> ''
  ),
  CONSTRAINT discount_authorization_attempts_status CHECK (
    status IN ('PENDING', 'SUCCEEDED', 'FAILED', 'RATE_LIMITED')
  ),
  CONSTRAINT discount_authorization_attempts_completion CHECK (
    (status = 'PENDING' AND completed_at IS NULL)
    OR (status <> 'PENDING' AND completed_at IS NOT NULL)
  )
);

CREATE INDEX discount_authorization_attempts_actor_date_index
  ON discount_authorization_attempts (attempted_by, attempted_at DESC);

CREATE INDEX discount_authorization_attempts_email_date_index
  ON discount_authorization_attempts (authorizer_email, attempted_at DESC);

ALTER TABLE sale_events
  DROP CONSTRAINT sale_events_type,
  ADD CONSTRAINT sale_events_type CHECK (
    event_type IN (
      'CREATED', 'UPDATED', 'STATUS_CHANGED', 'PAYMENT_REGISTERED',
      'PAYMENT_STATUS_CHANGED', 'DISCOUNT_AUTHORIZED', 'RECEIPT_ISSUED',
      'EMAIL_SENT', 'EMAIL_FAILED', 'EMAIL_SIMULATED', 'CANCELLED'
    )
  );
