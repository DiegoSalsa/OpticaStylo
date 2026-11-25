# Primera visita de una persona registrada en otra sucursal

## Operación disponible

Si una persona registrada en Romano visita Palet, la búsqueda de Clientes, Pacientes o POS en Palet se limita a las identidades ya autorizadas allí. Conocer el RUT no permite acceder a la ficha ni asociar esa identidad a una venta. Si se intenta un alta duplicada, el sistema conserva un único registro. El conflicto de RUT revela que hay una coincidencia en el sistema. La respuesta no incluye el identificador, la ficha, los datos de contacto ni la sede del registro existente.

Durante el ensayo sintético, el personal de Palet carecía de acceso a la identidad y a la cotización de Romano. La administración general verificó el caso y vinculó explícitamente la identidad a Palet. Después, el personal local pudo seleccionarla en POS y generar una cotización de su propia sucursal. El historial comercial de Romano permaneció fuera de su alcance. El vínculo básico de un cliente es independiente del de un paciente y de las autorizaciones clínicas.

La aplicación actual solo permite efectuar ese vínculo mediante `POST /api/inventory/branches`, desde una sesión con `inventory.manage_all` y `branches.access_all`. Las acciones son `LINK_CUSTOMER` y `LINK_PATIENT` y requieren `branchId`, `identityId` e `identityVerified: true`. Ese indicador registra la confirmación en la solicitud, pero las filas de vínculo no conservan por sí solas quién hizo la verificación, cuándo ni con qué evidencia. Hoy tampoco hay una pantalla para que Palet solicite el vínculo.

## Flujo mínimo propuesto

1. Agregar una acción **Solicitar vínculo** al directorio local o a POS. El servidor deriva la sucursal de una asignación vigente. Registra la solicitud con el RUT entregado por la persona y muestra el mismo acuse tanto si existe como si no existe una coincidencia. El personal local puede consultar el estado de su solicitud.
2. La administración general revisa los casos en una cola restringida. Verifica presencialmente la identidad o mediante un canal ya validado y registra el método y una referencia mínima a la comprobación. Evita almacenar imágenes de documentos o datos clínicos para esta tarea.
3. La aprobación crea un vínculo explícito con esa sede, dentro de una transacción que deja constancia del solicitante, quien aprueba, la fecha, la sede, el tipo de vínculo y el resultado. La operación admite reintentos sin duplicar vínculos. La respuesta local indica que puede volver a buscar a la persona. Los antecedentes clínicos siguen bajo sus permisos y asignaciones propios.

La propuesta queda para una revisión de privacidad antes de su implementación. Mientras tanto, los casos deben escalarse por el canal interno autorizado y documentarse antes de que administración general utilice la API.
