# Cierre académico: validación ampliada en entorno aislado

## Referencia inicial y alcance

La auditoría del 10 de octubre de 2026 comprobó `origin/main` y el árbol local limpio en
`921e1be10f3362b21d6ba34e86a638895a11f10b`, después de `git fetch origin`.
La intervención utiliza la rama `codex/cierre-academico-validacion`; no hace push,
merge, despliegue ni modificaciones de datos de producción.

Las cifras de la validación de compra invitada en `0e49256` y las de gestión interna
en `d5f20a0` son resultados históricos independientes. No se suman entre sí ni se
atribuyen al HEAD sin una nueva ejecución. La aceptación PA-01 a PA-16 sigue pendiente
de evaluación de la contraparte.

## Entorno reproducible y aislamiento

- Docker Desktop, iniciado de forma oculta; PostgreSQL oficial 17 Alpine fijado por
  digest `sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24`.
- Contenedor nuevo con etiqueta de propiedad de la ejecución, directorio de datos
  `tmpfs`, base nueva `stylo_academic_<16hex>`, puerto aleatorio publicado solo en
  `127.0.0.1` y schema `stylo_e2e_<16hex>` compatible con los guards existentes.
- Node.js v24.19.0; Next.js 16.3.8, Prisma 6.19.3 y Playwright 1.64.0 del lockfile.
  Chromium instalado: lanzamiento headless confirmado, versión 156.0.8078.4.
- El runner no carga el `.env` operativo ni reutiliza su `DATABASE_URL`. Construye
  el entorno desde variables del sistema imprescindibles; define explícitamente
  en vacío las claves del `.env.example`, que prevalecen sobre `.env*` en Next.
  Cloudinary, Mercado Pago, OpenAI y Resend quedan sin credenciales; extracción
  deshabilitada, correo en `disabled`. El navegador bloquea peticiones externas.
- Credenciales de la base y contraseñas aleatorias sintéticas se conservan únicamente
  en `tmp/academic-validation/`, ignorado por Git. No se imprimen ni incluyen en el
  manifiesto público de evidencia. Ningún rol de producción se modifica.
- El guard comprueba host local, nombre de base dedicado, schema y bandera de
  aislamiento antes de escribir fixtures. Las operaciones administrativas comprueban
  también la etiqueta de propiedad del contenedor antes de restaurar o limpiar.

La [imagen oficial de PostgreSQL](https://hub.docker.com/_/postgres) documenta las
variables de inicialización utilizadas. El digest fija el artefacto de esta ejecución;
las actualizaciones de imagen futuras deben evaluarse explícitamente.

## Escenarios preparados

La integración `tests/integration/academic-critical-flows.test.js` comprueba 22
escenarios reconocibles: seis de agenda, ocho clínicos y ocho de POS. Su prueba
contenedora se reporta aparte de esos escenarios al interpretar la salida de Node.

Agenda comprende disponibilidad/pause y dos compensaciones UTC de America/Santiago,
excepciones, bloques, permisos, reprogramación con integridad, cancelación y dos
solicitudes concurrentes que observaron el mismo cupo. La barrera del caso concurrente
sincroniza consultas reales de disponibilidad; la escritura y sus transacciones usan
PostgreSQL real, no un repositorio simulado.

Clínica comprende asignación normal, ADMIN sin permiso clínico, llegada requerida,
borrador único, revisiones de ficha, finalización incompleta, datos ópticos válidos,
privacidad del borrador, finalización atómica, inmutabilidad por servicios, adendas,
historial, reemplazo y conservación de recetas anuladas con vista comercial limitada.
No certifica eficacia ni precisión clínica de la graduación.

POS comprende cantidades/precios del servidor, cotización/confirmación, idempotencia
de venta y abono, saldo/sobrepago/medio único, comprobantes, concesiones de descuento,
caja/arqueo y permisos. Mercado Pago no se acredita como abono manual. La receta
adjunta debe ser activa, finalizada y corresponder al paciente. El diseño actual del
POS permite preparar una operación sin adjuntar receta; estas pruebas no inventan una
obligatoriedad distinta ni cambian ese alcance comercial.

`e2e/academic-critical-flows.spec.js` añade cuatro recorridos con navegador real
contra un build de producción local: reserva interna, atención/receta/finalización/
adenda, segregación de roles y cotización/abonos/comprobante. Todos inician sesión
mediante el formulario y el mecanismo de autenticación vigente. Los fixtures solo
crean usuarios con roles del baseline y datos sintéticos; no amplían permisos.
Son recorridos de escritorio Chromium, no prueba en un teléfono físico.

## Ejecución

Con Docker disponible y dependencias del lockfile instaladas:

```text
npm run test:academic -- prepare <directorio-local-de-evidencia>
npm run test:academic -- validate
npm run test:academic -- lint
npm run test:academic -- general
npm run test:academic -- integration
npm run test:academic -- build
npm run test:academic -- seed
npm run test:academic -- serve
```

En otra terminal, con el servidor local iniciado:

```text
npm run test:academic -- e2e
npm run test:academic -- backup
```

Cada comprobación guarda salida completa, hora UTC, rama, SHA, estado del árbol,
comando, duración y código de salida. Playwright guarda JSON con resultados y
artefactos de fallos. `reset` recrea únicamente el schema sintético de este contenedor,
previa comprobación de propiedad; nunca acepta una URL suministrada por el usuario.
`cleanup` elimina únicamente el contenedor de la ejecución. Los datos en tmpfs se
pierden al eliminarlo; el dump sintético de evidencia se conserva fuera del contenedor.

El backup usa `pg_dump -Fc`; la restauración crea otra base nueva y aplica
`pg_restore --exit-on-error`. Compara huellas de pacientes, atenciones, ventas y
recetas sin mostrar datos. Su resultado local no demuestra que la empresa tenga
respaldos operativos, ni acredita RPO/RTO o recuperación del despliegue productivo.

## Límites

El harness histórico de tienda incluye una carga real a Cloudinary y una llamada
opcional a sandbox Mercado Pago. No debe ejecutarse con credenciales heredadas en
esta validación. Su resultado histórico se conserva; la integración externa de
almacenamiento/pagos no se presenta como verificada de nuevo.

La documentación de despliegue universitario describe reversión de release mediante
symlink y PM2. Esa reversión de código no revierte migraciones de base; cualquier DDL
incompatible requiere recuperación o migración correctiva revisada. La documentación
de Taller conserva HTTPS autofirmado provisional, que necesita habilitación adecuada
antes de operar credenciales, pagos o webhooks externos.

Los resultados de esta intervención se incorporan a continuación únicamente después
de su ejecución. Ninguna preparación de fixture o inspección está contada como prueba
aprobada. CI no se confunde con las comprobaciones locales.
