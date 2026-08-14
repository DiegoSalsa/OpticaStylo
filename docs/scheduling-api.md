# API de agenda y reservas

La agenda usa la zona horaria configurada en `APP_TIME_ZONE`, cuyo valor
predeterminado es `America/Santiago`. Las horas almacenadas y devueltas por la
API son instantes ISO 8601 en UTC; los horarios semanales se expresan como hora
local `HH:mm`.

Las reservas y sus eventos son permanentes. No existe un endpoint `DELETE`:
una reserva que no se realizará se conserva con estado `CANCELLED` y su motivo.

## Profesionales

Un profesional corresponde a un usuario activo con rol
`CLINICAL_PROFESSIONAL`. El perfil no duplica su nombre ni correo; solamente
guarda la configuración necesaria para reservar.

| Endpoint | Permiso | Descripción |
| --- | --- | --- |
| `GET /api/professionals` | `schedules.read` | Listar perfiles. |
| `POST /api/professionals` | `schedules.manage_all` | Crear un perfil. |
| `GET /api/professionals/{id}` | `schedules.read` | Consultar un perfil. |
| `PATCH /api/professionals/{id}` | `schedules.manage_all` | Actualizar un perfil. |

El perfil contiene `appointmentDurationMinutes` (5 a 480),
`slotIntervalMinutes` (5 a 120) e `isBookable`. Para crearlo también se envía
el `userId` clínico.

## Horario semanal

```text
GET /api/professionals/{id}/schedule
PUT /api/professionals/{id}/schedule
```

La escritura requiere `schedules.manage_all`, salvo que el profesional use
`schedules.manage_own` sobre su propia agenda. Deben enviarse exactamente los
siete días, desde domingo `0` hasta sábado `6`.

```json
{
  "days": [
    {
      "dayOfWeek": 1,
      "startTime": "09:00",
      "endTime": "18:00",
      "isWorking": true,
      "breakStart": "13:00",
      "breakEnd": "14:00"
    }
  ]
}
```

Aunque `isWorking` sea `false`, el horario semanal conserva `startTime` y
`endTime`. La pausa es opcional, pero sus dos extremos deben estar presentes y
quedar dentro de la jornada.

## Excepciones por fecha

```text
GET    /api/professionals/{id}/schedule/overrides?from=AAAA-MM-DD&to=AAAA-MM-DD
PUT    /api/professionals/{id}/schedule/overrides/{date}
DELETE /api/professionals/{id}/schedule/overrides/{date}
```

Una excepción reemplaza por completo el horario semanal de esa fecha. Para
cerrar el día se envía `{ "isWorking": false }`; para abrirlo se envían además
las horas y, opcionalmente, la pausa.

## Bloqueos

```text
GET    /api/professionals/{id}/schedule/blocks?from={instant}&to={instant}
POST   /api/professionals/{id}/schedule/blocks
DELETE /api/professionals/{id}/schedule/blocks/{blockId}
```

Un bloqueo contiene `startAt`, `endAt` y un `reason` opcional. Puede representar
una reunión, permiso, capacitación u otro periodo no reservable. No se permite
crear un bloqueo sobre una reserva vigente; ambas operaciones usan el mismo
bloqueo transaccional para resolver correctamente solicitudes concurrentes.

## Disponibilidad

```text
GET /api/professionals/{id}/availability?date=AAAA-MM-DD
Permiso: schedules.read
```

El motor combina el perfil, el horario semanal, la excepción de la fecha, la
pausa, los bloqueos, las reservas vigentes y la hora actual. Solo devuelve cupos
futuros completos:

```json
{
  "success": true,
  "data": {
    "date": "2026-08-17",
    "professionalId": "uuid",
    "timeZone": "America/Santiago",
    "slots": [
      {
        "startAt": "2026-08-17T13:00:00.000Z",
        "endAt": "2026-08-17T14:00:00.000Z"
      }
    ]
  }
}
```

## Reservas

| Endpoint | Permiso | Descripción |
| --- | --- | --- |
| `POST /api/appointments` | `appointments.create` | Reservar un cupo. |
| `GET /api/appointments?from={instant}&to={instant}` | lectura total o propia | Listar por rango. |
| `GET /api/appointments/{id}` | lectura total o propia | Consultar una reserva. |
| `PATCH /api/appointments/{id}` | `appointments.update` | Reagendar o modificar notas. |
| `PATCH /api/appointments/{id}/status` | actualización o estado propio | Cambiar estado. |
| `GET /api/appointments/{id}/history` | lectura total o propia | Consultar su historial. |

El listado exige `from` y `to`, admite como máximo 366 días y puede filtrarse
por `patientId`, `professionalId` y `status`. Un profesional clínico siempre
queda restringido a sus propias reservas, aunque envíe otro filtro.

Para crear una reserva se envían el paciente, el profesional y el inicio exacto
de uno de los cupos entregados por disponibilidad:

```json
{
  "patientId": "uuid",
  "professionalId": "uuid",
  "startAt": "2026-08-17T13:00:00.000Z",
  "internalNotes": "Control anual"
}
```

La duración se obtiene del perfil profesional. La API vuelve a verificar la
disponibilidad dentro de una transacción y serializa las reservas concurrentes
del mismo profesional. Dos intervalos chocan cuando
`inicioExistente < finNuevo` y `finExistente > inicioNuevo`; por ello, una hora
puede empezar exactamente cuando termina la anterior.

Una reserva `CONFIRMED` puede reagendarse enviando `startAt`, cambiar sus notas
con `internalNotes`, o ambas cosas. Las notas se pueden limpiar enviando `null`
o una cadena vacía.

## Estados e historial

Las transiciones de agenda son:

```text
CONFIRMED -> CHECKED_IN
CONFIRMED -> NO_SHOW
CONFIRMED -> CANCELLED
```

`CHECKED_IN -> COMPLETED` no se ejecuta mediante el endpoint genérico de
estado. La reserva cambia automáticamente a `COMPLETED` cuando el profesional
finaliza la atención clínica asociada. Así, la reserva y su registro clínico se
confirman dentro de la misma transacción.

`COMPLETED`, `NO_SHOW` y `CANCELLED` son terminales. Para cancelar se exige
`appointments.cancel` y un `cancellationReason` de hasta 500 caracteres. Las
reservas canceladas liberan el cupo; las completadas y ausentes lo mantienen
ocupado como registro histórico.

El historial registra creación, reagendamientos, cambios de notas, cambios de
estado y cancelación, junto con el usuario y la fecha del evento. No guarda el
contenido anterior de las notas para evitar duplicar información sensible.

## Errores relevantes

| Código | HTTP | Significado |
| --- | --- | --- |
| `INVALID_APPOINTMENT_DATA` | 400 | Cuerpo, identificador, filtro o fecha inválidos. |
| `APPOINTMENT_NOT_FOUND` | 404 | La reserva no existe o no pertenece al profesional autenticado. |
| `APPOINTMENT_TIME_NOT_AVAILABLE` | 409 | El inicio no corresponde a un cupo libre o otra reserva lo ocupó. |
| `APPOINTMENT_OVERLAPS_SCHEDULE_BLOCK` | 409 | Un bloqueo fue creado mientras se reservaba. |
| `SCHEDULE_BLOCK_OVERLAPS_APPOINTMENT` | 409 | El bloqueo solicitado coincide con una reserva vigente. |
| `INVALID_APPOINTMENT_STATUS_TRANSITION` | 409 | El cambio no respeta el flujo de estados. |
| `APPOINTMENT_COMPLETION_REQUIRES_FINALIZED_ENCOUNTER` | 409 | Se intentó completar la reserva sin finalizar su atención clínica. |
| `PROFESSIONAL_ALREADY_EXISTS` | 409 | El usuario clínico ya posee perfil. |
