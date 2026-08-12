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
