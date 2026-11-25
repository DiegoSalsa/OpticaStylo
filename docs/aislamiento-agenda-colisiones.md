# Colisiones de Agenda entre sucursales

Base reproducida `73db5acee1a80fa62ae78687703276d87ce20267`.

| Operación | Regla |
| --- | --- |
| Consultar disponibilidad | Los horarios semanales, excepciones y bloqueos se leen en la sede de la consulta. Las citas que ocupan al profesional se leen en todas las sedes. |
| Crear o reagendar una cita | La escritura vuelve a comprobar los bloqueos de su sede y todas las citas solapadas del profesional dentro de una transacción serializable. La edición interna y Mi cuenta conservan la sucursal de la cita. |
| Crear un bloqueo en una sede | Se comprueban las citas de esa sede. Una cita histórica sin sede también impide crear un bloqueo que se superponga, porque no se puede determinar a qué sede corresponde. |
| Gestionar una cita histórica sin sede | Sigue ocupando al profesional en todas las agendas. Si su titular la reagenda desde Mi cuenta, los horarios, las excepciones y los bloqueos son los del calendario histórico sin sede. La sucursal de la cita sigue siendo nula. |

El defecto se reprodujo con Romano y Palet. Un bloqueo local de Romano retiraba el cupo de las 11:00 en Palet. Incluso al llamar directamente al repositorio, sin el cálculo de disponibilidad, la transacción devolvía `SCHEDULE_BLOCK` para la cita de Palet. Se agregó cobertura HTTP para la creación interna, la reserva pública, la edición interna y Mi cuenta. La regresión también comprueba la separación de horarios y excepciones, las citas históricas y las escrituras simultáneas.

## GitHub Actions

El job **Validar aplicación** de la ejecución #45544012182 quedó sin pasos ejecutados. La anotación de GitHub indicó que el job no se inició debido a un bloqueo de facturación de la cuenta. Esa ejecución no evaluó el código. [Ejecución #45544012182](https://github.com/DiegoSalsa/OpticaStylo/actions/runs/45544012182)

El SHA base registró un preview exitoso en Vercel al publicar la rama. La corrección añade una exclusión explícita de despliegues automáticos para `fix/aislamiento-sucursales`. [Estado del SHA base en GitHub](https://api.github.com/repos/DiegoSalsa/OpticaStylo/commits/73db5acee1a80fa62ae78687703276d87ce20267/status) · [Configuración de despliegues por rama en Vercel](https://vercel.com/docs/project-configuration/git-configuration#gitdeploymentenabled)

## Pendiente de privacidad

La primera visita de un cliente o paciente a otra sede requiere intervención de la administración general y un vínculo explícito. El alta con RUT duplicado revela que ese RUT existe. El flujo propuesto para solicitar un vínculo verificable y auditable sigue en revisión. [Primera visita entre sucursales](aislamiento-sucursales-primera-visita.md)
