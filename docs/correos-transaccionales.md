# Correos transaccionales

## Auditoría inicial

Estado observado en `main` (`2a706c5`) antes de modificar la infraestructura:

- La migración `016_create_transactional_email_outbox.sql` creó una cola con
  deduplicación única, programación básica, contador de intentos y los estados
  `PENDING`, `SENDING`, `SENT` y `FAILED`.
- La creación de una cuenta encola `ACCOUNT_CREATED` dentro de la misma
  transacción que crea el cliente y su cuenta. Su clave es
  `account:{accountId}:created`.
- La reserva pública encola `APPOINTMENT_CONFIRMED` y un
  `APPOINTMENT_REMINDER` fijo a 24 horas dentro de la transacción que crea la
  reserva. No hay todavía una evaluación al despachar que omita reservas que
  posteriormente fueron canceladas o finalizadas.
- La conciliación aprobada de Mercado Pago encola `PAYMENT_CONFIRMED` dentro de
  la misma transacción que registra el pago y cambia la venta. La clave depende
  del intento de pago y la inserción tolera webhooks repetidos.
- `ORDER_CONFIRMED` está permitido por el esquema, pero no se genera en ningún
  flujo. La creación de una venta presencial tampoco encola un mensaje de
  compra confirmada.
- El despachador existente solo lista `PAYMENT_CONFIRMED`. Reclama un mensaje
  individual con un bloqueo de fila y cambia a `SENDING`, pero usa
  `updated_at` como bloqueo implícito, no registra propietario ni vencimiento,
  no limita intentos y no tiene dead letter. La llamada HTTP ocurre fuera de la
  transacción, lo que sí evita mantener el bloqueo de base de datos mientras se
  espera a Resend.
- El webhook de Mercado Pago intenta enviar el correo inmediatamente después
  de la conciliación. Esto acopla el webhook al proveedor aunque los fallos no
  revierten el pago. El script de recuperación atiende únicamente pagos.
- Hay dos implementaciones HTTP de Resend: una para pagos y otra para
  comprobantes POS. Sus modos y estados no coinciden.
- El comprobante POS se crea de forma inmutable dentro de una transacción y
  distingue abonos de comprobante final con índices únicos. Después del commit,
  el servicio lo envía directamente y actualiza `sale_receipts.email_status`.
  Un corte entre el proveedor y esa actualización deja una respuesta ambigua;
  además el comprobante no está relacionado con la outbox.
- Los registros heredados de la outbox pueden contener payloads con el
  identificador externo de Mercado Pago. La nueva arquitectura no lo necesita
  para renderizar y no debe ampliar los datos personales o clínicos guardados.

## Arquitectura objetivo

La outbox es la fuente auditable de cada intención de correo. Los servicios de
dominio solo insertan un registro idempotente dentro de su transacción. Un
trabajador reclama lotes con `FOR UPDATE SKIP LOCKED`, confirma el reclamo y
recién entonces renderiza y contacta al adaptador de proveedor. Cada resultado
se persiste en una segunda transacción y, para comprobantes, actualiza el estado
derivado de `sale_receipts` sin crear otra versión.

Los cuatro modos son explícitos:

- `disabled`: no reclama mensajes y reporta la infraestructura desactivada.
- `simulate`: reclama y finaliza como `SIMULATED` sin red.
- `test`: envía al único `EMAIL_TEST_RECIPIENT`, conservando por separado el
  destinatario original y el efectivo.
- `live`: envía al destinatario original y falla de forma cerrada si no están
  configurados la clave, el remitente y la confirmación del dominio.

El valor provisional del recordatorio es 24 horas y se configura mediante
`EMAIL_APPOINTMENT_REMINDER_HOURS`. La generación y la elegibilidad usan
`America/Santiago`; ninguna decisión depende de la zona horaria del proceso.

## Privacidad y retención

La cola conserva el correo original porque es necesario para entregar y
auditar, y en modo de prueba conserva además el destino efectivo. Los payloads
se limitan a identificadores internos, nombre de pila opcional, fechas de
reserva y datos comerciales mínimos. No se guardan ficha clínica, graduaciones,
diagnóstico, imágenes de recetas, credenciales ni encabezados de autorización.
Los errores se normalizan y truncan. No se implementa borrado automático hasta
que la clienta confirme la política de retención.

## Activación pendiente

La entrega real debe permanecer desactivada hasta verificar un dominio en
Resend, configurar un remitente de ese dominio y autorizar el cron de
producción. El endpoint y las pruebas del webhook pueden quedar completos sin
dominio, pero la recepción de un evento real del proveedor requiere registrar
un endpoint HTTPS y su secreto de firma en Resend.
