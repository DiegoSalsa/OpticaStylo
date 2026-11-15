ALTER TABLE customer_accounts ADD COLUMN birth_date DATE;
ALTER TABLE customer_accounts ADD CONSTRAINT customer_accounts_adult_birth_date
  CHECK (birth_date IS NULL OR birth_date <= (CURRENT_DATE - INTERVAL '18 years')::date);

CREATE TABLE customer_dependants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES customer_accounts(id) ON DELETE RESTRICT,
  patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
  rut VARCHAR(10) NOT NULL,
  first_names VARCHAR(150) NOT NULL,
  last_names VARCHAR(150) NOT NULL,
  birth_date DATE NOT NULL,
  relationship VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT customer_dependants_identity UNIQUE (account_id, rut)
);
CREATE INDEX customer_dependants_patient ON customer_dependants(patient_id);

ALTER TABLE patient_guardians ADD COLUMN account_id UUID REFERENCES customer_accounts(id) ON DELETE SET NULL;
CREATE INDEX patient_guardians_account ON patient_guardians(account_id) WHERE account_id IS NOT NULL;

ALTER TABLE external_prescriptions ADD COLUMN dependant_id UUID REFERENCES customer_dependants(id) ON DELETE RESTRICT;
CREATE INDEX external_prescriptions_dependant ON external_prescriptions(dependant_id) WHERE dependant_id IS NOT NULL;

ALTER TABLE customer_patient_link_challenges
  ADD COLUMN dependant_id UUID REFERENCES customer_dependants(id) ON DELETE CASCADE,
  ADD COLUMN recipient_email VARCHAR(254);
CREATE INDEX customer_patient_link_challenges_dependant ON customer_patient_link_challenges(dependant_id) WHERE dependant_id IS NOT NULL;
