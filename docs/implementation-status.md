# Estado de implementación de Óptica Stylo

Actualizado el 22 de agosto de 2026. Este documento describe el código local; no implica que las migraciones nuevas estén aplicadas ni que los flujos estén habilitados en producción.

## Decisiones confirmadas

- No existe rol Recepcionista.
- Ventas trabaja en el POS del mostrador. Puede registrar y consultar datos
  básicos de pacientes para asociar recetas, pero no administra agenda, ficha
  clínica ni funciones profesionales.
- Paciente y cliente son entidades distintas y pueden vincularse explícitamente.
- Un marco puede venderse sin receta. Solo los productos marcados como `requires_prescription` la exigen.
- Se aceptan recetas externas de cualquier establecimiento, por imagen o ingreso manual. El OCR futuro solo podrá proponer valores; una persona debe confirmarlos.
- Se permiten abonos y el historial de la venta es permanente. Una venta usa un solo medio de pago.
- Se permiten descuentos manuales en POS, expresados en CLP, con motivo,
  credenciales de autorización y trazabilidad permanente.
- La compra web admite cuenta o invitado y conserva el carrito mediante cookie opaca.
- Solo se mantiene el probador 3D. La implementación 2D fue retirada.
- La disponibilidad seguirá marcada como simulada hasta integrar el inventario externo.
- Despacho, reembolsos y reglas de precios ópticos permanecen aplazados.

## Estado por etapa

### Etapa 1 — Base técnica: avanzada

Implementado: Next.js 16, PostgreSQL, pool seguro, migraciones versionadas, errores uniformes, validaciones, pruebas automatizadas, lint y build. Neon y Vercel fueron comprobados previamente.

Implementado además: cabeceras defensivas globales y validación de la firma binaria de las imágenes de recetas, no solo del MIME declarado.

Las migraciones 001–023 están aplicadas en la base configurada. Continúan
pendientes la prueba de restauración de respaldo,
observabilidad, rate limiting distribuido para accesos públicos, alertas,
presupuesto de disponibilidad y procedimientos de incidente.

### Etapa 2 — Usuarios, autenticación y permisos: avanzada

Implementado: sesiones internas seguras, bloqueo por intentos, cierre de sesión, roles ADMIN, CLINICAL_PROFESSIONAL y SALES, autorización backend, creación/edición/desactivación de usuarios, reasignación de roles con revocación de sesiones y frontend interno por permisos.

Pendiente: recuperación de contraseña, MFA para cuentas privilegiadas y pruebas E2E de navegación por rol.

### Etapa 3 — Atención de pacientes: avanzada

Implementado: pacientes, responsables, profesionales, agenda, disponibilidad, bloqueos, excepciones, reservas, historial, ficha clínica, atenciones, recetas, adendas permanentes y reserva pública. La reserva pública valida identidad sin revelar si un paciente ya existe.

Frontend implementado: reserva pública, alta y edición de pacientes/responsables, agenda filtrable, reserva interna, estados de asistencia, perfiles profesionales, horarios, bloqueos y editor de ficha clínica con examen, diagnóstico, receta, reemplazo, adendas e historial desplegable. El editor advierte cambios sin guardar, evita cargas cruzadas entre pacientes y muestra las revisiones inmutables de antecedentes y recetas.

Pendiente: vista de calendario visual, cancelación pública mediante token,
activar y observar el procesamiento periódico de confirmaciones y recordatorios,
consentimiento y textos legales validados por la clienta.

### Etapa 4 — Gestión comercial: avanzada

Implementado: clientes y pacientes separados, productos, disponibilidad
simulada, ventas, estados, abonos permanentes, medio único, Mercado Pago,
descuentos autorizados y auditables, historial, cotizaciones editables y
convertibles, POS adaptable con búsqueda, receta interna segura, receta externa
manual o mediante imagen privada sin OCR, adicionales ópticos separados,
confirmación, comprobante imprimible, correo mediante Resend y reportes básicos
alimentados por el POS.

Pendiente: cancelación autorizada, cierres de caja solo si la clienta los
solicita y reglas definitivas de precios de cristales/tratamientos. Reembolsos,
pagos combinados, despacho, OCR e inventario real permanecen fuera de alcance
por decisión expresa.

### Etapa 5 — Comercio electrónico: avanzada, no lista para producción

Implementado: catálogo real, filtros, detalle, carrito invitado/cuenta, cuenta de cliente, pedidos, receta externa por imagen o carga manual, confirmación humana y checkout real desacoplado con Mercado Pago. No se inventan productos ni stock.

Implementado en `main`: cola transaccional idempotente, trabajador concurrente,
adaptador Resend, plantillas de cuenta, reserva, recordatorio, pedido, pago y
comprobante POS, reintentos recuperables, dead letter, supresiones y webhook
firmado del proveedor.

Implementado además: páginas de retorno éxito/pendiente/fallo que no confían en la URL de regreso, consultan el estado conciliado por webhook y permiten reintentar de forma autorizada un pedido pendiente.

Implementado y desplegado: primer producto real de prueba con galería, URL pública estable, checkout de Mercado Pago con cuentas y tarjetas ficticias, conciliación exacta mediante pago + orden comercial y prueba idempotente que dejó una venta pagada con un solo abono.

Configurado y validado el webhook productivo del checkout principal: la URL estable quedó registrada en Mercado Pago, el secreto se rotó y sincronizó en Vercel, y el simulador oficial respondió `200`. La notificación firmada quedó `PROCESSED`; la venta N.º 1 continúa `PAID` por CLP 223.360 y conserva exactamente un abono. Una firma falsificada fue rechazada con `401` antes de consultar el pago.

El modo controlado de correo fue comprobado y la base conserva ocho resultados
`TEST_SENT`. `EMAIL_MODE` continúa desactivado y no existe entrega `live` porque
no hay dominio verificado. Esto no afecta ni duplica el pago conciliado.

### Etapa 6 — Inventario: aplazada

No debe implementarse todavía. Se requiere nombre y versión del software, API, autenticación, documentación, límites, webhooks, modelo de datos y ambiente de pruebas. La interfaz mock actual mantiene el acoplamiento aislado.

### Etapa 7 — Probador virtual: prototipo 3D avanzado

Implementado: seguimiento facial local con MediaPipe, Three.js, GLB calibrado de muestra, suavizado, rotación, escala, oclusión facial, fallback CPU, privacidad local y contrato de catálogo GLB versionado por producto. La interfaz, APIs, servicio, repositorio y validaciones 2D fueron eliminados; la migración 017 ya retiró su tabla histórica.

Pendiente: obtener o crear un GLB fiel por marco, comprobar derechos de uso, calibrarlo, optimizar peso/texturas, realizar QA en dispositivos y cargar el catálogo mediante la estructura creada por la migración 015. Solo se aceptan CC0-1.0, CC-BY-4.0 con atribución o activos propios de Óptica Stylo. El modelo de muestra no representa un catálogo comercial.

### Etapa 8 — Administración y reportes: avanzada sin inventario

Implementado: shell interno por roles, gestión de clientes/productos/pacientes/usuarios, agregados reales por periodo/estado/origen, ventas, pagos, saldos, descuentos, evolución diaria, productos principales y exportación CSV.

Pendiente: filtros por sucursal/profesional cuando existan esos datos confirmados, indicadores adicionales acordados con la clienta y todos los reportes de stock posteriores a etapa 6.

## Producción e infraestructura

- Aplicación actual: `https://optica-stylo.vercel.app`.
- Base confirmada: Neon `opticastylo`, proyecto `spring-forest-98534789`, São Paulo.
- Vercel usa una `DATABASE_URL` manual hacia esa base.
- Migraciones 001–023 están aplicadas en la base configurada.
- La migración 016 crea la cola de correos transaccionales; no envía mensajes por sí sola.
- La migración 017 elimina la tabla del prototipo 2D y está aplicada.
- La migración 018 habilita recetas externas privadas para ventas POS y está aplicada.
- La migración 019 conserva revisiones completas e inmutables de los antecedentes longitudinales.
- La migración 020 rechaza distancias pupilares no positivas cuando se informan.
- La migración 021 completa el flujo POS con paciente por venta, adicionales,
  autorización de descuentos, vigencia de cotizaciones, comprobantes y permisos.
- La migración 022 conserva un comprobante inmutable por abono, distingue el
  comprobante final y limita con auditoría los intentos de autorización de
  descuentos. Está aplicada junto con el código que la consume.
- El secreto productivo del webhook de Mercado Pago está configurado en Vercel y fue validado con una simulación firmada; los cobros reales continúan bloqueados explícitamente.
- La migración 023 implementa la outbox transaccional, el trabajador concurrente,
  los webhooks idempotentes y los cuatro modos de correo; está aplicada. El
  repositorio prepara GitHub Actions como programador externo, desactivado por
  defecto. Vercel Cron no se usa por incompatibilidad con la frecuencia requerida
  en el plan Hobby. La entrega `live` permanece bloqueada hasta verificar el dominio.
- No hay monitoreo, SLO ni prueba documentada de restauración.
- “Caída nula” no es una garantía realista: debe traducirse a un SLO medible, redundancia, alertas y un plan de recuperación.

## Orden recomendado restante

1. Ejecutar una prueba documentada de respaldo y restauración de la base configurada.
2. Probar por rol los flujos internos, especialmente que SALES solo vea comercio.
3. Validar edición clínica, reserva interna y agenda con datos de prueba anonimizados.
4. Confirmar reglas de precio óptico y probar recetas externas en POS.
5. Verificar un dominio de correo, validar webhooks reales y recién entonces
   autorizar el trabajador externo y el modo `live`.
6. Confirmar sucursales y retiro; mantener despacho fuera hasta recibir reglas.
7. Producir y validar GLB reales usando únicamente herramientas y activos libres o propios.
8. Incorporar inventario solo después de recibir la documentación del proveedor.
9. Ejecutar seguridad, accesibilidad, E2E, carga, monitoreo, alertas y checklist de producción.

## Información que todavía debe confirmar la clienta

- Nombre, dirección, horarios y reglas de las tres sucursales de retiro.
- Proveedor, tarifas, cobertura y cálculo de despacho.
- Precios y combinaciones permitidas para cristales, tratamientos y adicionales.
- Reglas de descuentos: quién autoriza, topes y posibles porcentajes/cupones.
- Política de cambios, anulaciones y reembolsos.
- Canales oficiales y textos de correo/WhatsApp.
- Reportes exactos, filtros, periodicidad y exportaciones.
- Software de inventario, versión, API, autenticación y documentación.
- Campos clínicos finales, consentimiento, conservación y textos legales.
- SLO objetivo, RPO, RTO y responsables de incidentes.
