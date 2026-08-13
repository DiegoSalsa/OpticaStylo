-- Vincular la identidad clínica existente con su configuración de agenda.
CREATE TABLE professional_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  appointment_duration_minutes SMALLINT NOT NULL,
  slot_interval_minutes SMALLINT NOT NULL,
  is_bookable BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT professional_profiles_duration_range CHECK (
    appointment_duration_minutes BETWEEN 5 AND 480
  ),
  CONSTRAINT professional_profiles_interval_range CHECK (
    slot_interval_minutes BETWEEN 5 AND 120
  )
);

CREATE INDEX professional_profiles_bookable_index
  ON professional_profiles (is_bookable);

CREATE TRIGGER professional_profiles_set_updated_at
BEFORE UPDATE ON professional_profiles
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();
