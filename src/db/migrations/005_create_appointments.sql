-- Registrar reservas permanentes y su historial de cambios.
CREATE TABLE appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  professional_id UUID NOT NULL REFERENCES professional_profiles(user_id) ON DELETE RESTRICT,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'CONFIRMED',
  internal_notes VARCHAR(1000),
  cancellation_reason VARCHAR(500),
  cancelled_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT appointments_range CHECK (start_at < end_at),
  CONSTRAINT appointments_status CHECK (
    status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW')
  ),
  CONSTRAINT appointments_notes_normalized CHECK (
    internal_notes IS NULL
    OR (internal_notes = btrim(internal_notes) AND internal_notes <> '')
  ),
  CONSTRAINT appointments_cancellation_consistency CHECK (
    (
      status = 'CANCELLED'
      AND cancelled_at IS NOT NULL
      AND cancellation_reason IS NOT NULL
      AND cancellation_reason = btrim(cancellation_reason)
      AND cancellation_reason <> ''
    )
    OR (
      status <> 'CANCELLED'
      AND cancelled_at IS NULL
      AND cancellation_reason IS NULL
    )
  )
);

CREATE INDEX appointments_professional_range_index
  ON appointments (professional_id, start_at, end_at);
CREATE INDEX appointments_patient_date_index
  ON appointments (patient_id, start_at DESC);
CREATE INDEX appointments_status_date_index
  ON appointments (status, start_at);

CREATE TRIGGER appointments_set_updated_at
BEFORE UPDATE ON appointments
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

CREATE TABLE appointment_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE RESTRICT,
  event_type VARCHAR(30) NOT NULL,
  previous_start_at TIMESTAMPTZ,
  new_start_at TIMESTAMPTZ,
  previous_end_at TIMESTAMPTZ,
  new_end_at TIMESTAMPTZ,
  previous_status VARCHAR(30),
  new_status VARCHAR(30),
  details TEXT,
  performed_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT appointment_events_type CHECK (
    event_type IN (
      'CREATED',
      'RESCHEDULED',
      'NOTES_UPDATED',
      'STATUS_CHANGED',
      'CANCELLED'
    )
  )
);

CREATE INDEX appointment_events_appointment_index
  ON appointment_events (appointment_id, created_at, id);
