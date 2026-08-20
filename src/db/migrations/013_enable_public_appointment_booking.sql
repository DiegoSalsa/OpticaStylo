ALTER TABLE patients ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE patients ALTER COLUMN updated_by DROP NOT NULL;

ALTER TABLE appointments ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE appointments ALTER COLUMN updated_by DROP NOT NULL;
ALTER TABLE appointment_events ALTER COLUMN performed_by DROP NOT NULL;

ALTER TABLE appointments
  ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT 'INTERNAL',
  ADD COLUMN public_manage_token_hash CHAR(64);

ALTER TABLE appointments
  ADD CONSTRAINT appointments_source CHECK (source IN ('INTERNAL', 'PUBLIC')),
  ADD CONSTRAINT appointments_public_token_consistency CHECK (
    (source = 'PUBLIC' AND public_manage_token_hash IS NOT NULL)
    OR (source = 'INTERNAL' AND public_manage_token_hash IS NULL)
  ),
  ADD CONSTRAINT appointments_public_token_unique UNIQUE (public_manage_token_hash);
