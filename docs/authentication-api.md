# API inicial de autenticación y usuarios

La URL local base es `http://localhost:3000`. Postman conservará automáticamente la cookie de sesión recibida después de un inicio de sesión correcto.

## Iniciar sesión

```text
Método: POST
URL: http://localhost:3000/api/auth/login
Headers: Content-Type: application/json
```

```json
{
  "email": "admin@example.com",
  "password": "contraseña del administrador"
}
```

Respuesta esperada: `200 OK`, datos básicos del usuario y una cookie `opticastylo_session` marcada como `HttpOnly`.

## Registrar un usuario interno

Requiere una sesión con los permisos `users.create` y `users.assign_roles`.

```text
Método: POST
URL: http://localhost:3000/api/users
Headers: Content-Type: application/json
```

```json
{
  "email": "ventas@example.com",
  "firstName": "Ana",
  "lastName": "Pérez",
  "password": "una contraseña inicial extensa",
  "roles": ["SALES"]
}
```

Roles admitidos:

- `ADMIN`
- `CLINICAL_PROFESSIONAL`
- `SALES`

Respuesta esperada: `201 Created`. La respuesta nunca incluye la contraseña ni su hash.

## Cerrar sesión

```text
Método: POST
URL: http://localhost:3000/api/auth/logout
Headers: no requiere encabezados manuales si Postman conserva la cookie
Body: no requiere
```

Respuesta esperada: `204 No Content`. La sesión queda revocada en PostgreSQL y la cookie expira.

## Errores principales

- `400 INVALID_USER_DATA`: datos de entrada inválidos.
- `401 INVALID_CREDENTIALS`: correo o contraseña incorrectos.
- `401 AUTHENTICATION_REQUIRED`: no existe una sesión activa.
- `403 INSUFFICIENT_PERMISSIONS`: la sesión no posee los permisos requeridos.
- `409 USER_EMAIL_ALREADY_EXISTS`: el correo ya pertenece a otro usuario.
- `413 REQUEST_BODY_TOO_LARGE`: el cuerpo supera 16 KiB.
