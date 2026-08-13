-- Configurar la disponibilidad recurrente y excepcional de cada profesional.
CREATE TABLE professional_weekly_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id UUID NOT NULL REFERENCES professional_profiles(user_id) ON DELETE RESTRICT,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_working BOOLEAN NOT NULL DEFAULT TRUE,
  break_start TIME,
  break_end TIME,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (professional_id, day_of_week),
  CONSTRAINT professional_weekly_schedule_range CHECK (start_time < end_time),
  CONSTRAINT professional_weekly_schedule_break_pair CHECK (
    (break_start IS NULL AND break_end IS NULL)
    OR (break_start IS NOT NULL AND break_end IS NOT NULL)
  ),
  CONSTRAINT professional_weekly_schedule_break_range CHECK (
    break_start IS NULL
    OR (
      break_start >= start_time
      AND break_end <= end_time
      AND break_start < break_end
    )
  )
);

CREATE INDEX professional_weekly_schedules_professional_index
  ON professional_weekly_schedules (professional_id);

CREATE TRIGGER professional_weekly_schedules_set_updated_at
BEFORE UPDATE ON professional_weekly_schedules
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

CREATE TABLE professional_schedule_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id UUID NOT NULL REFERENCES professional_profiles(user_id) ON DELETE RESTRICT,
  date DATE NOT NULL,
  is_working BOOLEAN NOT NULL DEFAULT TRUE,
  start_time TIME,
  end_time TIME,
  break_start TIME,
  break_end TIME,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (professional_id, date),
  CONSTRAINT professional_schedule_override_working_range CHECK (
    (
      is_working = FALSE
      AND start_time IS NULL
      AND end_time IS NULL
      AND break_start IS NULL
      AND break_end IS NULL
    )
    OR (
      is_working = TRUE
      AND start_time IS NOT NULL
      AND end_time IS NOT NULL
      AND start_time < end_time
    )
  ),
  CONSTRAINT professional_schedule_override_break_pair CHECK (
    (break_start IS NULL AND break_end IS NULL)
    OR (break_start IS NOT NULL AND break_end IS NOT NULL)
  ),
  CONSTRAINT professional_schedule_override_break_range CHECK (
    break_start IS NULL
    OR (
      break_start >= start_time
      AND break_end <= end_time
      AND break_start < break_end
    )
  )
);

CREATE INDEX professional_schedule_overrides_lookup_index
  ON professional_schedule_overrides (professional_id, date);

CREATE TRIGGER professional_schedule_overrides_set_updated_at
BEFORE UPDATE ON professional_schedule_overrides
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

CREATE TABLE professional_schedule_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id UUID NOT NULL REFERENCES professional_profiles(user_id) ON DELETE RESTRICT,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  reason VARCHAR(500),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT professional_schedule_blocks_range CHECK (start_at < end_at),
  CONSTRAINT professional_schedule_blocks_reason_normalized CHECK (
    reason IS NULL OR (reason = btrim(reason) AND reason <> '')
  )
);

CREATE INDEX professional_schedule_blocks_range_index
  ON professional_schedule_blocks (professional_id, start_at, end_at);
