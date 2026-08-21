-- Conservar una copia inmutable de cada versión de la ficha longitudinal.
CREATE TABLE medical_record_revisions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  medical_record_id UUID NOT NULL REFERENCES medical_records(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision > 0),
  general_medical_history TEXT,
  ocular_history TEXT,
  family_ocular_history TEXT,
  allergies TEXT,
  current_medications TEXT,
  changed_fields TEXT[] NOT NULL DEFAULT '{}',
  recorded_by UUID NOT NULL REFERENCES professional_profiles(user_id) ON DELETE RESTRICT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT medical_record_revisions_record_revision UNIQUE (medical_record_id, revision),
  CONSTRAINT medical_record_revisions_text_lengths CHECK (
    char_length(COALESCE(general_medical_history, '')) <= 5000
    AND char_length(COALESCE(ocular_history, '')) <= 5000
    AND char_length(COALESCE(family_ocular_history, '')) <= 5000
    AND char_length(COALESCE(allergies, '')) <= 5000
    AND char_length(COALESCE(current_medications, '')) <= 5000
  )
);

CREATE INDEX medical_record_revisions_record_index
  ON medical_record_revisions (medical_record_id, revision DESC);

CREATE FUNCTION preserve_medical_record_revision()
RETURNS TRIGGER AS $$
DECLARE
  next_revision INTEGER;
  changed TEXT[];
BEGIN
  SELECT COALESCE(MAX(revision), 0) + 1
  INTO next_revision
  FROM medical_record_revisions
  WHERE medical_record_id = NEW.id;

  IF TG_OP = 'INSERT' THEN
    changed := array_remove(ARRAY[
      CASE WHEN NEW.general_medical_history IS NOT NULL THEN 'generalMedicalHistory' END,
      CASE WHEN NEW.ocular_history IS NOT NULL THEN 'ocularHistory' END,
      CASE WHEN NEW.family_ocular_history IS NOT NULL THEN 'familyOcularHistory' END,
      CASE WHEN NEW.allergies IS NOT NULL THEN 'allergies' END,
      CASE WHEN NEW.current_medications IS NOT NULL THEN 'currentMedications' END
    ], NULL);
  ELSE
    changed := array_remove(ARRAY[
      CASE WHEN NEW.general_medical_history IS DISTINCT FROM OLD.general_medical_history THEN 'generalMedicalHistory' END,
      CASE WHEN NEW.ocular_history IS DISTINCT FROM OLD.ocular_history THEN 'ocularHistory' END,
      CASE WHEN NEW.family_ocular_history IS DISTINCT FROM OLD.family_ocular_history THEN 'familyOcularHistory' END,
      CASE WHEN NEW.allergies IS DISTINCT FROM OLD.allergies THEN 'allergies' END,
      CASE WHEN NEW.current_medications IS DISTINCT FROM OLD.current_medications THEN 'currentMedications' END
    ], NULL);
  END IF;

  IF TG_OP = 'UPDATE' AND cardinality(changed) = 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO medical_record_revisions (
    medical_record_id,
    revision,
    general_medical_history,
    ocular_history,
    family_ocular_history,
    allergies,
    current_medications,
    changed_fields,
    recorded_by,
    recorded_at
  )
  VALUES (
    NEW.id,
    next_revision,
    NEW.general_medical_history,
    NEW.ocular_history,
    NEW.family_ocular_history,
    NEW.allergies,
    NEW.current_medications,
    changed,
    NEW.updated_by,
    COALESCE(NEW.updated_at, CURRENT_TIMESTAMP)
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Preservar el estado actual de fichas creadas antes de esta migración.
INSERT INTO medical_record_revisions (
  medical_record_id,
  revision,
  general_medical_history,
  ocular_history,
  family_ocular_history,
  allergies,
  current_medications,
  changed_fields,
  recorded_by,
  recorded_at
)
SELECT
  id,
  1,
  general_medical_history,
  ocular_history,
  family_ocular_history,
  allergies,
  current_medications,
  array_remove(ARRAY[
    CASE WHEN general_medical_history IS NOT NULL THEN 'generalMedicalHistory' END,
    CASE WHEN ocular_history IS NOT NULL THEN 'ocularHistory' END,
    CASE WHEN family_ocular_history IS NOT NULL THEN 'familyOcularHistory' END,
    CASE WHEN allergies IS NOT NULL THEN 'allergies' END,
    CASE WHEN current_medications IS NOT NULL THEN 'currentMedications' END
  ], NULL),
  updated_by,
  updated_at
FROM medical_records;

CREATE TRIGGER medical_records_preserve_revision
AFTER INSERT OR UPDATE ON medical_records
FOR EACH ROW
EXECUTE FUNCTION preserve_medical_record_revision();
