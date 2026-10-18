# Guion para presentar las pruebas de Óptica Stylo

Duración orientativa: **8 a 10 minutos**, más las preguntas del profesor. Sigue el orden: **unitarias → integración → E2E**. Los textos entre comillas son una propuesta de qué decir; adáptalos a tu forma de hablar.

## Antes de la presentación

En Antigravity abre la carpeta de trabajo:

```text
C:\Users\diego\.codex\worktrees\evaluacion-dos-pruebas\OpticaStylo
```

Abre una terminal PowerShell y sitúate en esa carpeta:

```powershell
cd C:\Users\diego\.codex\worktrees\evaluacion-dos-pruebas\OpticaStylo
git branch --show-current
```

La rama debe ser `test/flujos-integracion`. Deja abiertos este guion y [el documento con los diez elementos evaluables](segunda-evaluacion.md). Las dependencias y Chromium ya estaban instalados en este equipo durante la preparación.

Para ensayar antes de la clase puedes ejecutar `npm run test:evaluation`. Espera a que termine antes de comenzar otra ejecución. Durante la presentación utiliza los tres comandos de las secciones siguientes para mostrar cada nivel por separado.

## 1. Presentación del alcance — 45 segundos

**Muestra:** la tabla de diez elementos de `segunda-evaluacion.md`.

**Di:**

> “Voy a presentar las pruebas de Óptica Stylo en tres niveles: funciones individuales, integración de endpoints y recorridos completos de usuario. Cubrí las cuatro áreas unitarias solicitadas, cuatro endpoints y dos flujos E2E. Ambos flujos incluyen el inicio de sesión mediante el formulario real.”
>
> “Primero revisé las pruebas existentes. Reutilicé las unitarias que ya estaban implementadas y añadí la cobertura HTTP y los recorridos necesarios para esta evaluación. Las unitarias y las integraciones usan node:test; para E2E uso Playwright.”

## 2. Pruebas unitarias — 2 minutos

**Ejecuta:**

```powershell
npm run test:evaluation:unit
```

**Mientras se ejecuta, di:**

> “Las pruebas unitarias comprueban funciones sin levantar el navegador ni conectarse a PostgreSQL. Aquí evalúo cuatro áreas críticas del sistema.”

| Área | Qué decir | Archivo que puedes abrir |
| --- | --- | --- |
| RUT chileno | “Compruebo que un RUT válido se normalice, que acepte el verificador K y que rechace un dígito incorrecto.” | `tests/utils/chilean-rut.test.js` |
| Reservas | “Compruebo los datos de una reserva: fecha con zona horaria, consentimiento y motivo cuando se cancela. Utilizo una fecha de referencia fija para poder repetir el resultado.” | `tests/validations/appointment-validation.test.js` |
| Disponibilidad | “Compruebo que las horas ofrecidas respeten el horario de Santiago, las pausas, los bloqueos y los cierres. También verifico que no ofrezca horas que ya pasaron.” | `tests/services/availability-engine.test.js` |
| Contraseñas | “Compruebo que la contraseña correcta sea aceptada y una incorrecta sea rechazada. También verifico los hashes con sal y los datos inválidos.” | `tests/auth/password.test.js` |

**Muestra un ejemplo corto:** abre el archivo del RUT y señala el caso `rechaza un dígito verificador incorrecto`.

**Di:**

> “Esta es la entrada: un RUT con verificador incorrecto. La función devuelve null y la aserción comprueba exactamente ese resultado. Si la función empezara a aceptar ese RUT, esta prueba fallaría.”

**Al terminar:** señala el resumen de la terminal. Debe mostrar `tests 19`, `pass 19`, `fail 0` y `skipped 0`.

**Solo después de comprobarlo, di:**

> “Las cuatro áreas reúnen 19 casos unitarios y todos acaban de pasar.”

## 3. Integración de endpoints — 2 minutos

**Ejecuta, después de que termine el comando anterior:**

```powershell
npm run test:evaluation:integration
```

**Mientras prepara el entorno, di:**

> “En este nivel envío solicitudes HTTP reales a la aplicación Next.js. El comando prepara una instancia PostgreSQL exclusiva de pruebas, aplica las migraciones y carga datos sintéticos. Así compruebo que trabajen juntos el endpoint, la autenticación, las validaciones y la base de datos.”

**Muestra:** `tests/http/evaluation.test.js`. Señala los nombres `INT-01` a `INT-04`.

| Endpoint | Qué explicar |
| --- | --- |
| `POST /api/auth/login` | “Verifico datos inválidos con 400, contraseña incorrecta con 401 y acceso válido con 200. Compruebo la cookie de sesión, el rol administrador y que cerrar sesión invalide el acceso.” |
| `GET /api/products` | “Verifico autorización y que el producto y su precio correspondan a los datos preparados. También pruebo filtros y datos inválidos.” |
| `GET /api/patients` | “Verifico autorización y que la respuesta contenga la identidad, el RUT y los datos esperados del paciente sintético.” |
| `GET /api/appointments` | “Verifico autorización y que el rango consultado devuelva la reserva correcta, con su paciente, profesional, estado y fechas.” |

**Señala `checkAuthorization` y di:**

> “En los tres listados distingo dos situaciones: una persona sin sesión recibe 401; una persona que inició sesión pero no tiene permisos recibe 403. El administrador autorizado recibe 200. Además del código HTTP, compruebo el contenido de la respuesta.”

**Al terminar:** muestra los cuatro casos aprobados y el resumen `tests 4`, `pass 4`, `fail 0`, `skipped 0`. Espera también el mensaje de limpieza del entorno.

## 4. Abrir Playwright UI — 30 segundos, más el arranque

**Ejecuta cuando haya terminado la integración:**

```powershell
npm run test:evaluation:ui
```

**Di:**

> “Ahora voy a comprobar los recorridos desde el navegador. Esta es la interfaz oficial de Playwright. Las pruebas completan el formulario de ingreso, navegan por el sistema y comprueban el resultado de las operaciones.”

Espera a que abra Playwright UI. Aparecerán `E2E-01` y `E2E-02`.

**Para presentar uno a la vez:** usa el botón **▶** junto al caso. Hacer clic en el nombre selecciona el caso para inspeccionarlo. **Run all / F5** ejecuta ambos.

Los recorridos pueden terminar en pocos segundos. Después selecciona el caso y recorre sus pasos y capturas para explicarlos con calma.

## 5. E2E-01: registrar un cliente — 1 minuto

**Ejecuta:** el caso `E2E-01 · login administrativo → crear cliente → comprobar persistencia`.

**Di:**

> “El primer flujo inicia sesión como administrador mediante el formulario real. Después entra al módulo de Clientes, completa los datos de una persona sintética y registra el cliente.”
>
> “La prueba comprueba la respuesta 201 y el aviso de creación. Luego recarga la página, busca el cliente por correo y abre su ficha. Así verifica que los datos quedaron guardados y que no fue solamente un cambio visual.”

**Cuando aparezca Passed, selecciona el caso y muestra:**

1. `Iniciar sesión con el formulario real de administrador`: captura del formulario y envío de credenciales.
2. `Entrar a Clientes y registrar datos sintéticos`: formulario y creación.
3. `Recargar, buscar y abrir la ficha guardada`: búsqueda y ficha con el correo y RUT esperados.

**Si pregunta cómo se entra a Clientes:**

> “Después de iniciar sesión, el navegador abre /app/clientes. La navegación actual no tiene un enlace a ese módulo. La autenticación y la creación se realizan con los formularios reales.”

## 6. E2E-02: modificar un pedido — 1 minuto

**Ejecuta:** el caso `E2E-02 · login administrativo → buscar pedido → detalle → cambiar estado`.

**Di:**

> “El segundo flujo comienza con una sesión de navegador nueva y vuelve a ingresar por el formulario. Luego entra a Gestión de pedidos, busca un pedido existente de los datos sintéticos y abre su detalle.”
>
> “Comprueba el cliente, el producto y el estado Pagado. Después inicia la preparación, verifica que la operación responda 200 y que el pedido aparezca en En preparación. Finalmente recarga y consulta el detalle y el historial para confirmar que el cambio persistió.”

**Cuando aparezca Passed, selecciona el caso y muestra:**

1. El paso de inicio de sesión.
2. El detalle del pedido en estado **Pagado**.
3. El paso `Iniciar preparación y verificar estado e historial después de recargar`.
4. El detalle en **En preparación** y el historial **Pagado → En preparación**.

## 7. Cierre — 30 segundos

**Solo si los resultados de la demostración lo confirman, di:**

> “En esta ejecución se aprobaron los 19 casos unitarios de las cuatro áreas, las cuatro integraciones HTTP y los dos recorridos E2E. Estos resultados y las ubicaciones de los archivos están documentados en el repositorio.”
>
> “Los datos son sintéticos. Al terminar cada flujo se elimina el cliente creado o se restablece el pedido, y se limpian las sesiones. Esto permite repetir la demostración sin acumular datos ni usar información productiva.”

Al finalizar, cierra Playwright y detén el comando de la terminal con `Ctrl+C`. En Windows ejecuta después:

```powershell
npm run test:evaluation:clean
```

Si la limpieza indica que un puerto sigue activo, termina primero esa sesión de evaluación y repite el comando.

## Respuestas breves para las preguntas del profesor

**“¿Por qué Playwright muestra solamente dos pruebas?”**

> “Porque ahí se presentan los dos E2E. Las unitarias y las cuatro integraciones se ejecutan con node:test y se muestran en la terminal.”

**“¿Qué diferencia tienen los tres niveles?”**

> “La unitaria comprueba una función. La integración comprueba una solicitud HTTP a través de varias capas y la base. El E2E comprueba un recorrido completo desde el navegador.”

**“¿El inicio de sesión se está saltando?”**

> “No. Cada E2E escribe correo y contraseña en /ingresar y envía el formulario. La aplicación crea su sesión a través del endpoint de login.”

**“¿Por qué no encuentro al cliente después de terminar?” / “¿Por qué el pedido vuelve a Pagado?”**

> “La prueba verificó que el cambio persistiera después de recargar. Una vez comprobado, ejecutó la limpieza para poder repetir el caso. El resultado anterior a la limpieza se puede revisar en la traza de Playwright.”

**“¿Se procesa un pago real?”**

> “No. El pedido ya está preparado como un registro sintético pagado. El flujo prueba el cambio de estado operativo y no contacta a un proveedor de pagos.”

**“¿Pasó también toda la suite general?”**

> “La selección evaluable sí pasó. El control general npm test registró 16 fallos de huellas de archivos 3D por diferencias de saltos de línea CRLF en Windows. Están documentados; no presento esa suite general como aprobada.”

**Si un caso falla durante la presentación:**

> “Esta ejecución falló. Voy a revisar el mensaje o el paso marcado para identificar la causa.”

Muestra el error real. Si utilizas las evidencias guardadas de `docs/testing/evidencias/2026-10-16/`, aclara que corresponden a la ejecución anterior verificada. Un caso omitido, fallido o no ejecutado no se presenta como aprobado.
