CREATE TABLE password_reset_requests (
  id UUID PRIMARY KEY,
  scope VARCHAR(20) NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  customer_account_id UUID REFERENCES customer_accounts(id) ON DELETE RESTRICT,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  requested_ip INET,
  requested_user_agent VARCHAR(512),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT password_reset_requests_scope CHECK (
    scope IN ('INTERNAL_USER', 'STORE_ACCOUNT')
  ),
  CONSTRAINT password_reset_requests_target CHECK (
    (scope = 'INTERNAL_USER' AND user_id IS NOT NULL AND customer_account_id IS NULL)
    OR (scope = 'STORE_ACCOUNT' AND user_id IS NULL AND customer_account_id IS NOT NULL)
  ),
  CONSTRAINT password_reset_requests_hash CHECK (
    token_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT password_reset_requests_expiration CHECK (
    expires_at > created_at
  ),
  CONSTRAINT password_reset_requests_consumption CHECK (
    consumed_at IS NULL OR consumed_at >= created_at
  ),
  CONSTRAINT password_reset_requests_revocation CHECK (
    revoked_at IS NULL OR revoked_at >= created_at
  ),
  CONSTRAINT password_reset_requests_final_state CHECK (
    consumed_at IS NULL OR revoked_at IS NULL
  )
);

CREATE INDEX password_reset_requests_internal_active_index
  ON password_reset_requests (user_id, expires_at DESC)
  WHERE scope = 'INTERNAL_USER' AND consumed_at IS NULL AND revoked_at IS NULL;

CREATE INDEX password_reset_requests_store_active_index
  ON password_reset_requests (customer_account_id, expires_at DESC)
  WHERE scope = 'STORE_ACCOUNT' AND consumed_at IS NULL AND revoked_at IS NULL;

CREATE INDEX password_reset_requests_expiration_index
  ON password_reset_requests (expires_at)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE TABLE password_recovery_audit (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  password_reset_request_id UUID
    REFERENCES password_reset_requests(id) ON DELETE RESTRICT,
  scope VARCHAR(20) NOT NULL,
  event VARCHAR(40) NOT NULL,
  request_ip INET,
  request_user_agent VARCHAR(512),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT password_recovery_audit_scope CHECK (
    scope IN ('INTERNAL_USER', 'STORE_ACCOUNT')
  ),
  CONSTRAINT password_recovery_audit_event CHECK (
    event IN (
      'REQUEST_ACCEPTED',
      'REQUEST_IGNORED',
      'REQUEST_UNAVAILABLE',
      'RESET_COMPLETED',
      'RESET_REJECTED'
    )
  )
);

CREATE INDEX password_recovery_audit_request_index
  ON password_recovery_audit (password_reset_request_id, occurred_at DESC)
  WHERE password_reset_request_id IS NOT NULL;

CREATE INDEX password_recovery_audit_event_index
  ON password_recovery_audit (scope, event, occurred_at DESC);

ALTER TABLE transactional_email_outbox
  ADD COLUMN password_reset_request_id UUID
    REFERENCES password_reset_requests(id) ON DELETE RESTRICT,
  DROP CONSTRAINT transactional_email_template,
  ADD CONSTRAINT transactional_email_template CHECK (
    template_code IN (
      'ACCOUNT_CREATED',
      'APPOINTMENT_CONFIRMED',
      'APPOINTMENT_REMINDER',
      'ORDER_CONFIRMED',
      'PAYMENT_CONFIRMED',
      'POS_PAYMENT_RECEIPT',
      'POS_FINAL_RECEIPT',
      'PASSWORD_RECOVERY'
    )
  ),
  ADD CONSTRAINT transactional_email_password_recovery_consistency CHECK (
    (
      template_code = 'PASSWORD_RECOVERY'
      AND password_reset_request_id IS NOT NULL
    ) OR (
      template_code <> 'PASSWORD_RECOVERY'
      AND password_reset_request_id IS NULL
    )
  );

CREATE UNIQUE INDEX transactional_email_password_recovery_unique
  ON transactional_email_outbox (password_reset_request_id)
  WHERE password_reset_request_id IS NOT NULL;
