DELETE FROM transactional_email_provider_events
WHERE email_id IN (
  SELECT id
  FROM transactional_email_outbox
  WHERE template_code = 'PASSWORD_RECOVERY'
);

DELETE FROM transactional_email_transitions
WHERE email_id IN (
  SELECT id
  FROM transactional_email_outbox
  WHERE template_code = 'PASSWORD_RECOVERY'
);

DELETE FROM transactional_email_outbox
WHERE template_code = 'PASSWORD_RECOVERY';

DROP INDEX transactional_email_password_recovery_unique;

ALTER TABLE transactional_email_outbox
  DROP CONSTRAINT transactional_email_password_recovery_consistency,
  DROP CONSTRAINT transactional_email_template,
  DROP COLUMN password_reset_request_id,
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
  );

DROP TABLE password_recovery_audit;
DROP TABLE password_reset_requests;
