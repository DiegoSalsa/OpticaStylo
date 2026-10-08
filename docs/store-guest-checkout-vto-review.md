# Compra invitada, recetas y probador 3D

Fecha: 8 de octubre de 2026. Rama: `fix/store-guest-checkout-vto-ui`.
Base: `origin/main`, `4f409af75e03165e72bea345f8870d8753550598`.
Los datos del proyecto son de prueba. No se ha hecho merge a `main`.

## Causas comprobadas

| Problema | Causa | Corrección |
| --- | --- | --- |
| Receta difícil de encontrar | Solo aparecía al tener un cristal que exige receta; la compra de solo marco no mostraba una elección explícita en el carrito. | Opciones visibles de solo marco o cristales con receta. La segunda lleva a elegir los cristales publicados; el carrito muestra carga de foto e ingreso manual cuando corresponde. |
| El carrito parece vacío después de agregar | La pantalla cargaba una sola vez y podía conservar datos anteriores al navegar. Además, varios montajes podían crear carritos y rotar la cookie simultáneamente. | Creación compartida, actualización con el carrito devuelto por el servidor, recarga al volver y navegación automática al carrito tras guardar desde el producto. El probador también comunica sus adiciones y muestra un enlace directo para configurar la receta, accesible en celular. |
| Confirmación de imagen bloqueada | La confirmación dependía de disponer de una extracción automática; una falla del lector dejaba el archivo guardado sin un camino directo para confirmar valores. | Carga y extracción separadas; vista previa privada y confirmación manual disponible aunque falle la extracción. |
| Receta perdida o vacía al volver | Se restauraban sugerencias de extracción, pero no los valores confirmados; los formularios sin guardar y los datos del comprador no se conservaban. | Campos controlados, restauración desde la receta confirmada y borrador en `sessionStorage`, separado por carrito y versión de receta. |
| Validación óptica inconsistente | La interfaz imponía eje siempre y pasos de 0,25, aunque el servidor acepta más precisión y no exige eje para cilindro cero. Los campos vacíos podían convertirse en cero. | Eje condicional, decimales coherentes con el servidor, campos vacíos nulos y validación existente conservada. Adición y distancia pupilar siguen siendo opcionales según el contrato actual. |
| Modificar cristales acumulaba selecciones | La operación agregaba filas nuevas sin reemplazar la configuración del marco. | Reemplazo atómico de los cristales montados, conservación de receta y cantidades asociadas al editar desde el carrito; eliminar un marco elimina sus cristales. |
| Pedido creado, pero checkout mostraba error | El pedido se confirmaba antes de llamar a Mercado Pago. Un error posterior podía ocultar el pedido y dejar el carrito cerrado sin una salida clara. | Resultado pendiente recuperable, acceso al pedido y botón para reintentar el pago. Se conserva y muestra el pedido existente. |
| Comprar nuevamente falla o impide consultar el pedido anterior | Se intentaba agregar al carrito cerrado y la nueva cookie de carrito podía reemplazar el contexto del pedido anterior. | Nuevo carrito activo para la siguiente compra y cookie HttpOnly específica del pedido para conservar acceso autorizado. |
| Checkout simultáneo produce conflicto | PostgreSQL detectó un conflicto serializable `P2034` durante la prueba real. | Bloqueo del carrito y reintentos acotados exclusivamente para conflictos transitorios. Dos solicitudes devuelven un único pedido y una sola notificación. |
| Badges VTO incorrectos | La categoría FRAME se usaba como disponibilidad; además, consultar solo la tabla de assets ignoraba los dos modelos publicados en el manifiesto estático aprobado. | Disponibilidad derivada del manifiesto existente y de assets activos, con validación real del GLB y metadatos, asociada al SKU del producto activo. |
| Cristales de prueba ausentes en preview | Un build de producción también ocultaba los datos de prueba en Vercel Preview. | Los previews incluyen esos datos. Se conserva la restricción existente para despliegues que no son de prueba. |

Los endpoints de receta ya admitían autenticación opcional: la falla no se resolvió quitando permisos ni obligando al invitado a registrarse.

## Cómo comprar sin cuenta

1. Elegir el marco y marcar **No necesito receta — solo marco**, o seleccionar un cristal publicado.
2. Pulsar **Agregar al carrito**. La tienda espera la confirmación del servidor y abre el carrito con los productos guardados.
3. Si el cristal requiere receta, usar **Adjuntar imagen** o **Ingresar manualmente**. Una foto se guarda de forma privada; sus valores deben revisarse y confirmarse. Si el lector falla, se pueden completar manualmente conservando la imagen.
4. Completar los datos del comprador y retiro. El checkout exige una receta lista solo cuando los productos realmente la requieren.
5. Crear el pedido y abrir Mercado Pago, o consultar el estado pendiente y reintentar si el proveedor no está disponible.

Marcar **No necesito receta — comprar solo el marco** en el carrito retira los cristales y recalcula el total. No permite pagar cristales graduados omitiendo una receta obligatoria. Los cristales definidos por el negocio como sin receta continúan permitidos.

## Seguridad y consistencia

- Cookies de carrito y pedido HttpOnly, SameSite=Lax y Secure en HTTPS; tokens almacenados como hash.
- Consultar un pedido conociendo su ID no concede acceso: se comprueba el token o la cuenta propietaria. La prueba con otro navegador devuelve 404.
- Respuestas de carrito, pedidos y recetas marcadas `private, no-store`. Carritos vencidos no exponen recetas ni permiten checkout.
- Imágenes privadas en Cloudinary, accesibles mediante el endpoint autorizado del carrito. Se mantienen límites de 4 MiB, formatos admitidos y comprobación de la firma del archivo.
- Precios e importes calculados en servidor. Se conservan la verificación de pagos, conciliación y protección existente contra duplicados.
- La receta guardada sigue vinculada al carrito y al pedido. Los borradores locales no sustituyen la confirmación del servidor.
- No se agregaron migraciones. El esquema actual tiene una fila por SKU de cristal en cada carrito: si se intenta montar el mismo SKU en otro marco, se rechaza explícitamente, evitando reasignarlo silenciosamente.

## Probador y disponibilidad

Se eliminaron el contenedor **Ajustes visuales**, sus sliders de brillo y contraste, su estado y sus estilos/filtros. No se tocaron geometrías, escalas, calibraciones, GLB, metadatos aprobados, proyección ni seguimiento facial.

Los dos modelos aprobados siguen publicados: `HD0896-001` y `RB2140-901-50`. Su disponibilidad se deriva de `BUILT_IN_3D_GLASSES`, no de una nueva lista de productos. Los assets de base de datos deben estar activos y superar la validación de firma, versión, longitud, hash y metadatos. Productos inactivos, assets retirados y GLB corruptos no generan badges.

Se conservaron los fingerprints de los 17 archivos de calibración y modelos. El test de CSS permite únicamente retirar el bloque solicitado y comprueba que el resto del CSS de escritorio conserva su contenido aprobado.

## Validación

| Validación | Resultado |
| --- | --- |
| `node --test` | 696 pruebas: 695 correctas, 1 integración omitida en ejecución general, 0 fallos. |
| ESLint completo | Correcto, sin errores. |
| Prisma validate | Esquema válido. |
| Build de producción, Next 16.3.8 | Correcto. |
| Integración PostgreSQL real | 11 pruebas correctas; incluye Cloudinary real, aislamiento, edición, checkout concurrente y cliente autenticado. La integración omitida en la suite general se ejecutó aquí. |
| Mercado Pago sandbox real | Preferencia creada por 70.000 CLP; reintento devuelve el mismo pedido y preferencia. Ningún cobro efectuado. |
| E2E en navegador, escritorio y móvil | 12 de 12 correctas, sin reintentos ni fallos, en Microsoft Edge Chromium: 6 escenarios en escritorio y 6 en Pixel 7 simulado. |

Las pruebas usan un esquema PostgreSQL temporal con fixtures sintéticos y navegadores sin sesión previa. Las acciones de compra pasan por la interfaz pública; se verifica el pedido persistido sin usar herramientas administrativas para comprar. Se elimina únicamente el esquema creado por cada ejecución y sus imágenes sintéticas. El build de pruebas usa un directorio propio y no interfiere con otros worktrees.

El pooler produjo un timeout del advisory lock global de Prisma Migrate en una repetición. El runner omite ese lock solo al aplicar las migraciones existentes en el esquema aleatorio que acaba de crear y cuyo único migrador controla. Usa la [opción documentada de Prisma 6](https://docs.prisma.io/docs/orm/v6/reference/environment-variables-reference#prisma_schema_disable_advisory_lock); no modifica los locks de las compras ni la configuración de despliegue.

Escenarios E2E: receta manual con recarga y navegación atrás; foto privada con reemplazo y fallo de lector; accesorio sin receta, pedido ajeno y siguiente compra; carrito visitado antes de agregar y elección de receta/solo marco; los dos VTO y adición desde el probador; registro público y pedido de cliente autenticado. Cada escenario se ejecuta en escritorio y viewport móvil.

La revisión del preview de Vercel también comprobó, mediante su interfaz pública, los cristales de prueba, los dos badges, la adición con apertura automática del carrito y los controles de receta en escritorio y a 390 × 844.

### Evidencia conservada

- [Resultados y escenarios verificados](store-checkout-evidence/results.json).
- [Receta y opción de solo marco en escritorio](store-checkout-evidence/desktop-recipe-options.png) y [celular](store-checkout-evidence/mobile-recipe-options.png).
- [Pedido invitado generado en escritorio](store-checkout-evidence/desktop-manual-order.png) y [celular](store-checkout-evidence/mobile-manual-order.png).
- [Probador sin ajustes visuales en escritorio](store-checkout-evidence/desktop-vto.png) y [celular](store-checkout-evidence/mobile-vto.png).

Las capturas de pedidos muestran estados pendientes reales de prueba. No representan pagos aprobados ni cobros completados.

## Archivos principales

| Grupo | Archivos |
| --- | --- |
| Interfaz de compra | `src/app/carrito/cart-experience.js`, `cart.css`, `prescription-image-input.js`; `src/app/tienda/[productId]/product-detail.js`; `src/app/checkout/mercado-pago/[result]/result-experience.js`. |
| Persistencia y checkout | `src/repositories/store-repository.js`, `src/services/store-service.js`, `src/validations/store-validation.js`, `src/db/retry-transaction.js`, `src/repositories/public-request-rate-limit-repository.js`. |
| Sesión y privacidad | `src/auth/store-session.js`, `src/utils/store-response.js`, rutas de carrito, recetas y pedidos bajo `src/app/api/store/`. |
| Borradores y navegación | `src/utils/store-cart-draft.js`, `src/utils/store-client.js`. |
| VTO y catálogo | `src/services/bundled-try-on-models.js`, `src/repositories/virtual-try-on-3d-repository.js`, `src/services/store-catalog-service.js`, `src/services/virtual-try-on-3d-catalog-service.js`; `catalog-browser.js`, `featured-products.js`, interfaz/overlay/CSS del probador. |
| Pruebas y entorno | `e2e/store-guest-checkout.spec.js`, `playwright.config.mjs`, `scripts/run-store-e2e.mjs`, `seed-store-e2e.mjs`, `verify-store-sandbox-checkout.mjs`, tests focalizados, `next.config.mjs`, configuración ESLint, package y lockfile. |

## Publicación y límites de verificación

La rama se publica para revisión, sin merge a `main`. El SHA y la URL final de Vercel se entregan con el resultado del chat y en el PR.

GitHub Actions no inició sus pasos por bloqueo de facturación de la cuenta. El check informa: “The job was not started because your account is locked due to a billing issue.” Las validaciones anteriores se ejecutaron localmente con servicios reales de prueba.

No se completó un cobro en Mercado Pago. La prueba real llega a crear y reutilizar la preferencia sandbox; los E2E comprueban además la recuperación cuando no hay credencial de pago. La aprobación visual del calce con cámara física en notebook y celular sigue correspondiendo a revisión manual; los archivos de calibración y modelos permanecen idénticos y sus pruebas pasan.
