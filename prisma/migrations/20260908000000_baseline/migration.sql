-- Prisma baseline consolidado desde las 32 migraciones históricas de Optica Stylo.
-- Este archivo se aplica únicamente a bases nuevas; las bases existentes se marcan como baseline.

-- Fuente histórica: 001_create_authentication_schema.sql
-- Crear las entidades base de autenticación y autorización.
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(254) NOT NULL,
  password_hash TEXT NOT NULL CHECK (length(password_hash) >= 20),
  first_name VARCHAR(100) NOT NULL CHECK (first_name = btrim(first_name) AND first_name <> ''),
  last_name VARCHAR(100) NOT NULL CHECK (last_name = btrim(last_name) AND last_name <> ''),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  failed_login_attempts SMALLINT NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0),
  locked_until TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  password_changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT users_email_normalized CHECK (email = lower(btrim(email)) AND email <> '')
);

CREATE UNIQUE INDEX users_email_unique ON users (lower(email));
CREATE INDEX users_active_index ON users (is_active);

CREATE TABLE roles (
  id SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT roles_code_format CHECK (code ~ '^[A-Z][A-Z0-9_]*$')
);

CREATE TABLE permissions (
  id SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code VARCHAR(100) NOT NULL UNIQUE,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT permissions_code_format CHECK (
    code ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'
  )
);

CREATE TABLE user_roles (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id SMALLINT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, role_id)
);

CREATE INDEX user_roles_role_index ON user_roles (role_id);

CREATE TABLE role_permissions (
  role_id SMALLINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id SMALLINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE INDEX role_permissions_permission_index ON role_permissions (permission_id);

CREATE TABLE user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMPTZ,
  created_ip INET,
  user_agent VARCHAR(512),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT user_sessions_token_hash_format CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT user_sessions_expiration_check CHECK (expires_at > created_at),
  CONSTRAINT user_sessions_revocation_check CHECK (
    revoked_at IS NULL OR revoked_at >= created_at
  )
);

CREATE INDEX user_sessions_user_index ON user_sessions (user_id);
CREATE INDEX user_sessions_expiration_index ON user_sessions (expires_at);
CREATE INDEX user_sessions_active_user_index
  ON user_sessions (user_id, expires_at)
  WHERE revoked_at IS NULL;

-- Mantener updated_at bajo control de PostgreSQL para evitar omisiones.
CREATE FUNCTION set_updated_at_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

INSERT INTO roles (code, name, description) VALUES
  ('ADMIN', 'Administrador', 'Gestiona usuarios, agenda, operaciones y reportes sin acceso clínico.'),
  ('CLINICAL_PROFESSIONAL', 'Profesional clínico', 'Gestiona sus atenciones, fichas clínicas y recetas autorizadas.'),
  ('SALES', 'Ventas', 'Gestiona reservas, datos básicos, ventas y recetas necesarias para vender.');

INSERT INTO permissions (code, description) VALUES
  ('appointments.cancel', 'Cancelar reservas.'),
  ('appointments.create', 'Crear reservas.'),
  ('appointments.read_all', 'Consultar todas las reservas.'),
  ('appointments.read_own', 'Consultar las reservas asignadas al profesional.'),
  ('appointments.update', 'Modificar reservas.'),
  ('appointments.update_own_status', 'Actualizar el estado de reservas propias.'),
  ('medical_records.read_assigned', 'Consultar fichas clínicas de pacientes asignados.'),
  ('medical_records.write_assigned', 'Registrar información clínica de pacientes asignados.'),
  ('patients.manage_basic', 'Crear y actualizar datos básicos de pacientes.'),
  ('patients.read_basic', 'Consultar datos básicos de pacientes.'),
  ('prescriptions.create', 'Crear recetas ópticas.'),
  ('prescriptions.read_assigned', 'Consultar recetas vinculadas a atenciones asignadas.'),
  ('prescriptions.read_for_sale', 'Consultar los datos de una receta necesarios para una venta.'),
  ('reports.read', 'Consultar reportes administrativos y comerciales.'),
  ('sales.create', 'Registrar ventas.'),
  ('sales.read', 'Consultar ventas.'),
  ('sales.update', 'Actualizar ventas según sus reglas de negocio.'),
  ('schedules.manage_all', 'Gestionar la disponibilidad de todos los profesionales.'),
  ('schedules.manage_own', 'Gestionar la disponibilidad propia.'),
  ('schedules.read', 'Consultar disponibilidad profesional.'),
  ('users.assign_roles', 'Asignar roles permitidos a usuarios.'),
  ('users.create', 'Crear usuarios internos.'),
  ('users.deactivate', 'Desactivar usuarios internos.'),
  ('users.read', 'Consultar usuarios internos.'),
  ('users.update', 'Actualizar usuarios internos.');

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM (
  VALUES
    ('ADMIN', 'users.read'),
    ('ADMIN', 'users.create'),
    ('ADMIN', 'users.update'),
    ('ADMIN', 'users.deactivate'),
    ('ADMIN', 'users.assign_roles'),
    ('ADMIN', 'schedules.read'),
    ('ADMIN', 'schedules.manage_all'),
    ('ADMIN', 'appointments.read_all'),
    ('ADMIN', 'appointments.create'),
    ('ADMIN', 'appointments.update'),
    ('ADMIN', 'appointments.cancel'),
    ('ADMIN', 'patients.read_basic'),
    ('ADMIN', 'patients.manage_basic'),
    ('ADMIN', 'sales.read'),
    ('ADMIN', 'sales.create'),
    ('ADMIN', 'sales.update'),
    ('ADMIN', 'reports.read'),
    ('CLINICAL_PROFESSIONAL', 'schedules.read'),
    ('CLINICAL_PROFESSIONAL', 'schedules.manage_own'),
    ('CLINICAL_PROFESSIONAL', 'appointments.read_own'),
    ('CLINICAL_PROFESSIONAL', 'appointments.update_own_status'),
    ('CLINICAL_PROFESSIONAL', 'patients.read_basic'),
    ('CLINICAL_PROFESSIONAL', 'medical_records.read_assigned'),
    ('CLINICAL_PROFESSIONAL', 'medical_records.write_assigned'),
    ('CLINICAL_PROFESSIONAL', 'prescriptions.read_assigned'),
    ('CLINICAL_PROFESSIONAL', 'prescriptions.create'),
    ('SALES', 'schedules.read'),
    ('SALES', 'appointments.read_all'),
    ('SALES', 'appointments.create'),
    ('SALES', 'appointments.update'),
    ('SALES', 'appointments.cancel'),
    ('SALES', 'patients.read_basic'),
    ('SALES', 'patients.manage_basic'),
    ('SALES', 'prescriptions.read_for_sale'),
    ('SALES', 'sales.read'),
    ('SALES', 'sales.create'),
    ('SALES', 'sales.update')
) AS policy(role_code, permission_code)
JOIN roles ON roles.code = policy.role_code
JOIN permissions ON permissions.code = policy.permission_code;


-- Fuente histórica: 002_create_patients_schema.sql
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


-- Fuente histórica: 003_create_professional_profiles.sql
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


-- Fuente histórica: 004_create_professional_schedules.sql
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


-- Fuente histórica: 005_create_appointments.sql
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


-- Fuente histórica: 006_create_clinical_records.sql
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


-- Fuente histórica: 007_create_commercial_schema.sql
-- Crear clientes, catálogo comercial, ventas, abonos e historial de operaciones.
INSERT INTO permissions (code, description) VALUES
  ('customers.read', 'Consultar clientes comerciales.'),
  ('customers.manage', 'Crear y actualizar clientes comerciales.'),
  ('products.read', 'Consultar el catálogo de productos.'),
  ('products.manage', 'Crear y actualizar el catálogo y sus precios.'),
  ('sales.payments_register', 'Registrar abonos y pagos de ventas.');

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM (
  VALUES
    ('ADMIN', 'customers.read'),
    ('ADMIN', 'customers.manage'),
    ('ADMIN', 'products.read'),
    ('ADMIN', 'products.manage'),
    ('ADMIN', 'sales.payments_register'),
    ('SALES', 'customers.read'),
    ('SALES', 'customers.manage'),
    ('SALES', 'products.read'),
    ('SALES', 'sales.payments_register')
) AS policy(role_code, permission_code)
JOIN roles ON roles.code = policy.role_code
JOIN permissions ON permissions.code = policy.permission_code;

CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID UNIQUE REFERENCES patients(id) ON DELETE RESTRICT,
  rut VARCHAR(10) NOT NULL UNIQUE,
  first_names VARCHAR(150) NOT NULL,
  last_names VARCHAR(150) NOT NULL,
  phone VARCHAR(16) NOT NULL,
  email VARCHAR(254) NOT NULL,
  address VARCHAR(500) NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT customers_rut_format CHECK (rut ~ '^[0-9]{1,8}-[0-9K]$'),
  CONSTRAINT customers_names_normalized CHECK (
    first_names = btrim(first_names)
    AND first_names <> ''
    AND last_names = btrim(last_names)
    AND last_names <> ''
  ),
  CONSTRAINT customers_phone_format CHECK (phone ~ '^\+?[0-9]{8,15}$'),
  CONSTRAINT customers_email_normalized CHECK (
    email = lower(btrim(email)) AND email <> ''
  ),
  CONSTRAINT customers_address_normalized CHECK (
    address = btrim(address) AND address <> ''
  )
);

CREATE INDEX customers_name_index ON customers (last_names, first_names);
CREATE INDEX customers_email_index ON customers (email);

CREATE TRIGGER customers_set_updated_at
BEFORE UPDATE ON customers
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku VARCHAR(80) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  category VARCHAR(30) NOT NULL,
  requires_prescription BOOLEAN NOT NULL DEFAULT FALSE,
  unit_price_cents BIGINT NOT NULL CHECK (unit_price_cents > 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT products_sku_normalized CHECK (
    sku = upper(btrim(sku)) AND sku <> ''
  ),
  CONSTRAINT products_name_normalized CHECK (
    name = btrim(name) AND name <> ''
  ),
  CONSTRAINT products_category CHECK (
    category IN ('FRAME', 'PRESCRIPTION_LENS', 'OTHER')
  )
);

CREATE INDEX products_active_category_index
  ON products (is_active, category, name);

CREATE TRIGGER products_set_updated_at
BEFORE UPDATE ON products
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

CREATE TABLE product_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  event_type VARCHAR(20) NOT NULL,
  changed_fields TEXT[] NOT NULL DEFAULT '{}',
  performed_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT product_events_type CHECK (event_type IN ('CREATED', 'UPDATED'))
);

CREATE INDEX product_events_product_index
  ON product_events (product_id, created_at, id);

CREATE TABLE sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_number BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  prescription_id UUID REFERENCES optical_prescriptions(id) ON DELETE RESTRICT,
  status VARCHAR(30) NOT NULL DEFAULT 'QUOTATION',
  payment_method VARCHAR(30),
  subtotal_cents BIGINT NOT NULL CHECK (subtotal_cents > 0),
  total_cents BIGINT NOT NULL CHECK (total_cents > 0),
  cancellation_reason VARCHAR(500),
  cancelled_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT sales_status CHECK (
    status IN (
      'QUOTATION',
      'PENDING',
      'PAID',
      'IN_PREPARATION',
      'READY',
      'DELIVERED',
      'CANCELLED'
    )
  ),
  CONSTRAINT sales_payment_method CHECK (
    payment_method IS NULL
    OR payment_method IN (
      'CASH',
      'BANK_TRANSFER',
      'MERCADO_PAGO',
      'TRANSBANK',
      'GETNET'
    )
  ),
  CONSTRAINT sales_total_consistency CHECK (subtotal_cents = total_cents),
  CONSTRAINT sales_cancellation_consistency CHECK (
    (
      status = 'CANCELLED'
      AND cancelled_at IS NOT NULL
      AND cancellation_reason IS NOT NULL
      AND char_length(cancellation_reason) BETWEEN 1 AND 500
    )
    OR (
      status <> 'CANCELLED'
      AND cancelled_at IS NULL
      AND cancellation_reason IS NULL
    )
  )
);

CREATE INDEX sales_customer_date_index ON sales (customer_id, created_at DESC);
CREATE INDEX sales_status_date_index ON sales (status, created_at DESC);
CREATE INDEX sales_prescription_index
  ON sales (prescription_id)
  WHERE prescription_id IS NOT NULL;

CREATE TRIGGER sales_set_updated_at
BEFORE UPDATE ON sales
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

CREATE TABLE sale_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_sku VARCHAR(80) NOT NULL,
  product_name VARCHAR(200) NOT NULL,
  product_category VARCHAR(30) NOT NULL,
  requires_prescription BOOLEAN NOT NULL,
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 100),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 1000),
  unit_price_cents BIGINT NOT NULL CHECK (unit_price_cents > 0),
  line_total_cents BIGINT GENERATED ALWAYS AS (quantity * unit_price_cents) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT sale_items_product_unique UNIQUE (sale_id, product_id),
  CONSTRAINT sale_items_position_unique UNIQUE (sale_id, position)
);

CREATE INDEX sale_items_sale_index ON sale_items (sale_id, position);

CREATE TABLE sale_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  payment_method VARCHAR(30) NOT NULL,
  reference VARCHAR(200),
  received_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT sale_payments_method CHECK (
    payment_method IN (
      'CASH',
      'BANK_TRANSFER',
      'MERCADO_PAGO',
      'TRANSBANK',
      'GETNET'
    )
  ),
  CONSTRAINT sale_payments_reference_normalized CHECK (
    reference IS NULL
    OR (reference = btrim(reference) AND reference <> '')
  )
);

CREATE INDEX sale_payments_sale_index
  ON sale_payments (sale_id, paid_at, id);

CREATE TABLE sale_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  event_type VARCHAR(30) NOT NULL,
  previous_status VARCHAR(30),
  new_status VARCHAR(30),
  details TEXT,
  performed_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT sale_events_type CHECK (
    event_type IN (
      'CREATED',
      'UPDATED',
      'STATUS_CHANGED',
      'PAYMENT_REGISTERED',
      'CANCELLED'
    )
  )
);

CREATE INDEX sale_events_sale_index
  ON sale_events (sale_id, created_at, id);


-- Fuente histórica: 008_create_mercado_pago_checkout.sql
-- Integrar Checkout Pro mediante intentos idempotentes y webhooks auditables.
INSERT INTO permissions (code, description) VALUES
  ('sales.mercado_pago_checkout', 'Crear cobros de Checkout Pro para ventas pendientes.');

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM (
  VALUES
    ('ADMIN', 'sales.mercado_pago_checkout'),
    ('SALES', 'sales.mercado_pago_checkout')
) AS policy(role_code, permission_code)
JOIN roles ON roles.code = policy.role_code
JOIN permissions ON permissions.code = policy.permission_code;

CREATE TABLE payment_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  provider VARCHAR(30) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'CREATED',
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'CLP',
  idempotency_key UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  external_preference_id VARCHAR(200) UNIQUE,
  external_payment_id VARCHAR(200) UNIQUE,
  checkout_url TEXT,
  sandbox_checkout_url TEXT,
  provider_status VARCHAR(100),
  provider_status_detail VARCHAR(200),
  failure_reason VARCHAR(500),
  initiated_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT payment_attempts_provider CHECK (provider IN ('MERCADO_PAGO')),
  CONSTRAINT payment_attempts_status CHECK (
    status IN (
      'CREATED',
      'PENDING',
      'APPROVED',
      'REJECTED',
      'CANCELLED',
      'FAILED',
      'REQUIRES_REVIEW'
    )
  ),
  CONSTRAINT payment_attempts_currency CHECK (currency = 'CLP'),
  CONSTRAINT payment_attempts_external_data CHECK (
    (
      external_preference_id IS NULL
      AND checkout_url IS NULL
      AND sandbox_checkout_url IS NULL
    )
    OR (
      external_preference_id IS NOT NULL
      AND checkout_url IS NOT NULL
    )
  ),
  CONSTRAINT payment_attempts_expiration CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX payment_attempts_active_sale_provider_index
  ON payment_attempts (sale_id, provider)
  WHERE status IN ('CREATED', 'PENDING', 'APPROVED');

CREATE INDEX payment_attempts_sale_date_index
  ON payment_attempts (sale_id, created_at DESC);

CREATE TRIGGER payment_attempts_set_updated_at
BEFORE UPDATE ON payment_attempts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

ALTER TABLE sale_payments
  ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN provider_attempt_id UUID UNIQUE
    REFERENCES payment_attempts(id) ON DELETE RESTRICT,
  ALTER COLUMN received_by DROP NOT NULL,
  ADD CONSTRAINT sale_payments_source CHECK (source IN ('MANUAL', 'PROVIDER')),
  ADD CONSTRAINT sale_payments_source_consistency CHECK (
    (source = 'MANUAL' AND provider_attempt_id IS NULL AND received_by IS NOT NULL)
    OR (source = 'PROVIDER' AND provider_attempt_id IS NOT NULL)
  );

ALTER TABLE sale_events
  ALTER COLUMN performed_by DROP NOT NULL,
  DROP CONSTRAINT sale_events_type,
  ADD CONSTRAINT sale_events_type CHECK (
    event_type IN (
      'CREATED',
      'UPDATED',
      'STATUS_CHANGED',
      'PAYMENT_REGISTERED',
      'PAYMENT_STATUS_CHANGED',
      'CANCELLED'
    )
  );

CREATE TABLE payment_provider_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider VARCHAR(30) NOT NULL,
  request_id VARCHAR(200) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  external_object_id VARCHAR(200) NOT NULL,
  payload JSONB NOT NULL,
  processing_status VARCHAR(20) NOT NULL DEFAULT 'RECEIVED',
  processing_error VARCHAR(500),
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMPTZ,
  CONSTRAINT payment_provider_events_provider CHECK (provider IN ('MERCADO_PAGO')),
  CONSTRAINT payment_provider_events_processing_status CHECK (
    processing_status IN ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED')
  ),
  CONSTRAINT payment_provider_events_request_unique UNIQUE (provider, request_id)
);

CREATE INDEX payment_provider_events_object_index
  ON payment_provider_events (provider, external_object_id, received_at DESC);


-- Fuente histórica: 009_create_ecommerce_schema.sql
-- Crear cuentas de compradores, carritos, entrega y recetas externas.
ALTER TABLE customers
  ALTER COLUMN created_by DROP NOT NULL,
  ALTER COLUMN updated_by DROP NOT NULL;

CREATE TABLE customer_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL UNIQUE REFERENCES customers(id) ON DELETE RESTRICT,
  email VARCHAR(254) NOT NULL,
  password_hash TEXT NOT NULL CHECK (length(password_hash) >= 20),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  failed_login_attempts SMALLINT NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0),
  locked_until TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  password_changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT customer_accounts_email_normalized CHECK (
    email = lower(btrim(email)) AND email <> ''
  )
);

CREATE UNIQUE INDEX customer_accounts_email_unique
  ON customer_accounts (lower(email));

CREATE TRIGGER customer_accounts_set_updated_at
BEFORE UPDATE ON customer_accounts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

CREATE TABLE customer_account_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMPTZ,
  created_ip INET,
  user_agent VARCHAR(512),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT customer_account_sessions_token_hash CHECK (
    token_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT customer_account_sessions_expiration CHECK (expires_at > created_at),
  CONSTRAINT customer_account_sessions_revocation CHECK (
    revoked_at IS NULL OR revoked_at >= created_at
  )
);

CREATE INDEX customer_account_sessions_account_index
  ON customer_account_sessions (account_id);
CREATE INDEX customer_account_sessions_expiration_index
  ON customer_account_sessions (expires_at);

ALTER TABLE products DROP CONSTRAINT products_category;
ALTER TABLE products ADD CONSTRAINT products_category CHECK (
  category IN (
    'FRAME',
    'PRESCRIPTION_LENS',
    'TREATMENT',
    'ACCESSORY',
    'OTHER'
  )
);

CREATE TABLE store_carts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash CHAR(64) NOT NULL UNIQUE,
  customer_account_id UUID REFERENCES customer_accounts(id) ON DELETE RESTRICT,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  buyer_rut VARCHAR(10),
  buyer_first_names VARCHAR(150),
  buyer_last_names VARCHAR(150),
  buyer_phone VARCHAR(16),
  buyer_email VARCHAR(254),
  buyer_address VARCHAR(500),
  fulfillment_method VARCHAR(20),
  delivery_address VARCHAR(500),
  delivery_city VARCHAR(120),
  delivery_region VARCHAR(120),
  delivery_notes VARCHAR(500),
  shipping_fee_cents BIGINT NOT NULL DEFAULT 0 CHECK (shipping_fee_cents >= 0),
  shipping_quote_source VARCHAR(20),
  clinical_prescription_id UUID REFERENCES optical_prescriptions(id) ON DELETE RESTRICT,
  sale_id UUID UNIQUE REFERENCES sales(id) ON DELETE RESTRICT,
  expires_at TIMESTAMPTZ NOT NULL,
  checked_out_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT store_carts_token_hash CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT store_carts_status CHECK (
    status IN ('ACTIVE', 'CHECKED_OUT', 'ABANDONED')
  ),
  CONSTRAINT store_carts_fulfillment CHECK (
    fulfillment_method IS NULL OR fulfillment_method IN ('PICKUP', 'DELIVERY')
  ),
  CONSTRAINT store_carts_shipping_source CHECK (
    shipping_quote_source IS NULL OR shipping_quote_source IN ('MOCK', 'EXTERNAL')
  ),
  CONSTRAINT store_carts_prescription_choice CHECK (
    clinical_prescription_id IS NULL OR customer_account_id IS NOT NULL
  ),
  CONSTRAINT store_carts_checkout_consistency CHECK (
    (
      status = 'CHECKED_OUT'
      AND sale_id IS NOT NULL
      AND checked_out_at IS NOT NULL
      AND buyer_rut IS NOT NULL
      AND buyer_first_names IS NOT NULL
      AND buyer_last_names IS NOT NULL
      AND buyer_phone IS NOT NULL
      AND buyer_email IS NOT NULL
      AND buyer_address IS NOT NULL
      AND fulfillment_method IS NOT NULL
    )
    OR (
      status <> 'CHECKED_OUT'
      AND sale_id IS NULL
      AND checked_out_at IS NULL
    )
  ),
  CONSTRAINT store_carts_delivery_consistency CHECK (
    fulfillment_method <> 'DELIVERY'
    OR (
      delivery_address IS NOT NULL
      AND delivery_city IS NOT NULL
      AND delivery_region IS NOT NULL
      AND shipping_quote_source IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX store_carts_active_account_index
  ON store_carts (customer_account_id)
  WHERE customer_account_id IS NOT NULL AND status = 'ACTIVE';
CREATE INDEX store_carts_expiration_index
  ON store_carts (status, expires_at);

CREATE TRIGGER store_carts_set_updated_at
BEFORE UPDATE ON store_carts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

CREATE TABLE store_cart_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id UUID NOT NULL REFERENCES store_carts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT store_cart_items_product_unique UNIQUE (cart_id, product_id)
);

CREATE INDEX store_cart_items_cart_index
  ON store_cart_items (cart_id, created_at, id);

CREATE TRIGGER store_cart_items_set_updated_at
BEFORE UPDATE ON store_cart_items
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

CREATE TABLE external_prescriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id UUID NOT NULL UNIQUE REFERENCES store_carts(id) ON DELETE CASCADE,
  source VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  original_filename VARCHAR(255),
  media_type VARCHAR(100),
  file_size_bytes INTEGER,
  file_sha256 CHAR(64),
  file_data BYTEA,
  extraction_status VARCHAR(30) NOT NULL DEFAULT 'NOT_REQUESTED',
  extraction_provider VARCHAR(50),
  extracted_data JSONB,
  confirmed_data JSONB,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT external_prescriptions_source CHECK (source IN ('MANUAL', 'IMAGE')),
  CONSTRAINT external_prescriptions_status CHECK (status IN ('DRAFT', 'READY')),
  CONSTRAINT external_prescriptions_extraction_status CHECK (
    extraction_status IN (
      'NOT_REQUESTED', 'PENDING', 'COMPLETED', 'FAILED', 'NOT_CONFIGURED'
    )
  ),
  CONSTRAINT external_prescriptions_file_hash CHECK (
    file_sha256 IS NULL OR file_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT external_prescriptions_source_consistency CHECK (
    (
      source = 'MANUAL'
      AND file_data IS NULL
      AND original_filename IS NULL
      AND media_type IS NULL
      AND file_size_bytes IS NULL
      AND file_sha256 IS NULL
    )
    OR (
      source = 'IMAGE'
      AND file_data IS NOT NULL
      AND original_filename IS NOT NULL
      AND media_type IS NOT NULL
      AND file_size_bytes > 0
      AND file_sha256 IS NOT NULL
    )
  ),
  CONSTRAINT external_prescriptions_ready_consistency CHECK (
    (
      status = 'READY'
      AND confirmed_data IS NOT NULL
      AND confirmed_at IS NOT NULL
    )
    OR (
      status = 'DRAFT'
      AND confirmed_at IS NULL
    )
  )
);

CREATE INDEX external_prescriptions_status_index
  ON external_prescriptions (status, created_at);

CREATE TRIGGER external_prescriptions_set_updated_at
BEFORE UPDATE ON external_prescriptions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

ALTER TABLE sales
  ADD COLUMN origin VARCHAR(20) NOT NULL DEFAULT 'IN_STORE',
  ADD COLUMN external_prescription_id UUID
    REFERENCES external_prescriptions(id) ON DELETE RESTRICT,
  ADD COLUMN fulfillment_method VARCHAR(20),
  ADD COLUMN delivery_address VARCHAR(500),
  ADD COLUMN delivery_city VARCHAR(120),
  ADD COLUMN delivery_region VARCHAR(120),
  ADD COLUMN delivery_notes VARCHAR(500),
  ADD COLUMN shipping_fee_cents BIGINT NOT NULL DEFAULT 0
    CHECK (shipping_fee_cents >= 0),
  ADD COLUMN shipping_quote_source VARCHAR(20),
  DROP CONSTRAINT sales_total_consistency,
  ADD CONSTRAINT sales_origin CHECK (origin IN ('IN_STORE', 'ONLINE')),
  ADD CONSTRAINT sales_prescription_choice CHECK (
    prescription_id IS NULL OR external_prescription_id IS NULL
  ),
  ADD CONSTRAINT sales_fulfillment CHECK (
    fulfillment_method IS NULL OR fulfillment_method IN ('PICKUP', 'DELIVERY')
  ),
  ADD CONSTRAINT sales_shipping_source CHECK (
    shipping_quote_source IS NULL OR shipping_quote_source IN ('MOCK', 'EXTERNAL')
  ),
  ADD CONSTRAINT sales_total_consistency CHECK (
    subtotal_cents + shipping_fee_cents = total_cents
  ),
  ADD CONSTRAINT sales_online_consistency CHECK (
    origin <> 'ONLINE'
    OR fulfillment_method IS NOT NULL
  ),
  ADD CONSTRAINT sales_delivery_consistency CHECK (
    fulfillment_method <> 'DELIVERY'
    OR (
      delivery_address IS NOT NULL
      AND delivery_city IS NOT NULL
      AND delivery_region IS NOT NULL
      AND shipping_quote_source IS NOT NULL
    )
  );

CREATE INDEX sales_external_prescription_index
  ON sales (external_prescription_id)
  WHERE external_prescription_id IS NOT NULL;
CREATE INDEX sales_origin_date_index
  ON sales (origin, created_at DESC);


-- Fuente histórica: 010_allow_online_sales_without_staff_actor.sql
-- Permitir que una venta en línea se origine sin un usuario interno.
ALTER TABLE sales
  ALTER COLUMN created_by DROP NOT NULL,
  ALTER COLUMN updated_by DROP NOT NULL;


-- Fuente histórica: 011_create_virtual_try_on_assets.sql
-- Registrar versiones inmutables de los recursos usados por la prueba virtual.
CREATE TABLE virtual_try_on_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  original_filename VARCHAR(255) NOT NULL,
  media_type VARCHAR(50) NOT NULL,
  file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes > 0),
  file_sha256 CHAR(64) NOT NULL,
  file_data BYTEA NOT NULL,
  width_scale NUMERIC(5, 3) NOT NULL DEFAULT 2.200,
  vertical_offset NUMERIC(5, 3) NOT NULL DEFAULT 0.000,
  rotation_offset_degrees NUMERIC(5, 2) NOT NULL DEFAULT 0.000,
  notes VARCHAR(500),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  retired_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  retired_at TIMESTAMPTZ,
  CONSTRAINT virtual_try_on_assets_product_version UNIQUE (product_id, version),
  CONSTRAINT virtual_try_on_assets_status CHECK (status IN ('ACTIVE', 'RETIRED')),
  CONSTRAINT virtual_try_on_assets_media_type CHECK (
    media_type IN ('image/png', 'image/webp')
  ),
  CONSTRAINT virtual_try_on_assets_file_hash CHECK (
    file_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT virtual_try_on_assets_width_scale CHECK (
    width_scale BETWEEN 1.200 AND 4.000
  ),
  CONSTRAINT virtual_try_on_assets_vertical_offset CHECK (
    vertical_offset BETWEEN -1.000 AND 1.000
  ),
  CONSTRAINT virtual_try_on_assets_rotation_offset CHECK (
    rotation_offset_degrees BETWEEN -30.000 AND 30.000
  ),
  CONSTRAINT virtual_try_on_assets_retirement CHECK (
    (
      status = 'ACTIVE'
      AND retired_by IS NULL
      AND retired_at IS NULL
    )
    OR (
      status = 'RETIRED'
      AND retired_by IS NOT NULL
      AND retired_at IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX virtual_try_on_assets_active_product_index
  ON virtual_try_on_assets (product_id)
  WHERE status = 'ACTIVE';

CREATE INDEX virtual_try_on_assets_product_history_index
  ON virtual_try_on_assets (product_id, version DESC);


-- Fuente histórica: 012_restrict_sales_to_commercial_operations.sql
UPDATE roles
SET description = 'Registra clientes, cotizaciones, ventas, recetas comerciales y pagos.'
WHERE code = 'SALES';

DELETE FROM role_permissions
WHERE role_id = (SELECT id FROM roles WHERE code = 'SALES')
  AND permission_id IN (
    SELECT id
    FROM permissions
    WHERE code IN (
      'schedules.read',
      'appointments.read_all',
      'appointments.create',
      'appointments.update',
      'appointments.cancel',
      'patients.read_basic',
      'patients.manage_basic'
    )
  );


-- Fuente histórica: 013_enable_public_appointment_booking.sql
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


-- Fuente histórica: 014_add_auditable_sale_discounts.sql
ALTER TABLE sales
  ADD COLUMN discount_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN discount_reason VARCHAR(300);

ALTER TABLE sales
  DROP CONSTRAINT sales_total_consistency,
  ADD CONSTRAINT sales_discount_amount CHECK (
    discount_cents >= 0 AND discount_cents < subtotal_cents
  ),
  ADD CONSTRAINT sales_discount_reason_consistency CHECK (
    (
      discount_cents = 0
      AND discount_reason IS NULL
    )
    OR (
      discount_cents > 0
      AND discount_reason IS NOT NULL
      AND char_length(trim(discount_reason)) BETWEEN 1 AND 300
    )
  ),
  ADD CONSTRAINT sales_total_consistency CHECK (
    total_cents = subtotal_cents - discount_cents
  );

COMMENT ON COLUMN sales.discount_cents IS
  'Descuento manual total aplicado en POS, expresado en pesos chilenos.';

COMMENT ON COLUMN sales.discount_reason IS
  'JustificaciÃ³n auditable exigida cuando la venta tiene descuento.';


-- Fuente histórica: 015_create_3d_virtual_try_on_catalog.sql
CREATE TABLE virtual_try_on_3d_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  original_filename VARCHAR(255) NOT NULL,
  media_type VARCHAR(100) NOT NULL DEFAULT 'model/gltf-binary',
  file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes BETWEEN 1 AND 52428800),
  file_sha256 CHAR(64) NOT NULL,
  model_data BYTEA NOT NULL,
  model_metadata JSONB NOT NULL,
  license_code VARCHAR(40) NOT NULL,
  attribution_text VARCHAR(500),
  source_url VARCHAR(1000),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  retired_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  retired_at TIMESTAMPTZ,
  CONSTRAINT virtual_try_on_3d_status CHECK (status IN ('ACTIVE', 'RETIRED')),
  CONSTRAINT virtual_try_on_3d_media_type CHECK (media_type = 'model/gltf-binary'),
  CONSTRAINT virtual_try_on_3d_hash CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT virtual_try_on_3d_license CHECK (
    license_code IN ('CC0-1.0', 'CC-BY-4.0', 'OWNED_BY_OPTICA_STYLO')
  ),
  CONSTRAINT virtual_try_on_3d_attribution CHECK (
    license_code <> 'CC-BY-4.0'
    OR (attribution_text IS NOT NULL AND char_length(trim(attribution_text)) > 0)
  ),
  CONSTRAINT virtual_try_on_3d_retirement CHECK (
    (status = 'ACTIVE' AND retired_by IS NULL AND retired_at IS NULL)
    OR (status = 'RETIRED' AND retired_by IS NOT NULL AND retired_at IS NOT NULL)
  ),
  UNIQUE (product_id, version)
);

CREATE UNIQUE INDEX virtual_try_on_3d_one_active_per_product
  ON virtual_try_on_3d_assets (product_id)
  WHERE status = 'ACTIVE';

CREATE INDEX virtual_try_on_3d_product_history
  ON virtual_try_on_3d_assets (product_id, version DESC);

COMMENT ON TABLE virtual_try_on_3d_assets IS
  'Catálogo GLB versionado para prueba virtual 3D. Solo admite activos propios o licencias libres aprobadas.';


-- Fuente histórica: 016_create_transactional_email_outbox.sql
CREATE TABLE transactional_email_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_code VARCHAR(60) NOT NULL,
  recipient_email VARCHAR(254) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  deduplication_key VARCHAR(200) NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  attempt_count SMALLINT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error VARCHAR(1000),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT transactional_email_template CHECK (
    template_code IN (
      'ACCOUNT_CREATED',
      'APPOINTMENT_CONFIRMED',
      'APPOINTMENT_REMINDER',
      'ORDER_CONFIRMED',
      'PAYMENT_CONFIRMED'
    )
  ),
  CONSTRAINT transactional_email_status CHECK (
    status IN ('PENDING', 'SENDING', 'SENT', 'FAILED')
  ),
  CONSTRAINT transactional_email_recipient CHECK (
    recipient_email = lower(trim(recipient_email)) AND recipient_email LIKE '%@%'
  ),
  CONSTRAINT transactional_email_sent CHECK (
    (status = 'SENT' AND sent_at IS NOT NULL)
    OR (status <> 'SENT' AND sent_at IS NULL)
  )
);

CREATE INDEX transactional_email_pending
  ON transactional_email_outbox (scheduled_at, created_at)
  WHERE status IN ('PENDING', 'FAILED');

CREATE TRIGGER transactional_email_outbox_set_updated_at
BEFORE UPDATE ON transactional_email_outbox
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

COMMENT ON TABLE transactional_email_outbox IS
  'Cola transaccional independiente del proveedor de correo. No envía nada hasta configurar un adaptador.';


-- Fuente histórica: 017_remove_legacy_2d_virtual_try_on.sql
DROP TABLE IF EXISTS virtual_try_on_assets;


-- Fuente histórica: 018_enable_pos_external_prescriptions.sql
ALTER TABLE external_prescriptions
  ALTER COLUMN cart_id DROP NOT NULL,
  ADD COLUMN customer_id UUID REFERENCES customers(id) ON DELETE RESTRICT,
  ADD COLUMN created_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  ADD CONSTRAINT external_prescriptions_owner CHECK (
    num_nonnulls(cart_id, customer_id) = 1
  );

CREATE INDEX external_prescriptions_customer_index
  ON external_prescriptions (customer_id, created_at DESC)
  WHERE customer_id IS NOT NULL;


-- Fuente histórica: 019_preserve_medical_record_revisions.sql
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


-- Fuente histórica: 020_validate_pupillary_distance.sql
-- Impedir distancias pupilares no positivas sin inventar un rango clínico máximo.
ALTER TABLE optical_prescriptions
  ADD CONSTRAINT optical_prescriptions_positive_pupillary_distance
  CHECK (pupillary_distance IS NULL OR pupillary_distance > 0);


-- Fuente histórica: 021_complete_pos_workflow.sql
-- Completar el POS presencial sobre las capacidades comerciales ya desplegadas.
INSERT INTO permissions (code, description) VALUES
  ('sales.discounts_authorize', 'Autorizar descuentos en ventas presenciales.'),
  ('sales.reports_read', 'Consultar reportes operativos de ventas.');

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM (
  VALUES
    ('ADMIN', 'sales.discounts_authorize'),
    ('ADMIN', 'sales.reports_read'),
    ('SALES', 'patients.read_basic'),
    ('SALES', 'patients.manage_basic'),
    ('SALES', 'sales.reports_read')
) AS policy(role_code, permission_code)
JOIN roles ON roles.code = policy.role_code
JOIN permissions ON permissions.code = policy.permission_code;

ALTER TABLE external_prescriptions
  ADD COLUMN patient_id UUID REFERENCES patients(id) ON DELETE RESTRICT;

CREATE INDEX external_prescriptions_patient_date_index
  ON external_prescriptions (patient_id, created_at DESC)
  WHERE patient_id IS NOT NULL;

ALTER TABLE sales
  ADD COLUMN patient_id UUID REFERENCES patients(id) ON DELETE RESTRICT,
  ADD COLUMN discount_authorized_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN discount_authorized_at TIMESTAMPTZ,
  ADD COLUMN quotation_valid_until TIMESTAMPTZ;

UPDATE sales
SET
  discount_authorized_by = created_by,
  discount_authorized_at = created_at
WHERE discount_cents > 0 AND created_by IS NOT NULL;

UPDATE sales
SET quotation_valid_until = created_at + INTERVAL '30 days'
WHERE status = 'QUOTATION';

ALTER TABLE sales
  DROP CONSTRAINT sales_total_consistency,
  ADD CONSTRAINT sales_total_consistency CHECK (
    total_cents = subtotal_cents + shipping_fee_cents - discount_cents
  ),
  ADD CONSTRAINT sales_discount_authorization_consistency CHECK (
    (
      discount_cents = 0
      AND discount_authorized_by IS NULL
      AND discount_authorized_at IS NULL
    )
    OR (
      discount_cents > 0
      AND discount_authorized_by IS NOT NULL
      AND discount_authorized_at IS NOT NULL
    )
  );

CREATE INDEX sales_patient_date_index
  ON sales (patient_id, created_at DESC)
  WHERE patient_id IS NOT NULL;

CREATE TABLE sale_optical_additions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  name VARCHAR(160) NOT NULL,
  description VARCHAR(500),
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 50),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 100),
  unit_price_cents BIGINT NOT NULL CHECK (unit_price_cents > 0),
  line_total_cents BIGINT GENERATED ALWAYS AS (quantity * unit_price_cents) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT sale_optical_additions_name CHECK (name = btrim(name) AND name <> ''),
  CONSTRAINT sale_optical_additions_description CHECK (
    description IS NULL OR (description = btrim(description) AND description <> '')
  ),
  CONSTRAINT sale_optical_additions_position_unique UNIQUE (sale_id, position)
);

CREATE INDEX sale_optical_additions_sale_index
  ON sale_optical_additions (sale_id, position);

CREATE TABLE sale_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  sale_id UUID NOT NULL UNIQUE REFERENCES sales(id) ON DELETE RESTRICT,
  payload JSONB NOT NULL,
  emailed_to VARCHAR(254),
  email_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  email_provider_id VARCHAR(200),
  email_error VARCHAR(500),
  generated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  email_updated_at TIMESTAMPTZ,
  CONSTRAINT sale_receipts_email_status CHECK (
    email_status IN ('PENDING', 'SENT', 'FAILED', 'SIMULATED')
  ),
  CONSTRAINT sale_receipts_email_normalized CHECK (
    emailed_to IS NULL OR (emailed_to = lower(btrim(emailed_to)) AND emailed_to <> '')
  )
);

CREATE INDEX sale_receipts_issued_at_index ON sale_receipts (issued_at DESC);

ALTER TABLE sale_events
  DROP CONSTRAINT sale_events_type,
  ADD CONSTRAINT sale_events_type CHECK (
    event_type IN (
      'CREATED', 'UPDATED', 'STATUS_CHANGED', 'PAYMENT_REGISTERED',
      'PAYMENT_STATUS_CHANGED', 'DISCOUNT_AUTHORIZED', 'RECEIPT_ISSUED',
      'EMAIL_SENT', 'EMAIL_FAILED', 'CANCELLED'
    )
  );


-- Fuente histórica: 022_harden_pos_payments_receipts.sql
-- Endurecer abonos, comprobantes y autorizaciones de descuentos del POS.
ALTER TABLE sale_receipts
  DROP CONSTRAINT sale_receipts_sale_id_key,
  ADD COLUMN payment_id UUID REFERENCES sale_payments(id) ON DELETE RESTRICT,
  ADD COLUMN receipt_type VARCHAR(20);

UPDATE sale_receipts
SET receipt_type = CASE
  WHEN payload ->> 'status' = 'PAID' THEN 'FINAL'
  ELSE 'PAYMENT'
END;

ALTER TABLE sale_receipts
  ALTER COLUMN receipt_type SET NOT NULL,
  ADD CONSTRAINT sale_receipts_type CHECK (
    receipt_type IN ('PAYMENT', 'FINAL')
  );

CREATE UNIQUE INDEX sale_receipts_payment_unique
  ON sale_receipts (payment_id)
  WHERE payment_id IS NOT NULL;

CREATE UNIQUE INDEX sale_receipts_final_sale_unique
  ON sale_receipts (sale_id)
  WHERE receipt_type = 'FINAL';

CREATE INDEX sale_receipts_sale_date_index
  ON sale_receipts (sale_id, issued_at DESC, receipt_number DESC);

CREATE TABLE discount_authorization_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempted_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  authorizer_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  authorizer_email VARCHAR(254) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ,
  CONSTRAINT discount_authorization_attempts_email CHECK (
    authorizer_email = lower(btrim(authorizer_email))
    AND authorizer_email <> ''
  ),
  CONSTRAINT discount_authorization_attempts_status CHECK (
    status IN ('PENDING', 'SUCCEEDED', 'FAILED', 'RATE_LIMITED')
  ),
  CONSTRAINT discount_authorization_attempts_completion CHECK (
    (status = 'PENDING' AND completed_at IS NULL)
    OR (status <> 'PENDING' AND completed_at IS NOT NULL)
  )
);

CREATE INDEX discount_authorization_attempts_actor_date_index
  ON discount_authorization_attempts (attempted_by, attempted_at DESC);

CREATE INDEX discount_authorization_attempts_email_date_index
  ON discount_authorization_attempts (authorizer_email, attempted_at DESC);

ALTER TABLE sale_events
  DROP CONSTRAINT sale_events_type,
  ADD CONSTRAINT sale_events_type CHECK (
    event_type IN (
      'CREATED', 'UPDATED', 'STATUS_CHANGED', 'PAYMENT_REGISTERED',
      'PAYMENT_STATUS_CHANGED', 'DISCOUNT_AUTHORIZED', 'RECEIPT_ISSUED',
      'EMAIL_SENT', 'EMAIL_FAILED', 'EMAIL_SIMULATED', 'CANCELLED'
    )
  );


-- Fuente histórica: 023_complete_transactional_email_infrastructure.sql
-- Completar la cola transaccional sin activar envíos ni cron de producción.
ALTER TABLE transactional_email_outbox
  DROP CONSTRAINT transactional_email_template,
  DROP CONSTRAINT transactional_email_status,
  DROP CONSTRAINT transactional_email_sent;

UPDATE transactional_email_outbox
SET
  status = 'FAILED',
  last_error = 'Reintento requerido después de actualizar la infraestructura.'
WHERE status = 'SENDING';

ALTER TABLE transactional_email_outbox
  ADD COLUMN next_attempt_at TIMESTAMPTZ,
  ADD COLUMN processing_started_at TIMESTAMPTZ,
  ADD COLUMN processing_finished_at TIMESTAMPTZ,
  ADD COLUMN locked_at TIMESTAMPTZ,
  ADD COLUMN lock_expires_at TIMESTAMPTZ,
  ADD COLUMN locked_by UUID,
  ADD COLUMN provider VARCHAR(30),
  ADD COLUMN provider_message_id VARCHAR(200),
  ADD COLUMN effective_recipient_email VARCHAR(254),
  ADD COLUMN delivery_mode VARCHAR(20),
  ADD COLUMN last_error_code VARCHAR(80),
  ADD COLUMN skip_reason VARCHAR(200),
  ADD COLUMN sale_id UUID REFERENCES sales(id) ON DELETE RESTRICT,
  ADD COLUMN payment_id UUID REFERENCES sale_payments(id) ON DELETE RESTRICT,
  ADD COLUMN receipt_id UUID REFERENCES sale_receipts(id) ON DELETE RESTRICT,
  ADD COLUMN appointment_id UUID REFERENCES appointments(id) ON DELETE RESTRICT,
  ADD COLUMN account_id UUID REFERENCES customer_accounts(id) ON DELETE RESTRICT;

UPDATE transactional_email_outbox
SET
  next_attempt_at = scheduled_at,
  processing_finished_at = CASE
    WHEN status = 'SENT' THEN sent_at
    ELSE NULL
  END;

UPDATE transactional_email_outbox
SET account_id = split_part(deduplication_key, ':', 2)::UUID
WHERE template_code = 'ACCOUNT_CREATED'
  AND split_part(deduplication_key, ':', 2)
    ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

UPDATE transactional_email_outbox
SET appointment_id = (payload ->> 'appointmentId')::UUID
WHERE template_code IN ('APPOINTMENT_CONFIRMED', 'APPOINTMENT_REMINDER')
  AND payload ->> 'appointmentId'
    ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

UPDATE transactional_email_outbox
SET sale_id = (payload ->> 'saleId')::UUID
WHERE template_code = 'PAYMENT_CONFIRMED'
  AND payload ->> 'saleId'
    ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

UPDATE transactional_email_outbox AS outbox
SET payment_id = sale_payments.id,
    sale_id = COALESCE(outbox.sale_id, sale_payments.sale_id)
FROM payment_attempts
JOIN sale_payments ON sale_payments.provider_attempt_id = payment_attempts.id
WHERE outbox.deduplication_key =
  'payment-attempt:' || payment_attempts.id::TEXT || ':approved';

ALTER TABLE transactional_email_outbox
  ALTER COLUMN next_attempt_at SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN next_attempt_at SET NOT NULL,
  ADD CONSTRAINT transactional_email_template CHECK (
    template_code IN (
      'ACCOUNT_CREATED',
      'APPOINTMENT_CONFIRMED',
      'APPOINTMENT_REMINDER',
      'ORDER_CONFIRMED',
      'PAYMENT_CONFIRMED',
      'POS_PAYMENT_RECEIPT',
      'POS_FINAL_RECEIPT'
    )
  ),
  ADD CONSTRAINT transactional_email_status CHECK (
    status IN (
      'PENDING', 'PROCESSING', 'SENT', 'TEST_SENT', 'SIMULATED',
      'FAILED', 'DEAD_LETTER', 'DELIVERED', 'BOUNCED',
      'COMPLAINED', 'SUPPRESSED'
    )
  ),
  ADD CONSTRAINT transactional_email_mode CHECK (
    delivery_mode IS NULL OR delivery_mode IN ('simulate', 'test', 'live')
  ),
  ADD CONSTRAINT transactional_email_effective_recipient CHECK (
    effective_recipient_email IS NULL OR (
      effective_recipient_email = lower(btrim(effective_recipient_email))
      AND effective_recipient_email LIKE '%@%'
    )
  ),
  ADD CONSTRAINT transactional_email_lock_consistency CHECK (
    (
      status = 'PROCESSING'
      AND locked_at IS NOT NULL
      AND lock_expires_at IS NOT NULL
      AND locked_by IS NOT NULL
    ) OR (
      status <> 'PROCESSING'
      AND locked_at IS NULL
      AND lock_expires_at IS NULL
      AND locked_by IS NULL
    )
  ),
  ADD CONSTRAINT transactional_email_sent CHECK (
    (
      status IN ('SENT', 'TEST_SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED')
      AND sent_at IS NOT NULL
    ) OR (
      status NOT IN (
        'SENT', 'TEST_SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED',
        'SUPPRESSED', 'DEAD_LETTER'
      )
      AND sent_at IS NULL
    ) OR status IN ('SUPPRESSED', 'DEAD_LETTER')
  );

DROP INDEX transactional_email_pending;

CREATE INDEX transactional_email_eligible_index
  ON transactional_email_outbox (next_attempt_at, created_at, id)
  WHERE status IN ('PENDING', 'FAILED');

CREATE INDEX transactional_email_retry_index
  ON transactional_email_outbox (attempt_count, next_attempt_at)
  WHERE status = 'FAILED';

CREATE INDEX transactional_email_expired_lock_index
  ON transactional_email_outbox (lock_expires_at)
  WHERE status = 'PROCESSING';

CREATE UNIQUE INDEX transactional_email_provider_message_unique
  ON transactional_email_outbox (provider, provider_message_id)
  WHERE provider IS NOT NULL AND provider_message_id IS NOT NULL;

CREATE UNIQUE INDEX transactional_email_receipt_unique
  ON transactional_email_outbox (receipt_id)
  WHERE receipt_id IS NOT NULL;

CREATE INDEX transactional_email_sale_index
  ON transactional_email_outbox (sale_id, created_at DESC)
  WHERE sale_id IS NOT NULL;

CREATE INDEX transactional_email_appointment_index
  ON transactional_email_outbox (appointment_id, created_at DESC)
  WHERE appointment_id IS NOT NULL;

INSERT INTO transactional_email_outbox (
  template_code, recipient_email, payload, deduplication_key, status,
  scheduled_at, next_attempt_at, last_error, last_error_code, sent_at,
  processing_finished_at, provider, provider_message_id,
  effective_recipient_email, delivery_mode, sale_id, payment_id, receipt_id
)
SELECT
  CASE sale_receipts.receipt_type
    WHEN 'PAYMENT' THEN 'POS_PAYMENT_RECEIPT'
    ELSE 'POS_FINAL_RECEIPT'
  END,
  sale_receipts.emailed_to,
  '{}'::JSONB,
  CASE sale_receipts.receipt_type
    WHEN 'PAYMENT' THEN 'receipt-payment:' || sale_receipts.id::TEXT
    ELSE 'receipt-final:' || sale_receipts.id::TEXT
  END,
  sale_receipts.email_status,
  sale_receipts.issued_at,
  CASE WHEN sale_receipts.email_status = 'FAILED'
    THEN CURRENT_TIMESTAMP ELSE sale_receipts.issued_at END,
  CASE WHEN sale_receipts.email_status = 'FAILED'
    THEN 'Fallo heredado del envío directo.' ELSE NULL END,
  CASE WHEN sale_receipts.email_status = 'FAILED'
    THEN 'legacy_direct_send_failure' ELSE NULL END,
  CASE WHEN sale_receipts.email_status = 'SENT'
    THEN COALESCE(sale_receipts.email_updated_at, sale_receipts.issued_at)
    ELSE NULL END,
  CASE WHEN sale_receipts.email_status IN ('SENT', 'SIMULATED')
    THEN COALESCE(sale_receipts.email_updated_at, sale_receipts.issued_at)
    ELSE NULL END,
  CASE WHEN sale_receipts.email_provider_id IS NOT NULL THEN 'RESEND' ELSE NULL END,
  sale_receipts.email_provider_id,
  CASE WHEN sale_receipts.email_status = 'SENT'
    THEN sale_receipts.emailed_to ELSE NULL END,
  CASE sale_receipts.email_status
    WHEN 'SENT' THEN 'live'
    WHEN 'SIMULATED' THEN 'simulate'
    ELSE NULL
  END,
  sale_receipts.sale_id,
  sale_receipts.payment_id,
  sale_receipts.id
FROM sale_receipts
WHERE sale_receipts.emailed_to IS NOT NULL
ON CONFLICT (deduplication_key) DO NOTHING;

CREATE TABLE transactional_email_transitions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email_id UUID NOT NULL REFERENCES transactional_email_outbox(id) ON DELETE RESTRICT,
  from_status VARCHAR(20),
  to_status VARCHAR(20) NOT NULL,
  reason_code VARCHAR(80) NOT NULL,
  error_code VARCHAR(80),
  attempt_count SMALLINT NOT NULL CHECK (attempt_count >= 0),
  actor_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX transactional_email_transitions_email_index
  ON transactional_email_transitions (email_id, occurred_at, id);

INSERT INTO transactional_email_transitions (
  email_id, from_status, to_status, reason_code, attempt_count, occurred_at
)
SELECT id, NULL, status, 'MIGRATED_FROM_016', attempt_count, created_at
FROM transactional_email_outbox;

CREATE TABLE transactional_email_provider_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider VARCHAR(30) NOT NULL,
  provider_event_id VARCHAR(200) NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  provider_message_id VARCHAR(200),
  email_id UUID REFERENCES transactional_email_outbox(id) ON DELETE RESTRICT,
  occurred_at TIMESTAMPTZ,
  payload_sha256 CHAR(64) NOT NULL,
  event_data JSONB NOT NULL DEFAULT '{}'::JSONB,
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT transactional_email_provider_event_unique
    UNIQUE (provider, provider_event_id),
  CONSTRAINT transactional_email_provider_event_hash CHECK (
    payload_sha256 ~ '^[0-9a-f]{64}$'
  )
);

CREATE INDEX transactional_email_provider_events_message_index
  ON transactional_email_provider_events (provider, provider_message_id, received_at DESC);

CREATE TABLE transactional_email_worker_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID NOT NULL,
  trigger_source VARCHAR(20) NOT NULL,
  delivery_mode VARCHAR(20),
  status VARCHAR(20) NOT NULL DEFAULT 'RUNNING',
  claimed_count INTEGER NOT NULL DEFAULT 0 CHECK (claimed_count >= 0),
  sent_count INTEGER NOT NULL DEFAULT 0 CHECK (sent_count >= 0),
  simulated_count INTEGER NOT NULL DEFAULT 0 CHECK (simulated_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  dead_letter_count INTEGER NOT NULL DEFAULT 0 CHECK (dead_letter_count >= 0),
  recovered_count INTEGER NOT NULL DEFAULT 0 CHECK (recovered_count >= 0),
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMPTZ,
  CONSTRAINT transactional_email_worker_trigger CHECK (
    trigger_source IN ('cron', 'manual', 'script', 'test')
  ),
  CONSTRAINT transactional_email_worker_mode CHECK (
    delivery_mode IS NULL OR delivery_mode IN ('simulate', 'test', 'live')
  ),
  CONSTRAINT transactional_email_worker_status CHECK (
    status IN ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED', 'DISABLED')
  )
);

CREATE INDEX transactional_email_worker_runs_date_index
  ON transactional_email_worker_runs (started_at DESC);

ALTER TABLE sale_receipts
  DROP CONSTRAINT sale_receipts_email_status,
  ADD CONSTRAINT sale_receipts_email_status CHECK (
    email_status IN (
      'PENDING', 'PROCESSING', 'SENT', 'TEST_SENT', 'SIMULATED',
      'FAILED', 'DEAD_LETTER', 'DELIVERED', 'BOUNCED',
      'COMPLAINED', 'SUPPRESSED'
    )
  );

INSERT INTO permissions (code, description) VALUES
  ('transactional_emails.manage', 'Diagnosticar y reintentar correos transaccionales.');

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code = 'transactional_emails.manage'
WHERE roles.code = 'ADMIN';

COMMENT ON COLUMN transactional_email_outbox.recipient_email IS
  'Destinatario original normalizado; nunca se reemplaza al redirigir pruebas.';
COMMENT ON COLUMN transactional_email_outbox.effective_recipient_email IS
  'Destino realmente usado por el proveedor en modos test o live.';
COMMENT ON COLUMN transactional_email_outbox.scheduled_at IS
  'Fecha original del evento o recordatorio; no cambia durante reintentos.';
COMMENT ON COLUMN transactional_email_outbox.next_attempt_at IS
  'Próximo instante elegible, actualizado por la política de reintentos.';
COMMENT ON TABLE transactional_email_provider_events IS
  'Eventos verificados del proveedor, reducidos a metadatos no sensibles.';


-- Fuente histórica: 024_add_public_request_rate_limits.sql
CREATE TABLE public_request_rate_limits (
  bucket VARCHAR(80) NOT NULL,
  subject_hash CHAR(64) NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count > 0),
  PRIMARY KEY (bucket, subject_hash),
  CONSTRAINT public_request_rate_limits_hash CHECK (subject_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT public_request_rate_limits_window CHECK (expires_at > window_started_at)
);

CREATE INDEX public_request_rate_limits_expiration_index
  ON public_request_rate_limits (expires_at);


-- Fuente histórica: 025_add_test_optical_catalog.sql
-- Agregar datos de prueba para validar el flujo completo de cristales en desarrollo.
ALTER TABLE products
  ADD COLUMN is_test_data BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX products_public_catalog_index
  ON products (is_active, is_test_data, category, name);

WITH administrador AS (
  SELECT users.id
  FROM users
  JOIN user_roles ON user_roles.user_id = users.id
  JOIN roles ON roles.id = user_roles.role_id
  WHERE users.is_active = TRUE AND roles.code = 'ADMIN'
  ORDER BY users.created_at
  LIMIT 1
),
productos_prueba (sku, name, price) AS (
  VALUES
    ('PRUEBA-CRISTAL-MONOF', 'Cristal monofocal de prueba', 19990::BIGINT),
    ('PRUEBA-CRISTAL-AZUL', 'Cristal con filtro azul de prueba', 29990::BIGINT),
    ('PRUEBA-CRISTAL-PROG', 'Cristal progresivo de prueba', 39990::BIGINT)
)
INSERT INTO products (
  sku,
  name,
  category,
  requires_prescription,
  unit_price_cents,
  is_active,
  is_test_data,
  created_by,
  updated_by
)
SELECT
  productos_prueba.sku,
  productos_prueba.name,
  'PRESCRIPTION_LENS',
  TRUE,
  productos_prueba.price,
  TRUE,
  TRUE,
  administrador.id,
  administrador.id
FROM productos_prueba
CROSS JOIN administrador
ON CONFLICT (sku) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  requires_prescription = EXCLUDED.requires_prescription,
  unit_price_cents = EXCLUDED.unit_price_cents,
  is_active = EXCLUDED.is_active,
  is_test_data = TRUE,
  updated_by = EXCLUDED.updated_by;


-- Fuente histórica: 026_allow_customers_without_rut.sql
ALTER TABLE customers
  ALTER COLUMN rut DROP NOT NULL;


-- Fuente histórica: 027_link_prescription_lenses_to_frames.sql
ALTER TABLE sale_items
  ADD COLUMN mount_source VARCHAR(20),
  ADD COLUMN mounted_on_product_id UUID REFERENCES products(id) ON DELETE RESTRICT,
  ADD CONSTRAINT sale_items_lens_mount_valid CHECK (
    (mount_source IS NULL AND mounted_on_product_id IS NULL)
    OR (mount_source = 'SOLD_FRAME' AND mounted_on_product_id IS NOT NULL)
    OR (mount_source = 'CUSTOMER_FRAME' AND mounted_on_product_id IS NULL)
  );


-- Fuente histórica: 028_link_store_lenses_to_frames.sql
ALTER TABLE store_cart_items
  ADD COLUMN mounted_on_product_id UUID REFERENCES products(id) ON DELETE RESTRICT;


-- Fuente histórica: 029_complete_counter_pos.sql
ALTER TABLE customers
  ALTER COLUMN last_names DROP NOT NULL,
  ALTER COLUMN phone DROP NOT NULL,
  ALTER COLUMN email DROP NOT NULL,
  ALTER COLUMN address DROP NOT NULL,
  DROP CONSTRAINT customers_names_normalized,
  DROP CONSTRAINT customers_phone_format,
  DROP CONSTRAINT customers_email_normalized,
  DROP CONSTRAINT customers_address_normalized,
  ADD CONSTRAINT customers_names_normalized CHECK (
    first_names = btrim(first_names)
    AND first_names <> ''
    AND (
      last_names IS NULL
      OR (last_names = btrim(last_names) AND last_names <> '')
    )
  ),
  ADD CONSTRAINT customers_phone_format CHECK (
    phone IS NULL OR phone ~ '^\+?[0-9]{8,15}$'
  ),
  ADD CONSTRAINT customers_email_normalized CHECK (
    email IS NULL OR (email = lower(btrim(email)) AND email <> '')
  ),
  ADD CONSTRAINT customers_address_normalized CHECK (
    address IS NULL OR (address = btrim(address) AND address <> '')
  );

ALTER TABLE sales
  ADD COLUMN request_key VARCHAR(80),
  ADD CONSTRAINT sales_request_key_normalized CHECK (
    request_key IS NULL OR (request_key = btrim(request_key) AND request_key <> '')
  );

CREATE UNIQUE INDEX sales_actor_request_key_unique
  ON sales (created_by, request_key)
  WHERE request_key IS NOT NULL;

CREATE TABLE discount_authorization_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  authorized_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  reason VARCHAR(300) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  sale_id UUID REFERENCES sales(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT discount_authorization_grants_reason CHECK (
    reason = btrim(reason) AND reason <> ''
  ),
  CONSTRAINT discount_authorization_grants_use CHECK (
    (consumed_at IS NULL AND sale_id IS NULL)
    OR (consumed_at IS NOT NULL AND sale_id IS NOT NULL)
  )
);

CREATE INDEX discount_authorization_grants_requested_index
  ON discount_authorization_grants (requested_by, expires_at DESC);

ALTER TABLE sale_payments
  ADD COLUMN request_key VARCHAR(80),
  ADD COLUMN cash_received_cents BIGINT,
  ADD COLUMN change_cents BIGINT,
  ADD CONSTRAINT sale_payments_request_key_normalized CHECK (
    request_key IS NULL OR (request_key = btrim(request_key) AND request_key <> '')
  ),
  ADD CONSTRAINT sale_payments_cash_consistency CHECK (
    (
      payment_method = 'CASH'
      AND cash_received_cents IS NOT NULL
      AND change_cents IS NOT NULL
      AND cash_received_cents >= amount_cents
      AND change_cents = cash_received_cents - amount_cents
    )
    OR (
      payment_method <> 'CASH'
      AND cash_received_cents IS NULL
      AND change_cents IS NULL
    )
  );

CREATE UNIQUE INDEX sale_payments_request_key_unique
  ON sale_payments (sale_id, request_key)
  WHERE request_key IS NOT NULL;

CREATE TABLE cash_register_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status VARCHAR(10) NOT NULL DEFAULT 'OPEN',
  opening_amount_cents BIGINT NOT NULL CHECK (opening_amount_cents >= 0),
  closing_counted_cents BIGINT,
  expected_amount_cents BIGINT,
  difference_cents BIGINT,
  opening_notes VARCHAR(500),
  closing_notes VARCHAR(500),
  opened_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  closed_at TIMESTAMPTZ,
  is_test_configuration BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT cash_register_sessions_status CHECK (status IN ('OPEN', 'CLOSED')),
  CONSTRAINT cash_register_sessions_closure CHECK (
    (
      status = 'OPEN'
      AND closing_counted_cents IS NULL
      AND expected_amount_cents IS NULL
      AND difference_cents IS NULL
      AND closed_by IS NULL
      AND closed_at IS NULL
    )
    OR (
      status = 'CLOSED'
      AND closing_counted_cents IS NOT NULL
      AND expected_amount_cents IS NOT NULL
      AND difference_cents IS NOT NULL
      AND closed_by IS NOT NULL
      AND closed_at IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX cash_register_one_open_session
  ON cash_register_sessions (status)
  WHERE status = 'OPEN';

CREATE TABLE cash_register_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES cash_register_sessions(id) ON DELETE RESTRICT,
  movement_type VARCHAR(20) NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  reason VARCHAR(500) NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT cash_register_movements_type CHECK (
    movement_type IN ('MANUAL_IN', 'MANUAL_OUT')
  ),
  CONSTRAINT cash_register_movements_reason CHECK (
    reason = btrim(reason) AND reason <> ''
  )
);

CREATE INDEX cash_register_movements_session_date_index
  ON cash_register_movements (session_id, created_at, id);


-- Fuente histórica: 030_allow_frame_sales_without_customer.sql
ALTER TABLE sales
  ALTER COLUMN customer_id DROP NOT NULL;


-- Fuente histórica: 031_store_cloudinary_media_assets.sql
-- Centraliza las imágenes nuevas fuera de PostgreSQL sin perder archivos históricos.

CREATE TABLE product_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  position SMALLINT NOT NULL CHECK (position BETWEEN 0 AND 99),
  alt_text VARCHAR(300) NOT NULL CHECK (btrim(alt_text) <> ''),
  original_filename VARCHAR(255) NOT NULL,
  media_type VARCHAR(100) NOT NULL CHECK (media_type IN (
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'
  )),
  file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes BETWEEN 1 AND 4194304),
  file_sha256 CHAR(64) NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  cloudinary_asset_id VARCHAR(100) NOT NULL UNIQUE,
  cloudinary_public_id VARCHAR(500) NOT NULL UNIQUE,
  cloudinary_version BIGINT NOT NULL CHECK (cloudinary_version > 0),
  cloudinary_url VARCHAR(2000) NOT NULL CHECK (cloudinary_url LIKE 'https://%'),
  cloudinary_format VARCHAR(30) NOT NULL,
  width INTEGER CHECK (width IS NULL OR width > 0),
  height INTEGER CHECK (height IS NULL OR height > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RETIRED')),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  retired_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  retired_at TIMESTAMPTZ,
  CONSTRAINT product_images_retirement CHECK (
    (status = 'ACTIVE' AND retired_by IS NULL AND retired_at IS NULL)
    OR (status = 'RETIRED' AND retired_by IS NOT NULL AND retired_at IS NOT NULL)
  )
);

CREATE INDEX product_images_active_product_index
  ON product_images (product_id, position, id)
  WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX product_images_active_position_unique
  ON product_images (product_id, position)
  WHERE status = 'ACTIVE';

ALTER TABLE product_events DROP CONSTRAINT product_events_type;
ALTER TABLE product_events ADD CONSTRAINT product_events_type CHECK (
  event_type IN ('CREATED', 'UPDATED', 'IMAGE_ADDED', 'IMAGE_RETIRED')
);

ALTER TABLE external_prescriptions
  ADD COLUMN cloudinary_asset_id VARCHAR(100),
  ADD COLUMN cloudinary_public_id VARCHAR(500),
  ADD COLUMN cloudinary_version BIGINT,
  ADD COLUMN cloudinary_format VARCHAR(30);

ALTER TABLE external_prescriptions DROP CONSTRAINT external_prescriptions_source_consistency;
ALTER TABLE external_prescriptions ADD CONSTRAINT external_prescriptions_source_consistency CHECK (
  (
    source = 'MANUAL'
    AND file_data IS NULL
    AND original_filename IS NULL
    AND media_type IS NULL
    AND file_size_bytes IS NULL
    AND file_sha256 IS NULL
    AND cloudinary_asset_id IS NULL
    AND cloudinary_public_id IS NULL
    AND cloudinary_version IS NULL
    AND cloudinary_format IS NULL
  )
  OR (
    source = 'IMAGE'
    AND original_filename IS NOT NULL
    AND media_type IS NOT NULL
    AND file_size_bytes > 0
    AND file_sha256 IS NOT NULL
    AND (
      (file_data IS NOT NULL AND cloudinary_asset_id IS NULL AND cloudinary_public_id IS NULL
        AND cloudinary_version IS NULL AND cloudinary_format IS NULL)
      OR
      (file_data IS NULL AND cloudinary_asset_id IS NOT NULL AND cloudinary_public_id IS NOT NULL
        AND cloudinary_version > 0 AND cloudinary_format IS NOT NULL)
    )
  )
);

CREATE UNIQUE INDEX external_prescriptions_cloudinary_asset_unique
  ON external_prescriptions (cloudinary_asset_id)
  WHERE cloudinary_asset_id IS NOT NULL;

COMMENT ON TABLE product_images IS
  'Galería pública de productos almacenada en Cloudinary.';
COMMENT ON COLUMN external_prescriptions.cloudinary_asset_id IS
  'Identificador inmutable de Cloudinary para recetas privadas.';


-- Fuente histórica: 032_require_prescriptions_for_configured_lenses.sql
UPDATE products
SET requires_prescription = FALSE
WHERE category <> 'PRESCRIPTION_LENS'
  AND requires_prescription = TRUE;

ALTER TABLE products
ADD CONSTRAINT products_prescription_only_for_lenses CHECK (
  category = 'PRESCRIPTION_LENS' OR requires_prescription = FALSE
);


