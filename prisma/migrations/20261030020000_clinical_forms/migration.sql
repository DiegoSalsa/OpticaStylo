-- Los registros anteriores conservan sus datos. No se infiere fecha, número oficial ni identificación histórica.
ALTER TABLE clinical_encounters ALTER COLUMN appointment_id DROP NOT NULL;
CREATE SEQUENCE clinical_encounters_record_number_seq;
ALTER TABLE clinical_encounters ADD COLUMN encounter_type VARCHAR(20) NOT NULL DEFAULT 'GENERAL',
 ADD COLUMN encounter_date DATE, ADD COLUMN record_number BIGINT UNIQUE,
 ADD COLUMN form_version INTEGER NOT NULL DEFAULT 1, ADD COLUMN form_data JSONB,
 ADD COLUMN record_version INTEGER NOT NULL DEFAULT 1,
 ADD COLUMN patient_snapshot JSONB, ADD COLUMN professional_snapshot JSONB,
 ADD COLUMN request_key VARCHAR(80) UNIQUE, ADD COLUMN request_hash VARCHAR(64),
 ADD CONSTRAINT clinical_encounters_kind CHECK(encounter_type IN ('GENERAL','OPTOMETRY','CONTACTOLOGY')),
 ADD CONSTRAINT clinical_encounters_form_shape CHECK(form_version>0 AND record_version>0 AND (form_data IS NULL OR jsonb_typeof(form_data)='object'));
ALTER TABLE clinical_encounters ALTER COLUMN record_number SET DEFAULT nextval('clinical_encounters_record_number_seq');
ALTER SEQUENCE clinical_encounters_record_number_seq OWNED BY clinical_encounters.record_number;
ALTER TABLE clinical_encounters DROP CONSTRAINT clinical_encounters_text_lengths;
ALTER TABLE clinical_encounters ADD CONSTRAINT clinical_encounters_text_lengths CHECK(
 char_length(reason_for_visit) BETWEEN 0 AND 1000 AND (status='DRAFT' OR encounter_type='CONTACTOLOGY' OR char_length(btrim(reason_for_visit))>0)
 AND char_length(COALESCE(anamnesis,''))<=10000 AND char_length(COALESCE(examination,''))<=10000
 AND char_length(COALESCE(diagnosis,''))<=5000 AND char_length(COALESCE(indications,''))<=5000);
ALTER TABLE clinical_encounter_events ADD COLUMN record_version INTEGER, ADD COLUMN record_snapshot JSONB;
ALTER TABLE clinical_encounter_addenda ADD COLUMN request_key VARCHAR(80) UNIQUE;
ALTER TABLE clinical_encounter_events DROP CONSTRAINT clinical_encounter_events_type;
ALTER TABLE clinical_encounter_events ADD CONSTRAINT clinical_encounter_events_type CHECK(event_type IN ('CREATED','UPDATED','FINALIZED','ADDENDUM_ADDED','VIEWED','PRINTED'));
CREATE TABLE clinical_care_assignments (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
 professional_id UUID NOT NULL REFERENCES professional_profiles(user_id) ON DELETE RESTRICT,
 assigned_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT, reason VARCHAR(500) NOT NULL CHECK(btrim(reason)<>''),
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, revoked_at TIMESTAMPTZ,
 revoked_by UUID REFERENCES users(id) ON DELETE RESTRICT, revoke_reason VARCHAR(500),
 CHECK((revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND COALESCE(btrim(revoke_reason),'')<>''))
);
CREATE UNIQUE INDEX clinical_care_active ON clinical_care_assignments(patient_id,professional_id) WHERE revoked_at IS NULL;
CREATE INDEX clinical_care_assignments_lookup ON clinical_care_assignments(patient_id,professional_id);
CREATE FUNCTION protect_clinical_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL OR NEW.id<>OLD.id OR NEW.patient_id<>OLD.patient_id
 OR NEW.professional_id<>OLD.professional_id OR NEW.assigned_by<>OLD.assigned_by OR NEW.reason<>OLD.reason OR NEW.created_at<>OLD.created_at THEN
 RAISE EXCEPTION 'La asignación clínica conserva su autoría e historial'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER clinical_assignment_guard BEFORE UPDATE OR DELETE ON clinical_care_assignments FOR EACH ROW EXECUTE FUNCTION protect_clinical_assignment();
CREATE FUNCTION clinical_record_snapshot(e clinical_encounters) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
 SELECT (to_jsonb(e)-'updated_at'-'request_key'-'request_hash')||jsonb_build_object('record_number',e.record_number::text);
$$;
CREATE FUNCTION protect_clinical_encounter() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Las atenciones clínicas se conservan'; END IF;
 IF OLD.status='FINALIZED' THEN RAISE EXCEPTION 'La atención finalizada es inmutable; utilice una adenda'; END IF;
 IF NEW.patient_id<>OLD.patient_id OR NEW.professional_id<>OLD.professional_id OR NEW.appointment_id IS DISTINCT FROM OLD.appointment_id
 OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at OR NEW.record_number IS DISTINCT FROM OLD.record_number
 OR NEW.encounter_type<>OLD.encounter_type OR NEW.patient_snapshot IS DISTINCT FROM OLD.patient_snapshot
 OR NEW.professional_snapshot IS DISTINCT FROM OLD.professional_snapshot OR NEW.request_key IS DISTINCT FROM OLD.request_key
 OR NEW.request_hash IS DISTINCT FROM OLD.request_hash OR NEW.record_version<>OLD.record_version+1 THEN
 RAISE EXCEPTION 'Identidad clínica inmutable o versión no válida'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER clinical_encounter_guard BEFORE UPDATE OR DELETE ON clinical_encounters FOR EACH ROW EXECUTE FUNCTION protect_clinical_encounter();
CREATE FUNCTION check_clinical_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' AND NEW.encounter_type='GENERAL' AND NEW.encounter_date IS NULL AND NEW.patient_snapshot IS NULL AND NEW.request_key IS NULL THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM clinical_encounter_events e WHERE e.encounter_id=NEW.id AND e.record_version=NEW.record_version AND e.performed_by=NEW.updated_by AND e.record_snapshot=clinical_record_snapshot(NEW)) THEN
 RAISE EXCEPTION 'La modificación clínica necesita su versión auditada'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER clinical_encounter_audit AFTER INSERT OR UPDATE ON clinical_encounters DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_clinical_audit();
CREATE FUNCTION protect_clinical_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'El historial clínico y las adendas son inmutables'; END $$;
CREATE TRIGGER clinical_events_immutable BEFORE UPDATE OR DELETE ON clinical_encounter_events FOR EACH ROW EXECUTE FUNCTION protect_clinical_history();
CREATE TRIGGER clinical_addenda_immutable BEFORE UPDATE OR DELETE ON clinical_encounter_addenda FOR EACH ROW EXECUTE FUNCTION protect_clinical_history();
CREATE TRIGGER medical_revisions_immutable BEFORE UPDATE OR DELETE ON medical_record_revisions FOR EACH ROW EXECUTE FUNCTION protect_clinical_history();
CREATE TRIGGER medical_events_immutable BEFORE UPDATE OR DELETE ON medical_record_events FOR EACH ROW EXECUTE FUNCTION protect_clinical_history();
CREATE FUNCTION check_clinical_addendum() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM clinical_encounters WHERE id=NEW.encounter_id AND status='FINALIZED' AND professional_id=NEW.authored_by) THEN
 RAISE EXCEPTION 'La adenda requiere una atención finalizada y su profesional responsable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER clinical_addendum_guard BEFORE INSERT ON clinical_encounter_addenda FOR EACH ROW EXECUTE FUNCTION check_clinical_addendum();
CREATE FUNCTION protect_finalized_prescription() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE encounter_status VARCHAR(20);
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Las prescripciones clínicas se conservan'; END IF;
 SELECT status INTO encounter_status FROM clinical_encounters WHERE id=OLD.encounter_id FOR SHARE;
 IF NEW.encounter_id<>OLD.encounter_id OR NEW.issued_by<>OLD.issued_by OR NEW.version<>OLD.version OR NEW.issued_at<>OLD.issued_at THEN RAISE EXCEPTION 'La identidad de la prescripción es inmutable'; END IF;
 IF encounter_status='FINALIZED' AND (NEW.right_sphere<>OLD.right_sphere OR NEW.left_sphere<>OLD.left_sphere OR NEW.right_cylinder<>OLD.right_cylinder OR NEW.left_cylinder<>OLD.left_cylinder
 OR NEW.right_axis IS DISTINCT FROM OLD.right_axis OR NEW.left_axis IS DISTINCT FROM OLD.left_axis OR NEW.right_addition IS DISTINCT FROM OLD.right_addition OR NEW.left_addition IS DISTINCT FROM OLD.left_addition
 OR NEW.pupillary_distance IS DISTINCT FROM OLD.pupillary_distance OR NEW.fulfillment_notes IS DISTINCT FROM OLD.fulfillment_notes) THEN RAISE EXCEPTION 'La prescripción emitida requiere una versión de reemplazo'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER finalized_prescription_guard BEFORE UPDATE OR DELETE ON optical_prescriptions FOR EACH ROW EXECUTE FUNCTION protect_finalized_prescription();
INSERT INTO permissions(code,description) VALUES('medical_records.assign_care','Asignar profesional a paciente sin acceder a su contenido clínico');
INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.code IN ('ADMIN','SALES') AND p.code='medical_records.assign_care';
