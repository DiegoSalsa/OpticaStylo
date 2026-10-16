# Segunda evaluación de Taller de Desarrollo

**Verificado el 16 de octubre de 2026, America/Santiago.** Rama `test/segunda-evaluacion`, creada desde `origin/main` (`921e1be`). Implementación: commit `e6edbca`. Sin merge ni cambios en lógica de negocio. Entorno comprobado: Windows, Node.js 25.2.1, Next.js 16.3.8, PostgreSQL 17.2 y Playwright 1.64.0.

## Auditoría y reutilización

El punto de partida contiene 115 archivos `.test.js` y dos archivos E2E de Playwright. Las cuatro áreas unitarias propuestas ya estaban correctamente cubiertas con `node:test`: se conservan sus archivos y sus 19 casos completos. Se reutilizan Playwright ya instalado, el catálogo sintético de `scripts/seed-store-e2e.mjs`, su guardia de esquema y el generador de RUT de `tests/fixtures/management-data.js`.

Las integraciones anteriores de tienda y paginación consultan servicios/repositorios; no acreditan los cuatro endpoints solicitados por HTTP. Los E2E anteriores de gestión inyectan sesiones, por lo que no se cuentan para esta evaluación. Se conservan con sus comandos originales; `playwright.config.mjs` excluye únicamente el nuevo archivo, que tiene su configuración dedicada.

## Los diez elementos evaluables

Todos los resultados de esta tabla corresponden a ejecuciones reales, sin omisiones ni reintentos automáticos.

| ID | Archivo desde la raíz del repositorio | Objetivo y expectativa | Resultado verificado |
| --- | --- | --- | --- |
| U-01 | `tests/utils/chilean-rut.test.js` | Normalizar RUT válido, aceptar K y rechazar dígito incorrecto. | **3/3 pasan** |
| U-02 | `tests/validations/appointment-validation.test.js` | Validar reserva y filtros; normalizar fecha y notas; exigir consentimiento, zona horaria y motivo de cancelación. Reloj fijo. | **7/7 pasan** |
| U-03 | `tests/services/availability-engine.test.js` | Calcular horas UTC respetando Santiago, pausas, bloqueos, cierres y horas pasadas. | **4/4 pasan** |
| U-04 | `tests/auth/password.test.js` | Hash con sal; contraseña correcta aceptada; incorrecta, hash inválido y contraseña vacía rechazados. | **5/5 pasan** |
| INT-01 | `tests/http/evaluation.test.js`, caso `INT-01` | `POST /api/auth/login`: datos inválidos 400, clave incorrecta 401, administrador 200 con cookie HttpOnly/SameSite y rol ADMIN; `/me` 200; logout 204 y sesión revocada 401. | **Pasa** |
| INT-02 | Mismo archivo, caso `INT-02` | `GET /api/products`: sin sesión/sesión inexistente 401, usuario sin permisos 403, administrador 200; producto, precio y filtros correctos; búsqueda vacía 200 y página inválida 400. | **Pasa** |
| INT-03 | Mismo archivo, caso `INT-03` | `GET /api/patients`: 401/403/200 según autorización; identidad, RUT, correo y fecha del paciente sintético; búsqueda vacía 200 y página inválida 400. | **Pasa** |
| INT-04 | Mismo archivo, caso `INT-04` | `GET /api/appointments`: 401/403/200; rango, paciente, profesional, estado y fechas exactos; filtro sin coincidencias 200 y rango invertido 400. | **Pasa** |
| E2E-01 | `e2e/evaluation.spec.js`, caso `E2E-01` | Login por formulario real → `/app/clientes` → crear cliente con formulario → 201 y aviso → recargar, buscar y abrir ficha → confirmar persistencia. | **Pasa en Chromium y Playwright UI** |
| E2E-02 | Mismo archivo, caso `E2E-02` | Login por formulario real → enlace Gestión de pedidos → buscar pedido sintético por cliente → consultar detalle → iniciar preparación → 200 → recargar y verificar estado e historial. | **Pasa en Chromium y Playwright UI** |

Las pruebas HTTP usan `fetch` contra Next.js compilado y PostgreSQL real: no invocan directamente los handlers ni sustituyen sus dependencias. Ambos E2E empiezan con un contexto de navegador nuevo y completan `/ingresar`; no utilizan cookies inyectadas, `storageState`, sesiones precreadas ni respuestas HTTP simuladas. Clientes se abre por URL después del login porque la navegación actual no contiene un enlace a ese módulo.

## Preparación y comandos

Usar un checkout de esta rama sin archivos `.env`, `.env.local`, `.env.production` ni `.env.production.local`. El runner rechaza esos archivos y no hereda `DATABASE_URL` ni secretos. Se necesita PostgreSQL con `initdb`, `pg_ctl` y `createdb`; no se necesitan Docker, un servicio PostgreSQL configurado ni credenciales externas. En Windows detecta PostgreSQL 17 en `C:\Program Files\PostgreSQL\17\bin`. Si está en otra ubicación, definir `$env:PG_BIN = 'ruta\a\PostgreSQL\bin'` antes de ejecutar.

```powershell
npm ci
npx playwright install chromium
npm run test:evaluation
```

Resultado esperado y obtenido con el último comando: **19 unitarias, 4 integraciones HTTP y 2 E2E aprobados; cero fallos y cero omitidos en la selección evaluable**. También compila Next.js y verifica la limpieza al terminar. Comandos independientes:

```powershell
npm run test:evaluation:unit
npm run test:evaluation:integration
npm run test:evaluation:e2e
npm run lint
```

## Demostración frente al profesor

Para preparar la exposición, utiliza el [guion de demostración con qué decir y qué mostrar](guion-demostracion.md).

```powershell
npm run test:evaluation:ui
```

Este comando prepara PostgreSQL y Next.js y abre la **interfaz oficial de `playwright test --ui --config playwright.evaluation.config.mjs`**. Solo muestra los dos casos evaluables. Pulsar **Run all / F5** o el botón de ejecución junto a cada caso. Seleccionar el caso para recorrer los pasos, las capturas del formulario de ingreso, las solicitudes HTTP y el estado final. Ambos casos pueden repetirse o ejecutarse individualmente: cada uno limpia su cliente o restablece el pedido.

También se puede ejecutar explícitamente mediante `npx`, con dos terminales en la raíz del mismo checkout:

```powershell
# Terminal 1: dejar abierto hasta terminar la demostración.
npm run test:evaluation:server

# Terminal 2: abrir después de ver "Servidor de evaluación listo".
npx playwright test --ui --config playwright.evaluation.config.mjs
```

Cerrar Playwright y detener la terminal del servidor al terminar. Después de `Ctrl+C` en Windows o de un cierre forzado de terminal, ejecutar `npm run test:evaluation:clean`: verifica que los puertos estén libres y elimina solamente los directorios sintéticos de la evaluación, conservando las evidencias. Si algún puerto sigue activo, se detiene sin borrar datos. Esta recuperación también se ejecutó y verificó.

## Aislamiento y evidencias

`scripts/run-evaluation.mjs` crea un clúster PostgreSQL exclusivo en `tmp/evaluation/run-<aleatorio>`, escucha solo en `127.0.0.1:55439`, crea `opticastylo_evaluation` y un esquema aleatorio, aplica ambas migraciones reales y prepara datos sintéticos. Next.js se ejecuta en `127.0.0.1:3117`; ambos puertos deben estar libres. Los clientes usan correos `example.invalid`, RUT generados y contraseñas exclusivamente sintéticas. El pedido pagado es un registro de fixture: nunca se invoca un proveedor de pagos. Correos, IA y pagos productivos quedan deshabilitados.

Los E2E limpian sus registros en `finally`. Antes de cada login E2E se limpia la cuota persistida de login **solo en esta base aislada**, permitiendo repetir la demostración; el limitador real continúa habilitado. Al finalizar normalmente se detienen Next.js y PostgreSQL y se elimina el clúster completo. Se verificaron los puertos libres y la ausencia de `runtime.json` y de directorios `run-*`.

Evidencias versionadas en [`evidencias/2026-10-16/`](evidencias/2026-10-16/): [unitarias](evidencias/2026-10-16/unitarias.txt), [integración HTTP](evidencias/2026-10-16/integracion-http.txt), [E2E y limpieza](evidencias/2026-10-16/e2e-y-limpieza.txt), [reporte JSON de Playwright](evidencias/2026-10-16/playwright-results.json), [captura de Playwright UI](evidencias/2026-10-16/playwright-ui.png) y [lint](evidencias/2026-10-16/lint.txt). Los dos casos también pasaron dos ejecuciones consecutivas en la misma sesión de Playwright UI.

Cada ejecución normal genera logs, capturas, trazas y el reporte oficial HTML en `tmp/evaluation/`, ignorado por Git. Para abrir ese reporte: `npx playwright show-report tmp/evaluation/playwright-report`. No se implementó ninguna interfaz de testing adicional.

## Resultado ampliado y límites

**Ninguno de los diez elementos evaluables quedó bloqueado o sin ejecutar.** `npm run lint` y el build de Next.js terminaron correctamente.

Como control adicional se ejecutó `npm test`: **719 casos, 697 aprobados, 16 fallidos y 6 omitidos**. Los 16 fallos corresponden a huellas SHA-256 del probador 3D y sus snapshots históricos: este Windows usa `core.autocrlf=true`, y CRLF altera las huellas exactas. Se comprobó que los blobs de `origin/main` y el contenido local normalizado a LF coinciden con las huellas esperadas. No se cambiaron esos archivos, sus huellas ni la lógica del producto. Véase [salida del control ampliado](evidencias/2026-10-16/regresion-windows.txt).

Los seis omitidos del comando general son las dos integraciones antiguas que requieren su propio runner y los cuatro casos HTTP nuevos cuando falta el entorno de evaluación. **No se cuentan como éxitos**: estos últimos sí se ejecutaron y aprobaron mediante `npm run test:evaluation`. Para el problema general de huellas en un checkout nuevo, conservar LF al clonar (`git -c core.autocrlf=false clone ...`). No se atribuye una ejecución exitosa a la suite general de este checkout.
