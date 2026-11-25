ALTER TABLE appointments ADD COLUMN branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT ON UPDATE NO ACTION;
CREATE INDEX appointments_branch_scope_idx ON appointments(branch_id, professional_id, start_at);
ALTER TABLE clinical_encounters ADD COLUMN branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT ON UPDATE NO ACTION;
CREATE INDEX clinical_encounters_branch_scope_idx ON clinical_encounters(branch_id, patient_id, finalized_at);
ALTER TABLE clinical_care_assignments ADD COLUMN branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT ON UPDATE NO ACTION;
CREATE INDEX clinical_care_assignments_branch_scope_idx ON clinical_care_assignments(branch_id, professional_id, patient_id);
ALTER TABLE medical_records ADD COLUMN branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE professional_weekly_schedules ADD COLUMN branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE professional_schedule_overrides ADD COLUMN branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE professional_schedule_blocks ADD COLUMN branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT ON UPDATE NO ACTION;
CREATE INDEX professional_schedule_blocks_branch_scope_idx ON professional_schedule_blocks(branch_id, professional_id, start_at);
ALTER TABLE external_prescriptions ADD COLUMN branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT ON UPDATE NO ACTION;
CREATE INDEX external_prescriptions_branch_scope_idx ON external_prescriptions(branch_id, customer_id, created_at);

ALTER TABLE medical_records DROP CONSTRAINT medical_records_patient_id_key;
ALTER TABLE medical_records ADD UNIQUE (patient_id, branch_id);
CREATE UNIQUE INDEX medical_records_unassigned_patient_idx ON medical_records(patient_id) WHERE branch_id IS NULL;

ALTER TABLE professional_weekly_schedules DROP CONSTRAINT professional_weekly_schedules_professional_id_day_of_week_key;
ALTER TABLE professional_weekly_schedules ADD UNIQUE (professional_id, branch_id, day_of_week);
CREATE UNIQUE INDEX weekly_schedule_unassigned_idx ON professional_weekly_schedules(professional_id, day_of_week) WHERE branch_id IS NULL;

ALTER TABLE professional_schedule_overrides DROP CONSTRAINT professional_schedule_overrides_professional_id_date_key;
ALTER TABLE professional_schedule_overrides ADD UNIQUE (professional_id, branch_id, date);
CREATE UNIQUE INDEX overrides_unassigned_idx ON professional_schedule_overrides(professional_id, date) WHERE branch_id IS NULL;

DROP INDEX clinical_care_active;
CREATE UNIQUE INDEX clinical_care_active ON clinical_care_assignments(patient_id, professional_id, branch_id) WHERE revoked_at IS NULL AND branch_id IS NOT NULL;
CREATE UNIQUE INDEX clinical_care_active_unassigned_idx ON clinical_care_assignments(patient_id, professional_id) WHERE revoked_at IS NULL AND branch_id IS NULL;

CREATE FUNCTION protect_clinical_branch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
    RAISE EXCEPTION 'La sucursal de la operación clínica es inmutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER clinical_assignment_branch_guard BEFORE UPDATE ON clinical_care_assignments FOR EACH ROW EXECUTE FUNCTION protect_clinical_branch();
CREATE TRIGGER clinical_encounter_branch_guard BEFORE UPDATE ON clinical_encounters FOR EACH ROW EXECUTE FUNCTION protect_clinical_branch();
CREATE TRIGGER medical_record_branch_guard BEFORE UPDATE ON medical_records FOR EACH ROW EXECUTE FUNCTION protect_clinical_branch();
