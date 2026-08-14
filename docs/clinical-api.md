# API clínica y recetas ópticas

La información clínica es longitudinal y permanente. No existen endpoints de
borrado para fichas, atenciones, adendas ni recetas. El acceso se autoriza por
permiso y se vuelve a restringir por la relación real entre el profesional, el
paciente y la reserva.

## Separación de acceso

| Actor | Ficha y atenciones | Receta completa | Vista para venta |
| --- | --- | --- | --- |
| `CLINICAL_PROFESSIONAL` asignado | Sí | Sí | No aplica |
| `ADMIN` | No | No | No |
| `SALES` | No | No | Sí, solo activa y emitida |

Un paciente se considera asignado cuando el profesional posee una reserva
`CONFIRMED`, `CHECKED_IN` o `COMPLETED` con esa persona. La ficha solo se puede
modificar si existe una reserva `CHECKED_IN` o `COMPLETED`. Los borradores de
una atención o receta únicamente son visibles para su autor.

Administración conserva la gestión de usuarios, agenda y datos demográficos,
pero no hereda acceso clínico. Ventas recibe la graduación, distancia pupilar,
notas de fabricación, paciente, profesional emisor, estado y versión; la
respuesta omite el vínculo con la atención y los motivos clínicos de reemplazo.

## Ficha clínica longitudinal

```text
GET   /api/patients/{patientId}/medical-record
PATCH /api/patients/{patientId}/medical-record
```

La primera actualización crea automáticamente una ficha única para el
paciente. Las siguientes actualizaciones conservan el mismo identificador y
registran qué campos se modificaron, quién lo hizo y cuándo. El evento no
duplica los contenidos sensibles anteriores.

Todos los campos son opcionales y se pueden limpiar enviando `null`:

```json
{
  "generalMedicalHistory": "Sin antecedentes sistémicos relevantes",
  "ocularHistory": "Control óptico anual",
  "familyOcularHistory": "Madre con presbicia",
  "allergies": "Sin alergias conocidas",
  "currentMedications": "No refiere"
}
```

Cada antecedente admite hasta 5.000 caracteres. Si todavía no existe una ficha,
`GET` responde con el paciente y `record: null`.

## Atención clínica

| Endpoint | Descripción |
| --- | --- |
| `POST /api/clinical-encounters` | Iniciar el borrador desde una reserva presente. |
| `GET /api/clinical-encounters/{id}` | Consultar la atención y sus adendas. |
| `PATCH /api/clinical-encounters/{id}` | Editar el borrador propio. |
| `POST /api/clinical-encounters/{id}/finalize` | Finalizar e inmovilizar la atención. |
| `POST /api/clinical-encounters/{id}/addenda` | Agregar una corrección posterior permanente. |
| `GET /api/patients/{patientId}/clinical-history` | Listar las atenciones finalizadas del paciente. |

Solo puede existir una atención por reserva. Para iniciarla, la reserva debe
pertenecer al profesional autenticado y estar en `CHECKED_IN`:

```json
{
  "appointmentId": "uuid",
  "reasonForVisit": "Control visual anual",
  "anamnesis": "Refiere visión borrosa de lejos.",
  "examination": "Refracción subjetiva realizada.",
  "diagnosis": "Ametropía bilateral",
  "indications": "Uso de corrección óptica y control anual."
}
```

La atención comienza como `DRAFT`. Antes de finalizar debe tener `examination`
y `diagnosis`. La finalización ocurre en una sola transacción: cambia la
atención a `FINALIZED`, registra el evento clínico, cambia la reserva a
`COMPLETED` y registra el evento de agenda.

Por esta razón, `PATCH /api/appointments/{id}/status` no permite enviar
`COMPLETED`; responde
`APPOINTMENT_COMPLETION_REQUIRES_FINALIZED_ENCOUNTER`. Después de finalizar, el
contenido original no se sobrescribe. Una aclaración exige motivo y contenido:

```json
{
  "reason": "Aclaración de indicación",
  "content": "Se precisa que el control sugerido es en doce meses."
}
```

## Recetas ópticas

```text
POST  /api/clinical-encounters/{encounterId}/prescriptions
GET   /api/prescriptions/{prescriptionId}
PATCH /api/prescriptions/{prescriptionId}
GET   /api/prescriptions?patientId={patientId}
```

La primera receta se emite mientras la atención está en borrador y se puede
editar hasta finalizarla. Ambos ojos exigen `sphere` y `cylinder`; `axis` es un
entero entre 0 y 180 y se vuelve obligatorio cuando el cilindro no es cero.
`addition`, `pupillaryDistance` y `fulfillmentNotes` son opcionales.

```json
{
  "rightEye": {
    "sphere": -1.25,
    "cylinder": -0.75,
    "axis": 95,
    "addition": 1.25
  },
  "leftEye": {
    "sphere": -1,
    "cylinder": -0.5,
    "axis": 85,
    "addition": 1.25
  },
  "pupillaryDistance": 63,
  "fulfillmentNotes": "Uso permanente"
}
```

Una receta de una atención finalizada es inmutable. Para corregirla se vuelve a
usar el `POST` de la atención con todos los valores y `replacementReason`. La
operación anula la versión activa y crea la siguiente versión enlazada, sin
eliminar el original:

```json
{
  "rightEye": { "sphere": -1.5, "cylinder": -0.75, "axis": 95 },
  "leftEye": { "sphere": -1, "cylinder": -0.5, "axis": 85 },
  "replacementReason": "Corrección de esfera del ojo derecho"
}
```

Ventas solo puede consultar la versión `ACTIVE` de una atención `FINALIZED`.
Una receta en borrador o reemplazada se presenta como inexistente para ese rol.

## Errores relevantes

| Código | HTTP | Significado |
| --- | --- | --- |
| `INVALID_CLINICAL_DATA` | 400 | Identificador, cuerpo o medición inválida. |
| `CLINICAL_ACCESS_NOT_ASSIGNED` | 403 | El profesional no está relacionado con el paciente o atención. |
| `CLINICAL_ENCOUNTER_NOT_FOUND` | 404 | La atención no existe o el borrador pertenece a otra persona. |
| `PRESCRIPTION_NOT_FOUND` | 404 | La receta no existe o no es visible para el actor. |
| `APPOINTMENT_NOT_CHECKED_IN` | 409 | La reserva todavía no registra la llegada. |
| `CLINICAL_ENCOUNTER_ALREADY_EXISTS` | 409 | La reserva ya posee una atención. |
| `INCOMPLETE_CLINICAL_ENCOUNTER` | 409 | Faltan examen o diagnóstico para finalizar. |
| `CLINICAL_ENCOUNTER_IMMUTABLE` | 409 | Se intentó sobrescribir una atención finalizada. |
| `PRESCRIPTION_IMMUTABLE` | 409 | Se intentó editar una receta ya emitida. |
| `PRESCRIPTION_REPLACEMENT_REASON_REQUIRED` | 400 | Falta justificar una nueva versión. |
