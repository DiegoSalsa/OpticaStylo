# Despliegue en un servidor Linux

Esta configuración ejecuta la aplicación en Docker y se conecta a PostgreSQL
institucional. No crea un contenedor de base de datos: los datos y los respaldos
siguen siendo responsabilidad del servicio administrado por la universidad.

## Requisitos previos

- Docker Engine con Docker Compose v2 en el servidor.
- Un DNS público que apunte al servidor, si se habilitarán Mercado Pago, Resend
  u otros webhooks externos.
- Acceso TCP del servidor Linux al host PostgreSQL institucional.
- Un usuario de PostgreSQL de aplicación, limitado a la base de datos de Stylo.
- El certificado de la autoridad certificadora (CA) que firma el certificado TLS
  de PostgreSQL. Solicitarlo a informática si no es una CA pública.

La aplicación valida el certificado de PostgreSQL en producción. No desactivar
esa verificación ni usar `DATABASE_SSL=false`.

## Preparación del servidor

Desde la carpeta del proyecto, crear el archivo de variables y protegerlo:

```bash
cp .env.production.example .env.production
mkdir -p secrets
chmod 700 secrets
chmod 600 .env.production
```

Guardar el archivo CA entregado por la universidad como
`secrets/postgresql-ca.crt` y definir en `.env.production` una ruta absoluta:

```dotenv
DATABASE_CA_CERT_PATH=/ruta/absoluta/al/proyecto/secrets/postgresql-ca.crt
DATABASE_SSL=true
APP_DOMAIN=stylo.midominio.edu
APP_PUBLIC_URL=https://stylo.midominio.edu
```

Completar además `DATABASE_URL`, los secretos y proveedores que correspondan.
La contraseña dentro de `DATABASE_URL` debe usar codificación URL: por ejemplo,
`@` se escribe `%40`.

## Primer despliegue

Construir para la arquitectura de los servidores universitarios. La mayoría usa
`linux/amd64`; confirmar con `uname -m` en el servidor.

```bash
docker compose --env-file .env.production build
docker compose --env-file .env.production --profile maintenance run --rm migrate
docker compose --env-file .env.production up -d app
docker compose --env-file .env.production ps
docker compose --env-file .env.production logs --follow app
```

Verificar que la aplicación responde desde el servidor:

```bash
curl --fail http://127.0.0.1:3000/api/health
```

Si construyes la imagen fuera del servidor, usa una plataforma explícita y
publícala en un registro accesible desde la universidad:

```bash
docker buildx build --platform linux/amd64 --target runner --tag REGISTRO/optica-stylo:VERSION --push .
```

En ese caso, reemplazar `build:` por `image: REGISTRO/optica-stylo:VERSION` en
un archivo Compose de despliegue o construir la imagen de migración con el
target `migration` y el mismo commit.

## HTTPS y proxy inverso

Si infraestructura ya entrega un proxy institucional, configurarlo para enviar
tráfico a `http://127.0.0.1:3000`; el puerto de Next.js no queda expuesto a la
red. El proxy debe reenviar `Host`, `X-Forwarded-For` y `X-Forwarded-Proto`.

Si no existe un proxy, Caddy incluido puede obtener y renovar certificados TLS
automáticamente. Antes de usarlo, confirmar que los puertos 80, 443 y UDP 443
están permitidos y que el DNS público apunta a este servidor:

```bash
docker compose --env-file .env.production --profile edge up -d app caddy
```

No ejecutar Caddy si otro servicio ya ocupa 80 o 443.

## Actualizaciones

Para cada versión, guardar una copia de `.env.production`, construir o descargar
la nueva imagen, ejecutar primero las migraciones y recién entonces reemplazar
el contenedor web:

```bash
docker compose --env-file .env.production build
docker compose --env-file .env.production --profile maintenance run --rm migrate
docker compose --env-file .env.production up -d --no-deps app
docker compose --env-file .env.production ps
```

Revisar los logs y el endpoint `/api/health` después de cada actualización. Las
migraciones usan bloqueo de PostgreSQL, pero deben ejecutarse como una tarea de
despliegue, no al inicio de cada contenedor web.
