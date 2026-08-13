-- Crear las entidades para los datos básicos permanentes de pacientes.
CREATE TABLE patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rut VARCHAR(10) NOT NULL UNIQUE,
  first_names VARCHAR(150) NOT NULL,
  last_names VARCHAR(150) NOT NULL,
  birth_date DATE NOT NULL,
  phone VARCHAR(16) NOT NULL,
  email VARCHAR(254) NOT NULL,
  address VARCHAR(500) NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT patients_rut_format CHECK (rut ~ '^[0-9]{1,8}-[0-9K]$'),
  CONSTRAINT patients_first_names_normalized CHECK (
    first_names = btrim(first_names) AND first_names <> ''
  ),
  CONSTRAINT patients_last_names_normalized CHECK (
    last_names = btrim(last_names) AND last_names <> ''
  ),
  CONSTRAINT patients_phone_format CHECK (phone ~ '^\+?[0-9]{8,15}$'),
  CONSTRAINT patients_email_normalized CHECK (
    email = lower(btrim(email)) AND email <> ''
  ),
  CONSTRAINT patients_address_normalized CHECK (
    address = btrim(address) AND address <> ''
  )
);

CREATE INDEX patients_name_index ON patients (last_names, first_names);
CREATE INDEX patients_email_index ON patients (email);

CREATE TRIGGER patients_set_updated_at
BEFORE UPDATE ON patients
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

-- Por ahora cada paciente menor de edad utiliza un único responsable.
CREATE TABLE patient_guardians (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL UNIQUE REFERENCES patients(id) ON DELETE RESTRICT,
  rut VARCHAR(10) NOT NULL,
  first_names VARCHAR(150) NOT NULL,
  last_names VARCHAR(150) NOT NULL,
  relationship VARCHAR(100) NOT NULL,
  phone VARCHAR(16) NOT NULL,
  email VARCHAR(254) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT patient_guardians_rut_format CHECK (
    rut ~ '^[0-9]{1,8}-[0-9K]$'
  ),
  CONSTRAINT patient_guardians_first_names_normalized CHECK (
    first_names = btrim(first_names) AND first_names <> ''
  ),
  CONSTRAINT patient_guardians_last_names_normalized CHECK (
    last_names = btrim(last_names) AND last_names <> ''
  ),
  CONSTRAINT patient_guardians_relationship_normalized CHECK (
    relationship = btrim(relationship) AND relationship <> ''
  ),
  CONSTRAINT patient_guardians_phone_format CHECK (
    phone ~ '^\+?[0-9]{8,15}$'
  ),
  CONSTRAINT patient_guardians_email_normalized CHECK (
    email = lower(btrim(email)) AND email <> ''
  )
);

CREATE INDEX patient_guardians_rut_index ON patient_guardians (rut);

CREATE TRIGGER patient_guardians_set_updated_at
BEFORE UPDATE ON patient_guardians
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();
