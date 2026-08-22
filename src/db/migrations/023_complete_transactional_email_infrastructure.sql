-- Completar la cola transaccional sin activar envíos ni cron de producción.
ALTER TABLE transactional_email_outbox
  DROP CONSTRAINT transactional_email_template,
  DROP CONSTRAINT transactional_email_status,
  DROP CONSTRAINT transactional_email_sent;

UPDATE transactional_email_outbox
SET
  status = 'FAILED',
  last_error = 'Reintento requerido después de actualizar la infraestructura.'
WHERE status = 'SENDING';

ALTER TABLE transactional_email_outbox
  ADD COLUMN next_attempt_at TIMESTAMPTZ,
  ADD COLUMN processing_started_at TIMESTAMPTZ,
  ADD COLUMN processing_finished_at TIMESTAMPTZ,
  ADD COLUMN locked_at TIMESTAMPTZ,
  ADD COLUMN lock_expires_at TIMESTAMPTZ,
  ADD COLUMN locked_by UUID,
  ADD COLUMN provider VARCHAR(30),
  ADD COLUMN provider_message_id VARCHAR(200),
  ADD COLUMN effective_recipient_email VARCHAR(254),
  ADD COLUMN delivery_mode VARCHAR(20),
  ADD COLUMN last_error_code VARCHAR(80),
  ADD COLUMN skip_reason VARCHAR(200),
  ADD COLUMN sale_id UUID REFERENCES sales(id) ON DELETE RESTRICT,
  ADD COLUMN payment_id UUID REFERENCES sale_payments(id) ON DELETE RESTRICT,
  ADD COLUMN receipt_id UUID REFERENCES sale_receipts(id) ON DELETE RESTRICT,
  ADD COLUMN appointment_id UUID REFERENCES appointments(id) ON DELETE RESTRICT,
  ADD COLUMN account_id UUID REFERENCES customer_accounts(id) ON DELETE RESTRICT;

UPDATE transactional_email_outbox
SET
  next_attempt_at = scheduled_at,
  processing_finished_at = CASE
    WHEN status = 'SENT' THEN sent_at
    ELSE NULL
  END;

UPDATE transactional_email_outbox
SET account_id = split_part(deduplication_key, ':', 2)::UUID
WHERE template_code = 'ACCOUNT_CREATED'
  AND split_part(deduplication_key, ':', 2)
    ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

UPDATE transactional_email_outbox
SET appointment_id = (payload ->> 'appointmentId')::UUID
WHERE template_code IN ('APPOINTMENT_CONFIRMED', 'APPOINTMENT_REMINDER')
  AND payload ->> 'appointmentId'
    ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

UPDATE transactional_email_outbox
SET sale_id = (payload ->> 'saleId')::UUID
WHERE template_code = 'PAYMENT_CONFIRMED'
  AND payload ->> 'saleId'
    ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

UPDATE transactional_email_outbox AS outbox
SET payment_id = sale_payments.id,
    sale_id = COALESCE(outbox.sale_id, sale_payments.sale_id)
FROM payment_attempts
JOIN sale_payments ON sale_payments.provider_attempt_id = payment_attempts.id
WHERE outbox.deduplication_key =
  'payment-attempt:' || payment_attempts.id::TEXT || ':approved';

ALTER TABLE transactional_email_outbox
  ALTER COLUMN next_attempt_at SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN next_attempt_at SET NOT NULL,
  ADD CONSTRAINT transactional_email_template CHECK (
    template_code IN (
      'ACCOUNT_CREATED',
      'APPOINTMENT_CONFIRMED',
      'APPOINTMENT_REMINDER',
      'ORDER_CONFIRMED',
      'PAYMENT_CONFIRMED',
      'POS_PAYMENT_RECEIPT',
      'POS_FINAL_RECEIPT'
    )
  ),
  ADD CONSTRAINT transactional_email_status CHECK (
    status IN (
      'PENDING', 'PROCESSING', 'SENT', 'TEST_SENT', 'SIMULATED',
      'FAILED', 'DEAD_LETTER', 'DELIVERED', 'BOUNCED',
      'COMPLAINED', 'SUPPRESSED'
    )
  ),
  ADD CONSTRAINT transactional_email_mode CHECK (
    delivery_mode IS NULL OR delivery_mode IN ('simulate', 'test', 'live')
  ),
  ADD CONSTRAINT transactional_email_effective_recipient CHECK (
    effective_recipient_email IS NULL OR (
      effective_recipient_email = lower(btrim(effective_recipient_email))
      AND effective_recipient_email LIKE '%@%'
    )
  ),
  ADD CONSTRAINT transactional_email_lock_consistency CHECK (
    (
      status = 'PROCESSING'
      AND locked_at IS NOT NULL
      AND lock_expires_at IS NOT NULL
      AND locked_by IS NOT NULL
    ) OR (
      status <> 'PROCESSING'
      AND locked_at IS NULL
      AND lock_expires_at IS NULL
      AND locked_by IS NULL
    )
  ),
  ADD CONSTRAINT transactional_email_sent CHECK (
    (
      status IN ('SENT', 'TEST_SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED')
      AND sent_at IS NOT NULL
    ) OR (
      status NOT IN (
        'SENT', 'TEST_SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED',
        'SUPPRESSED', 'DEAD_LETTER'
      )
      AND sent_at IS NULL
    ) OR status IN ('SUPPRESSED', 'DEAD_LETTER')
  );

DROP INDEX transactional_email_pending;

CREATE INDEX transactional_email_eligible_index
  ON transactional_email_outbox (next_attempt_at, created_at, id)
  WHERE status IN ('PENDING', 'FAILED');

CREATE INDEX transactional_email_retry_index
  ON transactional_email_outbox (attempt_count, next_attempt_at)
  WHERE status = 'FAILED';

CREATE INDEX transactional_email_expired_lock_index
  ON transactional_email_outbox (lock_expires_at)
  WHERE status = 'PROCESSING';

CREATE UNIQUE INDEX transactional_email_provider_message_unique
  ON transactional_email_outbox (provider, provider_message_id)
  WHERE provider IS NOT NULL AND provider_message_id IS NOT NULL;

CREATE UNIQUE INDEX transactional_email_receipt_unique
  ON transactional_email_outbox (receipt_id)
  WHERE receipt_id IS NOT NULL;

CREATE INDEX transactional_email_sale_index
  ON transactional_email_outbox (sale_id, created_at DESC)
  WHERE sale_id IS NOT NULL;

CREATE INDEX transactional_email_appointment_index
  ON transactional_email_outbox (appointment_id, created_at DESC)
  WHERE appointment_id IS NOT NULL;

INSERT INTO transactional_email_outbox (
  template_code, recipient_email, payload, deduplication_key, status,
  scheduled_at, next_attempt_at, last_error, last_error_code, sent_at,
  processing_finished_at, provider, provider_message_id,
  effective_recipient_email, delivery_mode, sale_id, payment_id, receipt_id
)
SELECT
  CASE sale_receipts.receipt_type
    WHEN 'PAYMENT' THEN 'POS_PAYMENT_RECEIPT'
    ELSE 'POS_FINAL_RECEIPT'
  END,
  sale_receipts.emailed_to,
  '{}'::JSONB,
  CASE sale_receipts.receipt_type
    WHEN 'PAYMENT' THEN 'receipt-payment:' || sale_receipts.id::TEXT
    ELSE 'receipt-final:' || sale_receipts.id::TEXT
  END,
  sale_receipts.email_status,
  sale_receipts.issued_at,
  CASE WHEN sale_receipts.email_status = 'FAILED'
    THEN CURRENT_TIMESTAMP ELSE sale_receipts.issued_at END,
  CASE WHEN sale_receipts.email_status = 'FAILED'
    THEN 'Fallo heredado del envío directo.' ELSE NULL END,
  CASE WHEN sale_receipts.email_status = 'FAILED'
    THEN 'legacy_direct_send_failure' ELSE NULL END,
  CASE WHEN sale_receipts.email_status = 'SENT'
    THEN COALESCE(sale_receipts.email_updated_at, sale_receipts.issued_at)
    ELSE NULL END,
  CASE WHEN sale_receipts.email_status IN ('SENT', 'SIMULATED')
    THEN COALESCE(sale_receipts.email_updated_at, sale_receipts.issued_at)
    ELSE NULL END,
  CASE WHEN sale_receipts.email_provider_id IS NOT NULL THEN 'RESEND' ELSE NULL END,
  sale_receipts.email_provider_id,
  CASE WHEN sale_receipts.email_status = 'SENT'
    THEN sale_receipts.emailed_to ELSE NULL END,
  CASE sale_receipts.email_status
    WHEN 'SENT' THEN 'live'
    WHEN 'SIMULATED' THEN 'simulate'
    ELSE NULL
  END,
  sale_receipts.sale_id,
  sale_receipts.payment_id,
  sale_receipts.id
FROM sale_receipts
WHERE sale_receipts.emailed_to IS NOT NULL
ON CONFLICT (deduplication_key) DO NOTHING;

CREATE TABLE transactional_email_transitions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email_id UUID NOT NULL REFERENCES transactional_email_outbox(id) ON DELETE RESTRICT,
  from_status VARCHAR(20),
  to_status VARCHAR(20) NOT NULL,
  reason_code VARCHAR(80) NOT NULL,
  error_code VARCHAR(80),
  attempt_count SMALLINT NOT NULL CHECK (attempt_count >= 0),
  actor_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX transactional_email_transitions_email_index
  ON transactional_email_transitions (email_id, occurred_at, id);

INSERT INTO transactional_email_transitions (
  email_id, from_status, to_status, reason_code, attempt_count, occurred_at
)
SELECT id, NULL, status, 'MIGRATED_FROM_016', attempt_count, created_at
FROM transactional_email_outbox;

CREATE TABLE transactional_email_provider_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider VARCHAR(30) NOT NULL,
  provider_event_id VARCHAR(200) NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  provider_message_id VARCHAR(200),
  email_id UUID REFERENCES transactional_email_outbox(id) ON DELETE RESTRICT,
  occurred_at TIMESTAMPTZ,
  payload_sha256 CHAR(64) NOT NULL,
  event_data JSONB NOT NULL DEFAULT '{}'::JSONB,
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT transactional_email_provider_event_unique
    UNIQUE (provider, provider_event_id),
  CONSTRAINT transactional_email_provider_event_hash CHECK (
    payload_sha256 ~ '^[0-9a-f]{64}$'
  )
);

CREATE INDEX transactional_email_provider_events_message_index
  ON transactional_email_provider_events (provider, provider_message_id, received_at DESC);

CREATE TABLE transactional_email_worker_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID NOT NULL,
  trigger_source VARCHAR(20) NOT NULL,
  delivery_mode VARCHAR(20),
  status VARCHAR(20) NOT NULL DEFAULT 'RUNNING',
  claimed_count INTEGER NOT NULL DEFAULT 0 CHECK (claimed_count >= 0),
  sent_count INTEGER NOT NULL DEFAULT 0 CHECK (sent_count >= 0),
  simulated_count INTEGER NOT NULL DEFAULT 0 CHECK (simulated_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  dead_letter_count INTEGER NOT NULL DEFAULT 0 CHECK (dead_letter_count >= 0),
  recovered_count INTEGER NOT NULL DEFAULT 0 CHECK (recovered_count >= 0),
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMPTZ,
  CONSTRAINT transactional_email_worker_trigger CHECK (
    trigger_source IN ('cron', 'manual', 'script', 'test')
  ),
  CONSTRAINT transactional_email_worker_mode CHECK (
    delivery_mode IS NULL OR delivery_mode IN ('simulate', 'test', 'live')
  ),
  CONSTRAINT transactional_email_worker_status CHECK (
    status IN ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED', 'DISABLED')
  )
);

CREATE INDEX transactional_email_worker_runs_date_index
  ON transactional_email_worker_runs (started_at DESC);

ALTER TABLE sale_receipts
  DROP CONSTRAINT sale_receipts_email_status,
  ADD CONSTRAINT sale_receipts_email_status CHECK (
    email_status IN (
      'PENDING', 'PROCESSING', 'SENT', 'TEST_SENT', 'SIMULATED',
      'FAILED', 'DEAD_LETTER', 'DELIVERED', 'BOUNCED',
      'COMPLAINED', 'SUPPRESSED'
    )
  );

INSERT INTO permissions (code, description) VALUES
  ('transactional_emails.manage', 'Diagnosticar y reintentar correos transaccionales.');

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code = 'transactional_emails.manage'
WHERE roles.code = 'ADMIN';

COMMENT ON COLUMN transactional_email_outbox.recipient_email IS
  'Destinatario original normalizado; nunca se reemplaza al redirigir pruebas.';
COMMENT ON COLUMN transactional_email_outbox.effective_recipient_email IS
  'Destino realmente usado por el proveedor en modos test o live.';
COMMENT ON COLUMN transactional_email_outbox.scheduled_at IS
  'Fecha original del evento o recordatorio; no cambia durante reintentos.';
COMMENT ON COLUMN transactional_email_outbox.next_attempt_at IS
  'Próximo instante elegible, actualizado por la política de reintentos.';
COMMENT ON TABLE transactional_email_provider_events IS
  'Eventos verificados del proveedor, reducidos a metadatos no sensibles.';
