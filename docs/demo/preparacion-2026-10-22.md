# Óptica Stylo — cierre técnico de preparación

Auditoría del 21 de octubre de 2026, `America/Santiago`, para la presentación
del jueves 22. Base: `origin/main` = `21b85b0473ffbb42a23bebe9582081145d22103f`.
Rama: `fix/preparacion-demo-optica`.

La presentación será **en producción, usando cuentas y registros existentes**,
según la aclaración posterior del responsable. Las regresiones con escritura se
ejecutaron en PostgreSQL local aislado. No se sembró, migró ni modificó la base
productiva. No se hizo merge, PR ni despliegue manual.

## A. Correcciones realizadas

| Problema comprobado y causa | Archivos principales | Resultado |
|---|---|---|
| El encabezado enviaba `search`, pero el catálogo solo recibía una categoría inicial y mantenía su propia búsqueda vacía. | `src/app/tienda/page.js`, `catalog-browser.js`, `src/utils/store-catalog-query.js`, `src/components/navigation/public-header.js` | URL como fuente de búsqueda, categoría, receta, disponibilidad, orden y página; atrás/adelante y campo de búsqueda coherentes. Buscador disponible en el menú móvil. |
| Repetir categoría, búsqueda o limpiar valores ya vacíos activaba carga sin cambiar dependencias del efecto. | `src/app/tienda/catalog-browser.js` | Las acciones equivalentes no inician otra carga. Clave de consulta, cancelación, descarte de respuestas antiguas, espera máxima y reintento recuperable. Radios y casillas responden durante la navegación. |
| Orden solo sobre 24 resultados, opción Novedades sin implementación y ausencia de paginación. | `src/repositories/product-repository.js`, `src/services/store-catalog-service.js`, `src/validations/store-catalog-validation.js` | Orden global antes de `skip/take`; precio ascendente/descendente y creación descendente con desempate por ID. Páginas de 24, total y ajuste si una página deja de existir. Prueba PostgreSQL con 55 productos. |
| El filtro de receta dependía de `requiresPrescription` del marco, aunque el marco solo no requiere receta. | Catálogo, servicio y repositorio de productos | «Con receta opcional» selecciona marcos configurables; «Sin opción de receta» excluye marcos. Los cristales siguen dentro de cada marco. No se cambió la obligación de receta para cristales graduados. |
| Los productos de prueba no se distinguían en todas las superficies; el detalle insinuaba stock confirmado y mostraba miniaturas sin acción cuando no había fotos. | `src/app/tienda/[productId]/product-detail.js`, `src/components/store/featured-products.js`, catálogo | Identificación de prueba en tarjetas/detalle/inicio, disponibilidad referencial y miniaturas solo para fotografías existentes. Precios CLP del servidor conservados. |
| `/contacto` exponía notas internas; inicio atribuía especialidades, convenios, reembolsos y gratuidad no confirmados. | `src/app/contacto/page.js`, `src/app/page.js` | Contenido prudente y enlaces útiles a reserva, cuenta y compra. Sin teléfonos, direcciones, horarios o condiciones inventados. Reseñas existentes conservadas; sin nueva certificación de su fuente. |
| «Mi cuenta» construía `Promise.all` con `await` intermedios y dejaba rechazos sin manejar al entrar como invitado. | `src/app/cuenta/account-experience.js` | Primero resuelve identidad; luego adjunta manejadores a ambas consultas protegidas. Navegación anónima sin errores de página. |
| Una disponibilidad atrasada podía reemplazar la selección de otro profesional; limpiar una selección conservaba horarios anteriores. | `src/app/reservar/booking-experience.js` | Cancelación, invalidación inmediata de selección, límite de espera y mensaje recuperable. Regresión con respuesta deliberadamente atrasada. |
| Reportes podían quedar cargando al aplicar el mismo objeto de filtros. | `src/app/app/reportes/page.js` | Cada aplicación refresca el período y termina la carga. |
| Reportes cortaban días en UTC y la agrupación dependía de la zona del host. | `src/validations/report-validation.js`, `src/repositories/report-repository.js` | Rangos y agrupación en Santiago, incluidos invierno/verano. Cuatro ventas en límites del día reprodujeron $3.000 en lugar de $5.000; después de la corrección el total y día son correctos. |
| CSV usa `;`, pero el escape no protegía ese separador ni `\r`. | `src/app/app/reportes/page.js` | Un producto `Producto;CSV` se exporta entre comillas y conserva columnas. Verificado descargando el archivo desde la interfaz. |
| Carrito afirmaba «Pago real procesado» incluso en sandbox y antes de confirmar. | `src/app/carrito/cart-experience.js` | Texto condicionado a la validación de Mercado Pago; sin cambios en firmas, webhooks, acreditación ni idempotencia. |
| Preparación tenía fecha fija de septiembre y admitía una base remota con un `NODE_ENV` no productivo. | `scripts/prepare-demo-data.mjs`, `scripts/demo-configuration.mjs` | Fecha configurable o mañana en Santiago, protección de base local dedicada, cuentas aleatorias ignoradas, reutilización de fixtures y cotización/pedido idempotentes. Sigue prohibida en producción. |

Los flujos anteriores de solo marco, cristales, borrador manual persistente,
recuperación del carrito, importes del servidor, pedido único y acceso propio
ya estaban implementados; se conservaron y reprodujeron. También estaban
resueltos los controles retirados de brillo/contraste y la publicación de los
dos modelos 3D: no se reincorporaron controles ni se modificaron GLB,
metadatos, calibración o proporciones físicas.

## B. UX/UI y resoluciones

Se comprobó la rama con Playwright a **1440, 1280, 390 y 360 px**, además de
768 px en las páginas públicas. La navegación pública, catálogo, detalle,
carrito, reserva, cuenta, contacto y legales no presentan desbordamiento
horizontal. Se verificaron también gestión de productos/clientes/pacientes/
usuarios, POS, pedidos, dashboard, agenda, ficha y reportes en los cuatro
tamaños principales.

Los cambios visibles se limitan a buscador móvil y botón accesible, foco del
buscador, estado de resultados, paginación, etiquetas de prueba y disponibilidad,
contenido prudente y mensajes. Se conserva la identidad visual y la biblioteca
de componentes existente. Las tablas de reportes mantienen desplazamiento
dentro de su tarjeta en móvil.

El sitio productivo actual pasó una revisión **de lectura** de siete páginas
en cuatro resoluciones: 28 observaciones, HTTP 200, sin desbordamiento ni
errores de página detectados. Esto no acredita que la rama ya esté desplegada.

## C. Pruebas y evidencia

Entorno: Node 24.19.0, npm 11.6.2, Next 16.3.8, Prisma Client 6.19.3 y PostgreSQL
17 en contenedor nuevo con almacenamiento temporal. Ningún servicio de pago
fue habilitado para cobrar. Los comandos npm se ejecutaron mediante su
`npm-cli.js` porque npm no estaba en el PATH del ejecutor.

Última ejecución válida por suite; no sumar estas filas como casos únicos,
porque hay solapamiento entre suite general y focalizadas. Los conteos de Node
incluyen los contenedores de subpruebas cuando su runner los cuenta.

| Comprobación | Total | Aprobadas | Omitidas | Fallidas |
|---|---:|---:|---:|---:|
| `npm run prisma:validate` | 1 comando | 1 | 0 | 0 |
| `npm run lint` | 1 comando | 1 | 0 | 0 |
| `npm test` | 733 | 724 | 9 | 0 |
| `npm run build` | 1 comando | 1 | 0 | 0 |
| `npm audit --omit=dev` | 1 comando | 1; 0 vulnerabilidades | 0 | 0 |
| Integración de agenda, clínica, POS, caja y permisos | 23 | 23 | 0 | 0 |
| Integración de gestión, paginación y pedidos | 9 | 9 | 0 | 0 |
| Integración de tienda con Cloudinary real y base aislada | 11 | 11 | 0 | 0 |
| Integración de catálogo de 55 productos | 5 | 5 | 0 | 0 |
| Integración de límites diarios de reportes | 1 | 1 | 0 | 0 |
| E2E tienda, escritorio y móvil, con Cloudinary | 12 | 12 | 0 | 0 |
| E2E gestión y revisión visual | 18 | 18 | 0 | 0 |
| E2E adicionales de agenda, clínica, seguridad y POS | 4 | 4 | 0 | 0 |
| E2E nuevos de preparación | 10 | 10 | 0 | 0 |
| Selección académica: 4 archivos unitarios existentes | 19 casos en 4 archivos | 19 | 0 | 0 |
| Selección académica: 4 integraciones HTTP existentes | 4 | 4 | 0 | 0 |
| Selección académica: 2 E2E existentes | 2 | 2 | 0 | 0 |

Se conservan sin cambios los cuatro archivos unitarios elegidos, las cuatro
integraciones de `tests/http/evaluation.test.js`, los dos casos de
`e2e/evaluation.spec.js`, sus configuraciones y comandos de selección. No se
convirtió el conjunto académico en una suite mayor. Las nuevas regresiones
quedan en archivos separados. Los nueve omitidos de `npm test` requieren
entornos explícitos de integración; sus recorridos pertinentes se ejecutaron
por separado.

La ejecución inicial sin almacenamiento externo omitió dos E2E de imagen y
una integración; después se ejecutaron con Cloudinary real y pasaron. Hubo
fallas de preparación de nuevos fixtures y mezcla de datasets entre suites;
se corrigió la preparación sin relajar aserciones de negocio. También se
renombraron scripts temporales que `node --test` descubría accidentalmente.
Los logs de intentos anteriores permanecen ignorados; la tabla corresponde a
las ejecuciones finales válidas. La regresión de fechas de reporte se ejecutó
antes de corregir y falló con el total incorrecto esperado.

Probador: ambos modelos cargaron y permitieron captura con seguimiento real
de MediaPipe sobre una fuente de video simulada, en ocho combinaciones de
modelo/tamaño; no se observaron errores de página y cámara/canvas conservaron
alineación de 0 px en las mediciones. Una fuente vertical 720×1280 pasó cuatro
vistas/rotaciones móviles. Fotografía y permiso denegado con alternativa fueron
verificados. La webcam física abrió a 1280×720 y 30 FPS, con 246 inferencias
completadas y detección facial intermitente; la primera apertura había fallado
de forma recuperable. **Esta es validación física parcial, sin aceptación del
calce por una persona ni prueba en teléfono físico.**

Evidencia local en `tmp/demo-audit/` y `tmp/store-e2e/`, ignorados por Git:
`final-commands.json`, `final-*.log`, reportes JSON de Playwright, logs de
integración, capturas por resolución y diagnósticos de proveedores/probador.
No se versionan videos de personas, credenciales ni archivos temporales.

GitHub Actions no acredita CI aprobado: el job «Validar aplicación» no inició
por bloqueo de facturación de la cuenta. La anotación se verificó en la
[ejecución de la revisión base](https://github.com/DiegoSalsa/OpticaStylo/actions/runs/39344072334).
Los resultados locales anteriores sí se ejecutaron.

## D. Servicios e infraestructura

| Servicio | Implementación y configuración observadas | Verificación efectiva y límite |
|---|---|---|
| Next.js | Compilación, rutas, imágenes y cabeceras existentes conservadas. | Build local aprobado y páginas públicas productivas HTTP 200. No hubo despliegue manual. |
| PostgreSQL/Neon y Prisma | Conexión disponible; dos migraciones del repositorio y dos terminadas en la base consultada. | `SELECT 1`, consulta de estado de migraciones y healthcheck productivo correctos. Cero pendientes o inconclusas; no se ejecutó ninguna migración remota. |
| Cloudinary | Credenciales disponibles en configuración local existente. | Ping 200, carga privada, recuperación, reemplazo, confirmación manual y eliminación de los archivos sintéticos probados. No demuestra por sí solo que las variables de todos los previews coincidan. |
| OpenAI | Lector habilitado en la configuración disponible. | Consulta de credencial 200 y lectura real del PNG ficticio de referencia, con valores correctos y advertencia de revisión. No es aceptación clínica ni garantiza precisión general. |
| Mercado Pago | Configuración disponible en sandbox, producción bloqueada, dominio y firma preparados. | Credencial `/users/me` 200. Pruebas de lógica de firma, propiedad, idempotencia y retorno aprobadas. No se ejecutó un pago externo ni se comprobó una conciliación sandbox nueva durante esta auditoría. |
| Resend | API key y secreto de webhook ausentes en la configuración disponible; modo de correo disabled. | No se verificó entrega. Cola/reintentos/OTP tienen pruebas técnicas; PA-02 y la entrega de PA-15 requieren configuración y buzón controlado. |
| Terminal POS físico | Registro manual de medios existente; Mercado Pago POS deliberadamente bloqueado. | Sin integración de hardware acreditada. Falta confirmar proveedor/modelo con la óptica. |

Las credenciales se inspeccionaron sin imprimir sus valores. Las consultas de
proveedores emplearon la configuración local disponible; no se afirmó acceso
al panel de variables de Vercel ni equivalencia de todos sus entornos.
El despliegue Production publicado en GitHub figuraba exitoso para `21b85b0`;
el sitio estable responde en <https://optica-stylo.vercel.app>.

## E. Datos y procedimiento

La primera preparación limpia del laboratorio para `2026-10-22` creó ocho
pacientes de demostración, cliente vinculado, ocho reservas contando la
histórica, atención, ficha, receta, venta pagada, cotización y pedido pendiente,
además de reutilizar cuentas y catálogo académico. Repetirla conservó los
registros y números de operación sin duplicarlos. Las posteriores suites
utilizaron sus propios esquemas o reiniciaron exclusivamente el esquema local.
Los conflictos con reservas de otros fixtures se informan y conservan.

El [README de demo](README.md) documenta la fecha configurable y el aislamiento.
En producción se utilizarán los ocho pacientes ficticios ya existentes, su
cliente, atención y receta, y los pedidos existentes. La auditoría de lectura
encontró **cero reservas futuras de esos pacientes y cero cotizaciones**.
No se añadieron datos para ocultar esa carencia. El [guion productivo](guion-produccion-2026-10-22.md)
incluye la alternativa de consulta para esos pasos.

## F. Commits en orden

| SHA | Mensaje |
|---|---|
| `8c11100` | FIX Sincronizar la búsqueda, los filtros y la paginación del catálogo |
| `8e9e7f5` | UPDATE Ajustar el contenido público a la información confirmada |
| `7e1c19a` | FIX Manejar la carga de la cuenta sin rechazos de promesas |
| `4f835b0` | FIX Cancelar horarios obsoletos al cambiar la reserva |
| `a1d22a1` | FIX Preparar fechas de demostración configurables en una base aislada |
| `3b382cf` | FIX Aclarar la confirmación del pago en el carrito |
| `00906f3` | UPDATE Identificar productos de prueba y disponibilidad referencial |
| `76ff151` | FIX Corregir las fechas, la recarga y la exportación de reportes |
| `0c6dcd0` | TEST Verificar el bloqueo de la preparación sobre bases ajenas |
| `27779ce` | TEST Verificar los recorridos de demostración en escritorio y móvil |

El commit de documentación que contiene este informe se identifica por
`git log -1`; su SHA no se inserta en su propio contenido para evitar una
referencia circular. La entrega final incluye ese SHA y el listado completo.

## G. Publicación y árbol de trabajo

Destino de la publicación ordinaria, sin reescribir historial:
[fix/preparacion-demo-optica](https://github.com/DiegoSalsa/OpticaStylo/tree/fix/preparacion-demo-optica).
La entrega final confirma el SHA publicado y el estado limpio del worktree de
auditoría. El checkout original estaba en `main` local `9385f92` y tenía
eliminaciones ajenas sin confirmar; se conservó sin modificarlas. El trabajo se
realizó en un worktree independiente creado desde `origin/main`.

## H. Pendientes de la presentación

Las decisiones y las 16 pruebas empresariales están en
[validacion-contraparte.md](validacion-contraparte.md). Continúan pendientes la
aceptación de la óptica, los datos comerciales/legales no confirmados, la
entrega de correo, un circuito externo sandbox completo, el terminal POS y la
prueba física de calce con notebook/teléfono. También debe acordarse el alcance
de las escrituras durante la presentación productiva, porque no hay reservas
futuras ni cotizaciones preparadas y no se autorizó sembrarlas allí.

La incorporación y despliegue de las correcciones requieren la aprobación
solicitada por el responsable. El bloqueo de facturación de GitHub requiere
intervención de la cuenta si CI es condición obligatoria de integración.

## I. Preparación para integrar

La rama parte de la revisión remota solicitada, no contiene migraciones nuevas
ni cambios de credenciales, y conserva commits atómicos para un **merge normal
sin squash**. Las comprobaciones locales obligatorias y focalizadas finalizaron
aprobadas. Las omisiones generales están declaradas y sus suites pertinentes
se ejecutaron separadamente. No se declara CI remoto aprobado.

Está preparada técnicamente para revisión e integración normal, sujeta a
aprobación y a cualquier comprobación remota obligatoria bloqueada por
facturación. Las pruebas de aceptación siguen pendientes de la contraparte y
no se atribuyen estas correcciones a producción antes de su despliegue.
