# Entorno Taller de Desarrollo

Este entorno es independiente de Vercel/Neon y del servidor universitario de tesis.

## Acceso

- HTTP: `http://146.83.198.35:1641`
- HTTPS: `https://146.83.198.35:1642` (certificado autofirmado provisional)
- Healthcheck: `/api/health`
- La aplicación corre en `127.0.0.1:3000`, administrada por PM2 (`optica-stylo`) y publicada por Nginx.

## Base de datos

- Host: `pgsqltrans.face.ubiobio.cl:5432`
- Base: `talleruser10_db`
- Usuario: `talleruser10`
- La base fue sincronizada desde Neon con 50 tablas y 272 filas.
- Verificación final: el snapshot completo de Neon y Taller produjo el mismo SHA-256: `cb49400b7260dc4da47ea3a29f2c96c591fa505ccfb7b766c070f2ed03df8ccd`.

## Despliegue automático

El runner `opticastylo-taller` atiende `.github/workflows/desplieguetaller.yml`. Cada cambio en `main` o `testgeneral` instala dependencias, aplica migraciones pendientes, ejecuta lint/tests/build, recarga PM2 y verifica `/api/health`.

El runner `opticastylo-universidad` y el despliegue de Vercel mantienen sus propias rutas y bases de datos; no comparten procesos ni archivos `.env`.

> El certificado autofirmado permite probar el puerto HTTPS, pero debe reemplazarse por uno emitido para un dominio real antes de usar pagos, webhooks o credenciales en producción.
