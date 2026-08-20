CREATE TABLE transactional_email_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_code VARCHAR(60) NOT NULL,
  recipient_email VARCHAR(254) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  deduplication_key VARCHAR(200) NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  attempt_count SMALLINT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error VARCHAR(1000),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT transactional_email_template CHECK (
    template_code IN (
      'ACCOUNT_CREATED',
      'APPOINTMENT_CONFIRMED',
      'APPOINTMENT_REMINDER',
      'ORDER_CONFIRMED',
      'PAYMENT_CONFIRMED'
    )
  ),
  CONSTRAINT transactional_email_status CHECK (
    status IN ('PENDING', 'SENDING', 'SENT', 'FAILED')
  ),
  CONSTRAINT transactional_email_recipient CHECK (
    recipient_email = lower(trim(recipient_email)) AND recipient_email LIKE '%@%'
  ),
  CONSTRAINT transactional_email_sent CHECK (
    (status = 'SENT' AND sent_at IS NOT NULL)
    OR (status <> 'SENT' AND sent_at IS NULL)
  )
);

CREATE INDEX transactional_email_pending
  ON transactional_email_outbox (scheduled_at, created_at)
  WHERE status IN ('PENDING', 'FAILED');

CREATE TRIGGER transactional_email_outbox_set_updated_at
BEFORE UPDATE ON transactional_email_outbox
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

COMMENT ON TABLE transactional_email_outbox IS
  'Cola transaccional independiente del proveedor de correo. No envía nada hasta configurar un adaptador.';
