# Contrato visual Stitch — Stylo Vivo

Fuente obligatoria: proyecto Stitch `6640842801917583597`, revisado el 20 de agosto de 2026.

## Pantallas finales y rutas

| Pantalla Stitch | Ruta de implementación | Estado de ruta |
| --- | --- | --- |
| Inicio | `/` | Implementada con composición Stylo Vivo y catálogo real |
| Catálogo | `/tienda` | Implementada con filtros respaldados por datos disponibles |
| Detalle de producto | `/tienda/[productId]` | Implementada; no inventa variantes ni precios ópticos |
| Probador virtual 3D | `/virtual-try-on/3d` | Implementada sobre el pipeline GLB y seguimiento facial existente |
| Checkout (receta) | `/carrito` | Implementada con receta externa, datos y resumen persistente |
| Mi cuenta | `/cuenta` | Implementada con pedidos y datos reales de la cuenta |
| Dashboard admin | `/app` | Implementada con métricas y actividad obtenidas de las APIs |
| Agenda | `/app/agenda` | Implementada |
| Configuración de profesionales | `/app/agenda` (panel profesional) | Implementada dentro de Agenda con navegación diferenciada |
| Gestión clínica | `/app/ficha-clinica` | Implementada conservando permisos y datos clínicos reales |
| Ventas y cotizaciones | `/app/ventas` | Implementada como POS comercial de mostrador |
| Gestión de pedidos | `/app/pedidos` | Implementada como tablero de estados con transiciones autorizadas |
| Catálogo e inventario | `/app/productos` | Catálogo implementado; inventario permanece simulado y etapa 6 aplazada |
| Gestión de usuarios | `/app/usuarios` | Implementada con roles existentes; no existe rol recepcionista |
| Reportes y analítica | `/app/reportes` | Implementada con agregados reales y exportación CSV |

## Reglas obligatorias

- Sora para titulares e Inter para interfaz.
- Turquesa `#3DB79F`, petróleo `#073A32`, aqua `#00A3A3`, blanco y carbón `#111827`.
- Radios de 22 px, sombras suaves, cards generosas en público y mayor densidad en interno.
- El contenido real procede de las APIs. Los ejemplos visuales de Stitch no se cargan como productos, ventas, pacientes ni datos clínicos.
- La disponibilidad continúa siendo informativa hasta etapa 6.
- No se implementa inventario real, despacho ni reembolsos desde estas referencias visuales.

## Rutas existentes sin pantalla Stitch

Estas rutas no deben rediseñarse ni ampliarse sin una referencia aprobada:

- `/reservar`: reserva pública.
- `/ingresar`: ingreso interno.
- `/contacto`, `/privacidad`, `/terminos`: contenido informativo/legal.
- `/app/clientes`: gestión de clientes.
- `/app/pacientes`: gestión básica de pacientes y responsables.

La hoja de ruta requiere Reserva pública, Clientes y Pacientes, pero el proyecto final de 15 pantallas no contiene diseños dedicados para esas vistas. Se mantienen funcionales con el estilo compartido existente y quedan señaladas como referencias faltantes.

## Verificación

- Lint sin errores.
- 249 pruebas automatizadas aprobadas.
- Build de producción Next.js 16.3.0 completado.
- QA visual de escritorio y móvil sin desbordamiento horizontal en Inicio, Catálogo, Checkout, Mi cuenta y Probador 3D.
- Catálogo y carrito se validaron conectados a la base configurada sin copiar credenciales al repositorio.
- Migraciones 001–018 aplicadas en la base de pruebas; la migración 017 retiró el esquema 2D legado según la decisión aprobada.
- El catálogo 3D real queda vacío hasta disponer de productos reales y vincularles GLB libres; el modelo incluido continúa identificado como demostración.
