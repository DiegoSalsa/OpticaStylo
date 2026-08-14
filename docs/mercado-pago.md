# Mercado Pago Checkout Pro

La primera integración de pagos reales de Óptica Stylo utiliza Checkout Pro de
Mercado Pago. Esta entrega implementa solamente el backend; todavía no incluye
botones, redirecciones ni pantallas de resultado en el frontend.

## Configuración

Las credenciales deben existir solamente en `.env.local` o en el gestor de
secretos del ambiente de despliegue:

```dotenv
MERCADO_PAGO_PUBLIC_KEY=APP_USR-public-key-del-ambiente
MERCADO_PAGO_ACCESS_TOKEN=APP_USR-access-token-del-ambiente
MERCADO_PAGO_WEBHOOK_SECRET=clave-secreta-configurada-en-webhooks
APP_PUBLIC_URL=https://dominio-publico-de-la-aplicacion.cl
```

- El access token y la clave del webhook son secretos de servidor y nunca deben
  exponerse al navegador ni guardarse en Postman.
- La public key se reserva para la futura integración del frontend.
- `APP_PUBLIC_URL` debe ser HTTPS y públicamente accesible. Si está vacío, se
  puede crear una preferencia, pero no se configuran URLs de retorno ni el
  webhook de esa preferencia.
- `MERCADO_PAGO_WEBHOOK_SECRET` es la clave secreta que entrega la sección
  Webhooks de Mercado Pago. No corresponde a la contraseña ni al código de
  verificación del usuario de prueba.

## Flujo del checkout

1. La venta debe estar confirmada, en estado `PENDING` y con saldo pendiente.
2. `POST /api/sales/{saleId}/checkout/mercado-pago` reserva un intento por 30
   minutos y crea una preferencia en Mercado Pago.
3. La respuesta incluye `checkoutUrl` y `sandboxCheckoutUrl`. El frontend futuro
   deberá redirigir al comprador a la URL apropiada.
4. Repetir el `POST` durante la vigencia devuelve el mismo intento y no crea un
   cobro duplicado.
5. `GET /api/sales/{saleId}/checkout/mercado-pago` devuelve el historial de
   intentos de esa venta.
6. Un intento vencido se cancela al solicitar un checkout nuevo y deja de
   bloquear un abono manual.

El permiso `sales.mercado_pago_checkout` está asignado a `ADMIN` y `SALES`.
Consultar intentos utiliza `sales.read`.

## Notificaciones y conciliación

`POST /api/webhooks/mercado-pago` es público porque Mercado Pago lo invoca sin
una sesión de Óptica Stylo, pero aplica estas protecciones:

- valida `x-signature`, `x-request-id`, el tipo de evento y el identificador;
- falla de forma cerrada con `503 PAYMENT_PROVIDER_NOT_CONFIGURED` si falta la
  clave del webhook;
- consulta el pago directamente a Mercado Pago después de validar la firma;
- compara referencia, preferencia, moneda y monto con el intento interno;
- registra cada evento por `x-request-id` para procesarlo una sola vez;
- acredita la venta solamente cuando el proveedor informa `approved`.

Los rechazos y cancelaciones actualizan el intento. Un reembolso, contracargo o
estado desconocido se marca como `REQUIRES_REVIEW`; no se modifica el historial
de la venta automáticamente hasta definir el procedimiento contable con la
clienta.

## Alcance pendiente para un ambiente público

Antes de probar la notificación completa se debe publicar temporalmente o
desplegar el backend, completar `APP_PUBLIC_URL`, crear el webhook de pagos en
Mercado Pago y copiar su clave secreta en `MERCADO_PAGO_WEBHOOK_SECRET`.

Referencias oficiales:

- [Introducción a Checkout Pro](https://www.mercadopago.cl/developers/es/docs/checkout-pro/overview)
- [Crear una preferencia de pago](https://www.mercadopago.cl/developers/es/docs/checkout-pro/create-payment-preference)
- [Configurar URLs de retorno](https://www.mercadopago.cl/developers/es/docs/checkout-pro/configure-back-urls)
- [Configurar y validar Webhooks](https://www.mercadopago.cl/developers/es/docs/your-integrations/notifications/webhooks)
