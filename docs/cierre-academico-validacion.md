# Cierre académico: validación ampliada en entorno aislado

## Referencia inicial y alcance

La auditoría del 10 de octubre de 2026 comprobó `origin/main` y el árbol local limpio en
`921e1be10f3362b21d6ba34e86a638895a11f10b`, después de `git fetch origin`.
La intervención comenzó en `codex/cierre-academico-validacion`; el usuario confirmó
conservar su renombrado a `fix/concurrencia-y-validacion` el 18 de octubre. El agente
no hace push, merge, despliegue ni modificaciones de datos de producción.

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
  Chromium headless-shell 156.0.8078.4 y Edge 155.0.4283.45 se comprobaron mediante
  lanzamiento real. El Chrome completo almacenado falló con `spawn UNKNOWN`; las
  ejecuciones finales utilizaron Edge headless. Los proyectos desktop/mobile son
  viewports de ese navegador, no dispositivos físicos.
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
Son recorridos de escritorio Edge (motor Chromium), no prueba en un teléfono físico.

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

## Resultados comprobados el 18 de octubre de 2026

`origin/main` se volvió a consultar con `git fetch origin` y conservó `921e1be`.
La rama de validación contiene los cambios separados de main. El build funcional
final es `990c20897c13d90b7a762d1edb0a3fb056f43c95`; los commits posteriores cambian
solo tests, harness y documentación, conservando idéntico código de aplicación.

| Comprobación | SHA ejecutado | Aprobadas / fallidas / omitidas | Duración del comando |
|---|---|---|---|
| Prisma validate | `183940a` | Aprobado, sin conexión productiva | 2,101 s |
| ESLint | `183940a` | Aprobado, sin advertencias | 13,842 s |
| Suite general | `183940a` | 717 / 0 / 3; total 720 | 10,926 s |
| Integración crítica nueva | `183940a` | 23 / 0 / 0; 22 escenarios y su contenedor | 3,056 s, más preparación aislada |
| Integración histórica tienda | `3950734` | 10 / 0 / 1; nueve escenarios aprobados, uno omitido y contenedor aprobado | 2,061 s |
| Integración histórica gestión | `3950734` | 9 / 0 / 0; ocho escenarios y contenedor | 1,296 s |
| E2E históricos gestión | `1112691` | 18 / 0 / 0 | 49,878 s |
| E2E históricos tienda | `1112691` | 10 / 0 / 2; desktop/mobile simulados | 52,864 s |
| E2E nuevos agenda/clínica/roles/POS | `621b01c` | 4 / 0 / 0 | 15,164 s |
| Build producción | `990c208` | Aprobado | 8,706 s |
| Restauración sintética | `621b01c` | Aprobada; huellas coincidentes | 1,005 s de pg_restore |

Las tres omisiones de la suite general son sus contenedores PostgreSQL, ejecutados
por separado con sus propios comandos y cifras. La integración de tienda omite una
comprobación de almacenamiento real en Cloudinary; el E2E de tienda omite el mismo
recorrido de imagen en sus dos proyectos. Las omisiones son explícitas: no se
presenta como comprobado un proveedor externo deshabilitado. No se suman los totales
de estas suites, porque incluyen diferentes niveles y pruebas contenedoras.

Se corrigieron cuatro defectos reproducidos:

1. Reserva simultánea: la base impedía duplicación, pero el perdedor recibía un
   `P2034` genérico. La creación de reservas ahora reutiliza el reintento acotado de
   transacción completa; al revalidar obtiene el conflicto de agenda esperado.
2. Apertura duplicada de caja: el servicio solo traducía el antiguo SQLSTATE `23505`.
   Ahora traduce también `P2002` de Prisma a un conflicto 409 y conserva otros errores.
3. Checkout concurrente: el bloqueo SQL parametrizado podía encapsular `40001` en
   `P2010`, no reconocido por el helper. Se reintenta exclusivamente esa combinación
   transitoria; un error SQL no transitorio se sigue propagando. El caso concurrente
   histórico de PostgreSQL quedó aprobado conservando un único pedido y notificación.
4. Historial clínico: un identificador `BIGSERIAL` de revisión llegaba como `BigInt`
   a `Response.json`, causando un HTTP 500 pese a pasar pruebas aisladas de servicio.
   La proyección entrega el identificador como texto sin pérdida de precisión. Una
   regresión usa un valor superior a `Number.MAX_SAFE_INTEGER`; CL-03 serializa la
   respuesta real y el E2E verifica guardar, recargar y consultar la ficha.

Los intentos iniciales también identificaron problemas del entorno/pruebas:
contaminación entre fixtures, navegador completo sin arranque, selectores de controles
incorrectos y cuotas de login acumuladas entre repeticiones. Se conservaron sus logs;
las suites PG ahora crean y eliminan su propio schema dentro de la base local dedicada,
y cada E2E nuevo limpia únicamente sus cuotas sintéticas bajo guard de aislamiento.
No se modificaron reglas de autorización, límites productivos ni tests para ocultar
fallos de aplicación. Los fallos transitorios provocados y recuperados por los casos
negativos siguen visibles en logs de Prisma; no equivalen a fallos de la suite final.

El ensayo de recuperación creó otra base nueva, restauró el dump y comparó huellas
de dos pacientes, dos atenciones, una venta y dos recetas sintéticas. El dump incluye
hashes de usuarios de prueba y se conserva localmente como artefacto privado; no debe
publicarse ni incorporarse al PDF. El informe público entrega solo resultado, conteos
y SHA-256 del dump. No acredita respaldos de producción ni metas RTO/RPO.

La captura clínica del 18 de octubre se obtuvo con login normal de profesional y
datos sintéticos en este build local. El caso de las 10:00 del 19 de octubre fue
preparado mediante los servicios normales de reserva, llegada, ficha, atención,
receta y finalización, no como una atención realizada en la empresa. La lectura
posterior a la corrección se verificó también en el navegador del informe.

El resumen auditable de cada ejecución, con SHA completo y log, está en el directorio
externo de evidencia. La aceptación PA-01 a PA-16 continúa pendiente. CI no se
confunde con las comprobaciones locales ni se declara un porcentaje de cobertura.
