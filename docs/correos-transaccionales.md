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

## Arquitectura implementada

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

La plantilla `PASSWORD_RECOVERY` usa solamente el identificador de la solicitud
y su ámbito desde la outbox. El enlace se deriva recién al renderizar el correo
con una clave de servidor; la outbox, la auditoría y las transiciones nunca
conservan el token ni el enlace en claro.

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
Resend, configurar un remitente de ese dominio y autorizar el trabajador
externo. El endpoint y las pruebas del webhook pueden quedar completos sin
dominio, pero la recepción de un evento real del proveedor requiere registrar
un endpoint HTTPS y su secreto de firma en Resend.

## Configuración

| Variable | Uso |
| --- | --- |
| `EMAIL_MODE` | `disabled`, `simulate`, `test` o `live`; por defecto `disabled`. |
| `EMAIL_FROM` | Remitente aceptado por Resend; obligatorio en `test` y `live`. |
| `EMAIL_DOMAIN_VERIFIED` | Debe ser `true` para permitir `live`. |
| `EMAIL_TEST_RECIPIENT` | Único destino efectivo obligatorio en `test`. |
| `RESEND_API_KEY` | Secreto del adaptador; nunca se registra. |
| `RESEND_WEBHOOK_SECRET` | Secreto de firma Svix del endpoint de Resend. |
| `CRON_SECRET` | Secreto independiente y compartido únicamente entre Vercel y GitHub Actions. |
| `EMAIL_PROVIDER_TIMEOUT_MS` | Timeout HTTP; valor provisional `8000`. |
| `EMAIL_BATCH_SIZE` | Máximo reclamado por ejecución; valor provisional `20`. |
| `EMAIL_LOCK_SECONDS` | Vencimiento del reclamo; valor provisional `60`. |
| `EMAIL_MAX_ATTEMPTS` | Intentos antes de dead letter; valor provisional `6`. |
| `EMAIL_RETRY_BASE_SECONDS` | Base exponencial; valor provisional `30`. |
| `EMAIL_RETRY_MAX_SECONDS` | Tope de espera; valor provisional `3600`. |
| `EMAIL_APPOINTMENT_REMINDER_HOURS` | Anticipación provisional; valor `24`. |
| `APP_TIME_ZONE` | Debe ser `America/Santiago`. |
| `PASSWORD_RESET_APP_ORIGIN` | Origen público validado que se usa al renderizar la recuperación. |
| `PASSWORD_RESET_TOKEN_SECRET` | Clave de servidor de al menos 32 bytes para derivar el token efímero. |

En producción `simulate` se rechaza, y `live` falla de forma cerrada si falta
la clave, el remitente o la confirmación explícita del dominio. `test` conserva
`recipient_email` como destino original y guarda el destino efectivo separado.

## Ejecución y administración

- `GET` o `POST /api/internal/transactional-emails/process` exige
  `Authorization: Bearer {CRON_SECRET}`, usa un lote acotado y nunca devuelve
  destinatarios. La comparación se realiza sobre hashes con tiempo constante.
- `GET /api/admin/transactional-emails` exige sesión y el permiso
  `transactional_emails.manage`; entrega conteos, antigüedad, última ejecución y
  diagnóstico sin secretos.
- `POST /api/admin/transactional-emails/{emailId}/retry` exige el mismo permiso
  y limita a diez reintentos por administrador y hora.
- `POST /api/webhooks/resend` verifica `svix-id`, `svix-timestamp` y
  `svix-signature` contra el cuerpo crudo antes de interpretar el evento.

El plan Hobby de Vercel solo permite una ejecución diaria y no sirve para un
trabajador cada cinco minutos. Por eso el repositorio no contiene una
configuración de Vercel Cron. La función de Vercel solo hospeda el endpoint.

`.github/workflows/procesarcorreos.yml` programa la invocación desde GitHub
Actions cada cinco minutos, pero el trabajo programado queda desactivado de
forma segura mientras la variable de repositorio `EMAIL_WORKER_ENABLED` no sea
exactamente `true`. `workflow_dispatch` permite una ejecución manual.

Para activar el trabajo externo se debe:

1. Crear un secreto aleatorio de al menos 16 caracteres.
2. Guardar el mismo valor como `CRON_SECRET` en Vercel Producción y como secreto
   `CRON_SECRET` de GitHub Actions.
3. Mantener `EMAIL_MODE=disabled` hasta completar la prueba controlada, cambiar
   primero a `test` y comprobar el destinatario único.
4. Definir `EMAIL_WORKER_ENABLED=true` como variable del repositorio solo cuando
   se autorice el procesamiento periódico.
5. Habilitar `live` únicamente después de verificar el dominio, remitente,
   webhook y eventos reales del proveedor.

El workflow usa exclusión mutua y la cola usa reclamos con propietario,
vencimiento e idempotencia. Aun así, GitHub Actions puede retrasar una ejecución;
la programación de cinco minutos es una frecuencia objetivo, no un tiempo real
garantizado.

## Prueba externa pendiente

Sin dominio verificado se pueden ejecutar las pruebas automatizadas de firma,
idempotencia y estados, además del modo `test` con el destinatario permitido
por la cuenta de Resend. Queda pendiente registrar el endpoint HTTPS real,
configurar su secreto y observar eventos reales `email.delivered`,
`email.bounced`, `email.complained` y `email.suppressed`. La configuración
`live` no debe habilitarse para clientes antes de completar esa prueba.

Referencias vigentes consultadas:

- [Envío e idempotencia de Resend](https://resend.com/docs/api-reference/emails/send-email)
- [Verificación de webhooks de Resend](https://resend.com/docs/webhooks/verify-webhooks-requests)
- [Tipos de eventos de Resend](https://resend.com/docs/webhooks/event-types)
- [Límites de Vercel Cron](https://vercel.com/docs/cron-jobs/usage-and-pricing)
- [Programación de GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onschedule)
