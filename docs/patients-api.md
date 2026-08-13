# API de pacientes

El módulo conserva permanentemente los datos básicos de cada paciente. No
existe una operación para eliminar, archivar o marcar pacientes como inactivos,
porque una persona puede volver a atenderse después de periodos prolongados.

El historial clínico se incorporará mediante las atenciones en una etapa
posterior. Los campos `createdAt` y `updatedAt` indican cuándo se creó o modificó
el registro básico, mientras PostgreSQL conserva internamente qué usuario creó
y actualizó el paciente.

## Autorización

- `patients.read_basic`: permite listar y consultar pacientes.
- `patients.manage_basic`: permite registrar y actualizar pacientes.
- `ADMIN` y `SALES` poseen ambos permisos.
- `CLINICAL_PROFESSIONAL` posee únicamente el permiso de lectura básica.

Todos los endpoints requieren una sesión válida mediante la cookie
`opticastylo_session`.

## Datos básicos

| Campo | Regla |
| --- | --- |
| `rut` | Obligatorio, chileno, con dígito verificador válido y único. |
| `firstNames` | Obligatorio, máximo 150 caracteres. |
| `lastNames` | Obligatorio, máximo 150 caracteres. |
| `birthDate` | Obligatorio, formato `AAAA-MM-DD` y no puede ser futuro. |
| `phone` | Obligatorio, entre 8 y 15 dígitos; puede comenzar con `+`. |
| `email` | Obligatorio y normalizado a minúsculas. |
| `address` | Obligatoria, máximo 500 caracteres. |
| `guardian` | Obligatorio cuando el paciente es menor de 18 años. |

Por ahora se registra un responsable por paciente. Sus campos son `rut`,
`firstNames`, `lastNames`, `relationship`, `phone` y `email`.

## Registrar un paciente

```text
Método: POST
URL: /api/patients
Permiso: patients.manage_basic
```

Ejemplo de paciente adulto:

```json
{
  "rut": "12.345.678-5",
  "firstNames": "María José",
  "lastNames": "Pérez Soto",
  "birthDate": "1990-05-20",
  "phone": "+56912345678",
  "email": "paciente@example.com",
  "address": "Avenida Principal 123"
}
```

Ejemplo de paciente menor de edad:

```json
{
  "rut": "11.111.111-1",
  "firstNames": "Paciente",
  "lastNames": "Menor",
  "birthDate": "2012-01-10",
  "phone": "+56922222222",
  "email": "menor@example.com",
  "address": "Avenida Principal 123",
  "guardian": {
    "rut": "12.345.678-5",
    "firstNames": "Persona",
    "lastNames": "Responsable",
    "relationship": "Madre",
    "phone": "+56933333333",
    "email": "responsable@example.com"
  }
}
```

Responde `201 Created`. Si el RUT ya está registrado, responde `409 Conflict`
con el código `PATIENT_RUT_ALREADY_EXISTS`.

## Listar y buscar pacientes

```text
Método: GET
URL: /api/patients?page=1&pageSize=20&search=Pérez
Permiso: patients.read_basic
```

La búsqueda compara nombres, apellidos, nombre completo, correo, teléfono y
RUT. `pageSize` admite entre 1 y 100 registros.

```json
{
  "success": true,
  "data": {
    "items": [],
    "page": 1,
    "pageSize": 20,
    "total": 0,
    "totalPages": 0
  }
}
```

## Consultar un paciente

```text
Método: GET
URL: /api/patients/{patientId}
Permiso: patients.read_basic
```

Responde `404 Not Found` con `PATIENT_NOT_FOUND` cuando el identificador no
corresponde a un paciente.

## Actualizar un paciente

```text
Método: PATCH
URL: /api/patients/{patientId}
Permiso: patients.manage_basic
```

El cuerpo puede incluir uno o varios campos admitidos. Las mismas reglas de
validación del registro vuelven a aplicarse a la información resultante.

```json
{
  "phone": "+56999999999",
  "address": "Nueva dirección 456"
}
```

## Códigos de error relevantes

| Código | HTTP | Descripción |
| --- | --- | --- |
| `AUTHENTICATION_REQUIRED` | 401 | No existe una sesión válida. |
| `INSUFFICIENT_PERMISSIONS` | 403 | El rol no permite la operación. |
| `INVALID_PATIENT_DATA` | 400 | Los datos o parámetros no son válidos. |
| `PATIENT_NOT_FOUND` | 404 | El paciente solicitado no existe. |
| `PATIENT_RUT_ALREADY_EXISTS` | 409 | El RUT ya está registrado. |

`DELETE /api/patients/{patientId}` no está implementado y responde `405 Method
Not Allowed`.
