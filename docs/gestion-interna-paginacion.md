# Entrega: gestión interna y paginación

Fecha de validación: 10 de octubre de 2026.

Rama: `mejoras/gestioninternapaginacion`, creada desde `origin/main` actualizado
en `9f2217d`. [Rama para revisión en GitHub](https://github.com/DiegoSalsa/OpticaStylo/tree/mejoras/gestioninternapaginacion).
El commit funcional validado es `d5f20a0`; el HEAD de publicación incorpora además
este informe y se indica en la entrega del chat. La rama local `main` conservó
`f06fa1317c4c1e3aa438f64dc0cdc30c5c4bd57d`. No se realizó merge ni se creó PR.

## Implementación

| Módulo | Comportamiento implementado |
| --- | --- |
| Paginación común | Consultas con `page` y `pageSize=20`, navegación numerada acotada, anterior/siguiente, rango, total y páginas reales, estados de carga/error y reintento, controles de teclado y responsive. |
| Productos | Búsqueda por nombre/SKU y filtros combinados por categoría y actividad desde Prisma. Formularios de producto e imagen independientes. Carga de imágenes cancelable, validación de respuestas vigentes y reinicio del selector de archivos. |
| Clientes y pacientes | Búsqueda en base de datos, páginas de 20, selección conservada al recargar, protección ante detalles atrasados y reinicio explícito del editor. Los clientes con datos comerciales opcionales no rompen el listado. |
| Usuarios | Paginación y búsqueda desde el servidor, selección conservada después de actualizar y bloqueo de envíos simultáneos. Se mantienen las restricciones de roles, desactivación propia y revocación de sesiones. |
| Pedidos | Vista inicial de activos, entregados e historial. Cada estado tiene su consulta, conteo y página independientes. El historial conserva también los cancelados; las cotizaciones permanecen en el POS. Filtros por origen, estado, nombre completo, número y RUT. Detalle comercial y eventos históricos en diálogo accesible. |
| Dashboard | Agregado real de `PAID`, `IN_PREPARATION` y `READY`, independiente de las seis operaciones recientes. Reconoce `reports.read` y `sales.reports_read` para indicadores comerciales. Cada fuente diferencia carga, falta de permiso, error y cero real. |
| Cotizaciones POS | Búsqueda por número o cliente, paginación real de 20 y total coincidente. Recuperación desde la API detallada existente, con bloqueo de cargas duplicadas. |

El hook central reinicia la página cuando cambian filtros, conserva la página al
recargar después de guardar y ajusta la navegación si disminuye el total de
páginas. Cancela la solicitud anterior y comprueba la cancelación después de
interpretar la respuesta. Las búsquedas idénticas no repiten peticiones.
Los estados vacíos distinguen registros inexistentes de filtros sin coincidencias.

Los editores tienen estados independientes del listado. Al cargar un detalle no
se muestran datos editables de la selección anterior. Las mutaciones se protegen
con referencias además del estado visual, para impedir dos envíos en el mismo
ciclo de renderizado. Una actualización de pedido vuelve a consultar columnas
y conteos, incluso cuando el backend rechaza la transición por un conflicto.

## API, repositorios y rendimiento

- `GET /api/sales` mantiene `items`, `page`, `pageSize`, `total` y `totalPages`.
  Añade filtros opcionales `search`, `origin` y `view` sin cambiar los parámetros
  anteriores. `origin` admite `ONLINE`/`IN_STORE` y los alias `WEB`/`POS`.
- `view=active` incluye `PENDING`, `PAID`, `IN_PREPARATION` y `READY`;
  `view=delivered` incluye `DELIVERED`; `view=history` añade `CANCELLED`.
  El filtro `status` se intersecta con la vista solicitada.
- Nuevo `GET /api/sales/summary`, protegido por `sales.read`, devuelve
  `{ byStatus, inProcess, total }` mediante `groupBy` de Prisma, con los mismos
  filtros del listado. No descarga ventas para contar en el navegador.
- Los filtros recorren tanto `customers` como los datos comerciales históricos
  de `store_carts`, incluyendo ventas invitadas sin `customer_id`.
- Los números cortos buscan el número de venta exacto para evitar coincidencias
  accidentales dentro de todos los RUT. `#123` identifica explícitamente una
  venta. El RUT admite puntos, guion, entrada compacta y dígito `K`.
- La proyección del listado conserva su respuesta resumida y excluye líneas de
  productos, adicionales, archivos/contenido clínico, payloads de comprobantes
  y detalles de proveedores de pago. Recupera solo el comprobante más reciente
  y los montos de abonos necesarios para calcular pago y saldo. El detalle
  conserva su consulta existente.
- El listado y su conteo usan el mismo predicado dentro de una transacción con
  aislamiento `RepeatableRead`. Las relaciones se recuperan con Prisma, sin
  consultas de aplicación con SQL raw ni consultas individuales por tarjeta.
- No se añadieron índices ni migraciones. Ya existen índices por estado/fecha,
  origen/fecha y cliente/fecha, además de la unicidad del número de venta.
  Agregar B-tree sobre nombres no resolvería las búsquedas `contains` sin
  distinción de mayúsculas; no se introdujo una migración sin una medición que
  justificara otro índice.

Se mantienen los permisos de lectura y actualización existentes. El diálogo de
pedido muestra identidad comercial, productos, monturas y adicionales vendidos,
cantidades, precios, pago, saldo, entrega y estados; no presenta ficha clínica,
diagnóstico ni graduaciones clínicas. Los estados manuales siguen pasando por
la validación y transición autorizada del backend.

## Archivos principales

- `src/components/internal/pagination.js`, `pagination.css`,
  `use-paginated-resource.js` y `resource-directory.js`.
- `src/utils/pagination.js`, `rut-search.js` y `dashboard.js`.
- Las páginas de `src/app/app/{productos,clientes,pacientes,usuarios}` y
  `src/app/app/management.css`.
- `src/app/app/pedidos/{page.js,orders-board.js,order-detail.js,orders.css}`.
- `src/app/app/page.js` y `src/app/app/ventas/{pos-experience.js,pos-interface.js}`.
- `src/app/api/sales/summary/route.js`, `src/services/sale-service.js`,
  `src/validations/sale-validation.js` y los repositorios de ventas, clientes
  y pacientes.
- Pruebas de paginación, dashboard, RUT y ventas; fixture e integración de
  gestión interna; `e2e/management-pagination.spec.js` y el comando
  `npm run test:management:e2e`.

## Validaciones ejecutadas

| Comando | Resultado final |
| --- | --- |
| `npm run lint` | Aprobado, sin errores ni advertencias de ESLint. |
| `npm test` | 715 pruebas: 713 aprobadas, 2 omitidas por requerir entorno de integración aislado, 0 fallos. |
| `npm run build` | Aprobado con Next.js 16.3.8 y Turbopack. |
| `npm run test:management:e2e` | 9 pruebas de integración PostgreSQL aprobadas y 18 escenarios Playwright aprobados. Incluye compilación de producción aislada. |

La integración de gestión interna omitida en `npm test` sí se ejecutó con el
harness aislado: ocho escenarios más su prueba contenedora, sin omisiones.
La integración de compra pública invitada, también omitida por el comando
general, no se volvió a ejecutar en esta tarea.

El harness existente crea un esquema aleatorio `stylo_e2e_*`, aplica las
migraciones allí, configura servidor y pruebas para ese esquema y lo elimina
al finalizar. Los datos operativos y sus tablas no se alteraron. La ejecución
final terminó con código 0, incluyendo la limpieza del esquema.

Datos de prueba: 123 registros por directorio, 123 ventas pagadas y 123
cotizaciones, junto con pedidos de otros estados y una compra invitada.
Se verificaron páginas primera/intermedia/última, cero resultados, filtros
combinados, búsqueda fuera de los primeros cien, RUT con distintos formatos,
cambio de filtros en páginas avanzadas, creación/edición, disminución del total,
teclado, consultas idénticas sin duplicación, respuestas tardías, aislamiento de
formularios, errores recuperables, detalle, permisos y transiciones autorizadas
y rechazadas. La recuperación de cotizaciones comprobó producto, cantidad y
total conservados. La suite general mantuvo aprobadas las pruebas comerciales
existentes de precios, descuentos, pagos, conciliación y comprobantes.

Se generaron y revisaron capturas de los siete módulos a 1440, 1280, 390 y
360 píxeles, además del tablero activo completo en los cuatro tamaños. Playwright
comprobó ausencia de desbordamiento horizontal del documento y errores de
hidratación/HTML anidado en esos recorridos. En notebook el tablero conserva su
desplazamiento horizontal dentro del contenedor; en móvil utiliza columnas
verticales y permite consultar un estado mediante el filtro.
Las capturas y logs permanecen en `tmp/` ignorado por Git; no forman parte de
los commits.

El runtime no traía `npm` en su PATH. Se utilizó npm 11.6.2 temporal para ejecutar
los scripts declarados, sin cambiar dependencias ni el lockfile del proyecto.

## Commits

1. `0843795` — ADD Incorporar paginación común y proteger la selección de clientes pacientes y usuarios
2. `1c26b59` — FIX Separar formularios de productos y paginar el catálogo con filtros
3. `da72235` — UPDATE Consultar y paginar pedidos por estado con búsqueda completa y detalle comercial
4. `00b27d3` — FIX Consultar indicadores reales de pedidos y respetar permisos comerciales
5. `c7303ef` — ADD Paginar y buscar cotizaciones del POS sin alterar sus cálculos
6. `17f5aa9` — FIX Buscar RUT en su formato almacenado y precisar números de pedido
7. `d40856a` — FIX Mejorar accesibilidad de formularios y conservar clientes con datos opcionales
8. `d5f20a0` — TEST Verificar gestión interna con PostgreSQL aislado y navegador en cuatro tamaños
9. DOC Documentar implementación y validación de gestión interna

## Límites de la validación

La subida de imágenes del E2E simula la respuesta de la API: comprueba separación
de formularios, conservación del producto, carreras y reinicio del archivo, pero
no envía archivos a Cloudinary. Queda para revisión manual una subida y retirada
reales en un entorno autorizado. El contrato de almacenamiento y sus políticas
no cambiaron.

No se realizaron pagos reales, conciliaciones en producción ni nuevos cobros
de Mercado Pago. No se midió rendimiento con decenas de miles de filas ni se
realizó una auditoría completa WCAG. La revisión responsive usa Chromium/Edge
con los tamaños indicados; Safari y dispositivos físicos quedan para la
validación habitual antes de integrar.

No se modificaron checkout, webhooks, reglas de descuentos/abonos, agenda,
gestión clínica, extracción de recetas, correos, probador 3D, infraestructura
ni variables de entorno. No hay dependencias nuevas ni migraciones pendientes.
