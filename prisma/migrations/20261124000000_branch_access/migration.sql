INSERT INTO permissions (code, description)
VALUES ('branches.access_all', 'Consultar y administrar el alcance general de sucursales')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.code = 'ADMIN' AND p.code = 'branches.access_all'
ON CONFLICT DO NOTHING;

INSERT INTO roles (code, name, description)
VALUES ('BRANCH_ADMIN', 'Administrador de sucursal', 'Gestiona operaciones únicamente en las sucursales asignadas.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.code = 'BRANCH_ADMIN' AND p.code IN (
  'users.read', 'users.create', 'users.update', 'users.deactivate', 'users.assign_roles',
  'inventory.read', 'inventory.write', 'inventory.manage_all',
  'cash.read', 'cash.operate', 'cash.adjust', 'cash.manage_all',
  'customers.read', 'customers.manage', 'products.read',
  'sales.read', 'sales.create', 'sales.update', 'sales.discounts_authorize',
  'sales.payments_register', 'sales.mercado_pago_checkout', 'sales.reports_read', 'reports.read',
  'patients.read_basic', 'patients.manage_basic', 'prescriptions.read_for_sale',
  'medical_records.assign_care', 'schedules.read', 'schedules.manage_all',
  'appointments.read_all', 'appointments.create', 'appointments.update', 'appointments.cancel'
)
ON CONFLICT DO NOTHING;

CREATE INDEX user_branches_branch_user_idx ON user_branches(branch_id, user_id);

ALTER TABLE user_sessions ADD COLUMN active_branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;
CREATE INDEX user_sessions_active_branch_idx ON user_sessions(active_branch_id);
