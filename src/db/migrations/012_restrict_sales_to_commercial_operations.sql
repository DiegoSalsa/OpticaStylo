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
