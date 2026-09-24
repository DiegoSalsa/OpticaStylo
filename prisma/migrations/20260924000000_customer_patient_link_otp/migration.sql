-- Agregar desafíos OTP para demostrar posesión del correo antes de vincular una cuenta con un paciente.
CREATE TABLE customer_patient_link_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  code_hash CHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempt_count SMALLINT NOT NULL DEFAULT 0,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT customer_patient_link_challenges_hash CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT customer_patient_link_challenges_attempts CHECK (attempt_count BETWEEN 0 AND 5),
  CONSTRAINT customer_patient_link_challenges_expiration CHECK (expires_at > created_at),
  CONSTRAINT customer_patient_link_challenges_consumed CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE INDEX customer_patient_link_challenges_account_index
  ON customer_patient_link_challenges (account_id, created_at DESC);
CREATE INDEX customer_patient_link_challenges_expiration_index
  ON customer_patient_link_challenges (expires_at);

CREATE TRIGGER customer_patient_link_challenges_set_updated_at
BEFORE UPDATE ON customer_patient_link_challenges
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

-- Permitir que el outbox existente entregue el código sin crear un canal de correo nuevo.
ALTER TABLE transactional_email_outbox
  DROP CONSTRAINT transactional_email_template,
  ADD CONSTRAINT transactional_email_template CHECK (
    template_code IN (
      'ACCOUNT_CREATED',
      'APPOINTMENT_CONFIRMED',
      'APPOINTMENT_REMINDER',
      'CUSTOMER_PATIENT_OTP',
      'ORDER_CONFIRMED',
      'PAYMENT_CONFIRMED',
      'POS_PAYMENT_RECEIPT',
      'POS_FINAL_RECEIPT'
    )
  );
