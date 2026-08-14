-- Crear la ficha clínica longitudinal, atenciones y recetas ópticas permanentes.
CREATE TABLE medical_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL UNIQUE REFERENCES patients(id) ON DELETE RESTRICT,
  general_medical_history TEXT,
  ocular_history TEXT,
  family_ocular_history TEXT,
  allergies TEXT,
  current_medications TEXT,
  created_by UUID NOT NULL REFERENCES professional_profiles(user_id) ON DELETE RESTRICT,
  updated_by UUID NOT NULL REFERENCES professional_profiles(user_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT medical_records_text_lengths CHECK (
    char_length(COALESCE(general_medical_history, '')) <= 5000
    AND char_length(COALESCE(ocular_history, '')) <= 5000
    AND char_length(COALESCE(family_ocular_history, '')) <= 5000
    AND char_length(COALESCE(allergies, '')) <= 5000
    AND char_length(COALESCE(current_medications, '')) <= 5000
  )
);

CREATE TRIGGER medical_records_set_updated_at
BEFORE UPDATE ON medical_records
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

CREATE TABLE medical_record_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  medical_record_id UUID NOT NULL REFERENCES medical_records(id) ON DELETE RESTRICT,
  event_type VARCHAR(20) NOT NULL,
  changed_fields TEXT[] NOT NULL DEFAULT '{}',
  performed_by UUID NOT NULL REFERENCES professional_profiles(user_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT medical_record_events_type CHECK (event_type IN ('CREATED', 'UPDATED'))
);

CREATE INDEX medical_record_events_record_index
  ON medical_record_events (medical_record_id, created_at, id);

CREATE TABLE clinical_encounters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE RESTRICT,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  professional_id UUID NOT NULL REFERENCES professional_profiles(user_id) ON DELETE RESTRICT,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  reason_for_visit VARCHAR(1000) NOT NULL,
  anamnesis TEXT,
  examination TEXT,
  diagnosis TEXT,
  indications TEXT,
  finalized_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES professional_profiles(user_id) ON DELETE RESTRICT,
  updated_by UUID NOT NULL REFERENCES professional_profiles(user_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT clinical_encounters_status CHECK (status IN ('DRAFT', 'FINALIZED')),
  CONSTRAINT clinical_encounters_finalization_consistency CHECK (
    (status = 'DRAFT' AND finalized_at IS NULL)
    OR (status = 'FINALIZED' AND finalized_at IS NOT NULL)
  ),
  CONSTRAINT clinical_encounters_text_lengths CHECK (
    char_length(reason_for_visit) BETWEEN 1 AND 1000
    AND char_length(COALESCE(anamnesis, '')) <= 10000
    AND char_length(COALESCE(examination, '')) <= 10000
    AND char_length(COALESCE(diagnosis, '')) <= 5000
    AND char_length(COALESCE(indications, '')) <= 5000
  )
);

CREATE INDEX clinical_encounters_patient_history_index
  ON clinical_encounters (patient_id, created_at DESC, id);
CREATE INDEX clinical_encounters_professional_index
  ON clinical_encounters (professional_id, created_at DESC);

CREATE TRIGGER clinical_encounters_set_updated_at
BEFORE UPDATE ON clinical_encounters
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

CREATE TABLE clinical_encounter_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  encounter_id UUID NOT NULL REFERENCES clinical_encounters(id) ON DELETE RESTRICT,
  event_type VARCHAR(30) NOT NULL,
  changed_fields TEXT[] NOT NULL DEFAULT '{}',
  performed_by UUID NOT NULL REFERENCES professional_profiles(user_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT clinical_encounter_events_type CHECK (
    event_type IN ('CREATED', 'UPDATED', 'FINALIZED', 'ADDENDUM_ADDED')
  )
);

CREATE INDEX clinical_encounter_events_encounter_index
  ON clinical_encounter_events (encounter_id, created_at, id);

CREATE TABLE clinical_encounter_addenda (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id UUID NOT NULL REFERENCES clinical_encounters(id) ON DELETE RESTRICT,
  reason VARCHAR(500) NOT NULL,
  content TEXT NOT NULL,
  authored_by UUID NOT NULL REFERENCES professional_profiles(user_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT clinical_encounter_addenda_content CHECK (
    char_length(reason) BETWEEN 1 AND 500
    AND char_length(content) BETWEEN 1 AND 5000
  )
);

CREATE INDEX clinical_encounter_addenda_encounter_index
  ON clinical_encounter_addenda (encounter_id, created_at, id);

CREATE TABLE optical_prescriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id UUID NOT NULL REFERENCES clinical_encounters(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  right_sphere NUMERIC(6, 2) NOT NULL,
  right_cylinder NUMERIC(6, 2) NOT NULL,
  right_axis SMALLINT,
  right_addition NUMERIC(6, 2),
  left_sphere NUMERIC(6, 2) NOT NULL,
  left_cylinder NUMERIC(6, 2) NOT NULL,
  left_axis SMALLINT,
  left_addition NUMERIC(6, 2),
  pupillary_distance NUMERIC(6, 2),
  fulfillment_notes VARCHAR(1000),
  replaced_prescription_id UUID REFERENCES optical_prescriptions(id) ON DELETE RESTRICT,
  replacement_reason VARCHAR(500),
  issued_by UUID NOT NULL REFERENCES professional_profiles(user_id) ON DELETE RESTRICT,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  voided_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT optical_prescriptions_encounter_version UNIQUE (encounter_id, version),
  CONSTRAINT optical_prescriptions_status CHECK (status IN ('ACTIVE', 'VOIDED')),
  CONSTRAINT optical_prescriptions_axis CHECK (
    (right_axis IS NULL OR right_axis BETWEEN 0 AND 180)
    AND (left_axis IS NULL OR left_axis BETWEEN 0 AND 180)
  ),
  CONSTRAINT optical_prescriptions_cylinder_axis CHECK (
    (right_cylinder = 0 OR right_axis IS NOT NULL)
    AND (left_cylinder = 0 OR left_axis IS NOT NULL)
  ),
  CONSTRAINT optical_prescriptions_status_consistency CHECK (
    (status = 'ACTIVE' AND voided_at IS NULL)
    OR (status = 'VOIDED' AND voided_at IS NOT NULL)
  ),
  CONSTRAINT optical_prescriptions_replacement_consistency CHECK (
    (replaced_prescription_id IS NULL AND replacement_reason IS NULL)
    OR (
      replaced_prescription_id IS NOT NULL
      AND replacement_reason IS NOT NULL
      AND char_length(replacement_reason) BETWEEN 1 AND 500
    )
  )
);

CREATE UNIQUE INDEX optical_prescriptions_active_encounter_index
  ON optical_prescriptions (encounter_id)
  WHERE status = 'ACTIVE';
CREATE INDEX optical_prescriptions_patient_lookup_index
  ON optical_prescriptions (encounter_id, issued_at DESC);

CREATE TRIGGER optical_prescriptions_set_updated_at
BEFORE UPDATE ON optical_prescriptions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();
