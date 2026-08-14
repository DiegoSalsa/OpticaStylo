# Política inicial de autorización

La aplicación utiliza control de acceso basado en roles y permisos. Un usuario puede recibir más de un rol; sus permisos efectivos son la unión de los permisos de todos sus roles activos.

## Roles internos

### `ADMIN`

Gestiona usuarios, agenda, datos básicos de pacientes, clientes, catálogo,
ventas, abonos y reportes. El rol no incluye permisos para leer graduaciones,
fichas clínicas ni recetas completas.

### `CLINICAL_PROFESSIONAL`

Gestiona su disponibilidad, sus reservas y la información clínica de pacientes relacionados con sus atenciones. Los permisos con sufijo `assigned` requieren además comprobar en el servicio que el paciente o la atención estén asignados al profesional.

### `SALES`

Gestiona disponibilidad, reservas, datos básicos de pacientes, clientes, ventas
y abonos. Puede leer el catálogo, pero no crearlo ni cambiar precios. Solo puede
consultar de una receta la información necesaria para procesar una venta; no
puede acceder a la ficha clínica completa.

## Reglas de implementación

- Los Route Handlers y servicios deben comprobar permisos, no nombres de roles.
- Los permisos `own` y `assigned` siempre requieren una comprobación contextual adicional.
- Una cuenta desactivada o bloqueada no puede iniciar nuevas sesiones.
- Las sesiones almacenan únicamente un hash SHA-256 del token opaco. El token original solo se entrega al cliente mediante una cookie segura.
- Los registros clínicos no se eliminan físicamente mediante operaciones ordinarias.
- Las ventas, sus abonos y sus eventos tampoco se eliminan físicamente.
- Los productos dejan de venderse mediante `isActive=false`; el catálogo conserva
  el historial de cambios y las ventas conservan el precio usado en cada línea.
- Los roles del sistema no se editan desde endpoints administrativos; cualquier cambio debe quedar versionado mediante una migración.
