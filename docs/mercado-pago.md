# Mercado Pago Checkout Pro

La compra web de Optica Stylo usa Checkout Pro y acredita dinero exclusivamente
desde `POST /api/webhooks/mercado-pago`. Las paginas de retorno nunca confirman
el pago: solo consultan la venta conciliada.

## Configuracion segura

Guardar secretos solo en `.env.local` durante desarrollo y en el gestor de
variables del despliegue. No usar prefijos `NEXT_PUBLIC_`, no copiar secretos a
Postman y no incluirlos en logs.

```dotenv
MERCADO_PAGO_MODE=sandbox
MERCADO_PAGO_PRODUCTION_ENABLED=false
MERCADO_PAGO_PUBLIC_KEY=APP_USR-clave-publica-de-prueba
MERCADO_PAGO_ACCESS_TOKEN=APP_USR-token-de-prueba
MERCADO_PAGO_WEBHOOK_SECRET=secreto-generado-por-webhooks
APP_PUBLIC_URL=https://preview-publico.example.com

EMAIL_MODE=disabled
EMAIL_FROM=Stylo Vivo <correos@example.com>
RESEND_API_KEY=
```

Ejecutar `npm run payments:preflight`. El comando comprueba sin imprimir
credenciales que:

- el modo es `sandbox`;
- produccion continua bloqueada;
- existen URL publica y secreto de webhook;
- el Access Token es aceptado por Mercado Pago;
- el correo transaccional esta configurado.

El checkout falla de forma cerrada antes de reservar un intento si faltan la
URL publica o el secreto. Produccion requiere cambiar simultaneamente
`MERCADO_PAGO_MODE=production` y `MERCADO_PAGO_PRODUCTION_ENABLED=true`; este
segundo interruptor no se habilita hasta completar y registrar la compra de
sandbox.

## Configurar Webhooks para Checkout Pro de prueba

1. Abrir la aplicacion correcta en Mercado Pago Developers.
2. Ir a **Webhooks > Configurar notificaciones > Modo productivo**. El flujo de
   prueba actual usa el `init_point` principal con vendedor, comprador y tarjeta
   de prueba, por lo que Mercado Pago firma sus notificaciones con la clave de
   esta pestaña aunque no exista dinero real.
3. Configurar `https://DOMINIO/api/webhooks/mercado-pago`.
4. Seleccionar **Pagos (legacy)**, que es el topico `payment` usado por
   Checkout Pro.
5. Guardar, revelar la clave secreta y copiarla directamente al gestor de
   secretos como `MERCADO_PAGO_WEBHOOK_SECRET`.
6. Reiniciar o volver a desplegar la aplicacion y ejecutar el preflight.

Validacion registrada el 22 de agosto de 2026:

- URL: `https://optica-stylo.vercel.app/api/webhooks/mercado-pago`;
- evento: **Pagos (legacy)**;
- pago de prueba: `174136652675`;
- simulador oficial: `200 - OK`;
- resultado local: evento `PROCESSED`, intento `APPROVED`, venta N.º 1 `PAID`,
  CLP 223.360 conciliados y una sola fila en `sale_payments`;
- prueba negativa: una firma falsificada obtuvo `401` y no creó un abono.

El secreto se rotó durante la configuracion y solo quedó almacenado en el
entorno local ignorado por Git y como variable sensible de Vercel. Nunca debe
copiarse a la documentacion ni al repositorio.

La firma se valida mediante el SDK oficial con `x-signature`, `x-request-id` y
el `data.id` de la URL. Si falta el secreto se responde `503`; una firma falsa
se rechaza con `401` antes de consultar Payments API.

## Flujo y conciliacion

1. El checkout del carrito crea una sola venta `PENDING` y cierra el carrito.
2. Se reserva un `payment_attempt` por el saldo exacto durante 30 minutos.
3. La preferencia usa el UUID del intento como `external_reference`, el ID de
   venta en metadata y un unico item por el monto reservado exacto.
4. Las pruebas actuales de Checkout Pro usan `init_point` con vendedor,
   comprador y tarjeta de prueba. Mercado Pago las procesa en el checkout
   principal y devuelve `live_mode=true`, aunque no exista dinero real.
5. Cada webhook firmado vuelve a consultar el pago por ID en Payments API.
   Si Payments API omite `preference_id`, se consulta tambien la orden
   comercial indicada por `payment.order.id` para recuperar la preferencia.
6. Se comparan exactamente referencia, preferencia, moneda, monto entero CLP y
   el `live_mode=true` que informa Checkout Pro tanto en pruebas como en
   produccion. La separacion segura entre ambos ambientes depende de las
   credenciales del vendedor y del bloqueo explicito de produccion.
7. Solo `approved` inserta `sale_payments`, y la restriccion unica por intento
   impide registrar el pago dos veces.
8. La venta cambia a `PAID` unicamente si el total conciliado coincide.
9. En la misma transacción se encola `PAYMENT_CONFIRMED`; el webhook no espera
   al proveedor y el trabajador usa una clave idempotente propia.

Estados del proveedor:

- `approved` -> `APPROVED`;
- `pending`, `in_process`, `authorized` -> `PENDING`;
- `rejected` -> `REJECTED`;
- `cancelled`, `expired` -> `CANCELLED`;
- contracargos, reembolsos o estados desconocidos -> `REQUIRES_REVIEW`.

Un intento en `REQUIRES_REVIEW` nunca vuelve a autoaprobarse. Una aprobacion
atrasada puede acreditar el intento original, pero primero bloquea otros
intentos activos de la misma venta; cualquier segundo cobro queda para revision
y no duplica el pago ni la venta. Como cada notificacion consulta el estado
actual a Mercado Pago, eventos atrasados o fuera de orden no se procesan a
partir de su cuerpo posiblemente obsoleto.

## Reintentos, cuenta e invitado

`POST /api/store/orders/{orderId}/checkout` solo opera sobre una venta propia,
pendiente y con saldo. Una cuenta se autoriza por `customer_account_id`; un
invitado conserva acceso mediante el token opaco HttpOnly del carrito. No se
intercambian ambos mecanismos.

Mientras un intento siga vigente se devuelve la misma preferencia. Al vencer,
se cancela localmente y se crea otro intento para la misma venta; nunca se crea
otra venta. Las paginas `success`, `pending` y `failure` ignoran los parametros
de retorno como prueba de pago y consultan el pedido autorizado.

## Correo y recuperacion

El webhook no se revierte si Resend está temporalmente caído. El mensaje queda
en `transactional_email_outbox`; el trabajador lo reclama con bloqueo, registra
`FAILED` y programa un reintento exponencial con la misma clave idempotente.
También se puede ejecutar manualmente:

```bash
npm run emails:dispatch
```

La creación idempotente del pedido encola `ORDER_CONFIRMED`. La conciliación del
pago encola por separado `PAYMENT_CONFIRMED`, sin repetir ninguno aunque Mercado
Pago entregue el webhook más de una vez.

## Auditoria y monitoreo

- `payment_attempts`: monto reservado, preferencia, pago externo, estado y
  detalle del proveedor.
- `payment_provider_events`: payload valido, request ID unico, resultado y
  error de procesamiento.
- `sale_payments`: abono unico ligado al intento del proveedor.
- `sale_events`: transicion comercial causada por el pago.
- `transactional_email_outbox`: intentos, ultimo error y fecha de envio.
- logs `mercado_pago_webhook`: request ID, data ID y resultado, sin firma,
  token, secreto ni payload.

Alertar por respuestas `401` repetidas, eventos `FAILED`, intentos
`REQUIRES_REVIEW`, correos `FAILED` antiguos y ausencia de webhooks despues de
una compra iniciada.

## Rotacion del secreto

1. Abrir una ventana de mantenimiento y mantener produccion bloqueada si la
   rotacion afecta el ambiente productivo.
2. Restablecer la clave en Mercado Pago Webhooks.
3. Reemplazar `MERCADO_PAGO_WEBHOOK_SECRET` en el gestor de secretos sin
   escribirla en tickets, chat ni logs.
4. Volver a desplegar y ejecutar `npm run payments:preflight`.
5. Enviar una simulacion de `payment` y comprobar HTTP 200 y un evento
   `PROCESSED` o `IGNORED` esperado.
6. Invalidar cualquier copia temporal del secreto anterior.

La rotacion no admite dos secretos simultaneos; durante la ventana, entregas
firmadas con la clave anterior pueden recibir `401` y Mercado Pago las
reintentara. Revisar el historial de notificaciones al finalizar.

## Procedimiento ante fallos

- **Firma invalida:** no reintentar manualmente con el payload recibido;
  verificar URL, ambiente y secreto, rotar si existe sospecha de exposicion.
- **Payments API no disponible:** responder temporalmente con error; Mercado
  Pago reintenta. No acreditar desde la URL de retorno.
- **Datos no coinciden:** conservar `REQUIRES_REVIEW`, comparar el pago en el
  panel y la venta local; nunca editar directamente `sale_payments`.
- **Webhook aprobado sin correo:** ejecutar el despachador y revisar Resend. No
  volver a registrar el pago.
- **Webhook ausente:** consultar el historial de Webhooks, confirmar que la URL
  publica responde HTTPS y simular una notificacion.
- **Posible doble cobro:** detener nuevos checkouts de la venta y revisar todos
  sus intentos. Reembolsos quedan fuera de este bloque y requieren el
  procedimiento contable autorizado.

## Compra completa de sandbox

Antes de habilitar produccion:

1. desplegar esta rama en una URL HTTPS estable;
2. configurar Webhooks de prueba y ejecutar el preflight sin fallos;
3. usar una cuenta compradora de prueba distinta de la vendedora, idealmente en
   una ventana de incognito;
4. crear un carrito con productos y precios reales ya publicados;
5. pagar con una tarjeta de prueba aprobada;
6. comprobar que la pagina de retorno permanece pendiente hasta el webhook;
7. verificar una sola fila en `sale_payments`, venta `PAID`, evento del
   proveedor `PROCESSED` y correo `SENT`;
8. repetir el webhook y comprobar que no cambian los conteos;
9. probar rechazo, pendiente, firma falsa, monto/preferencia/moneda manipulados
   y una notificacion atrasada;
10. registrar fecha, venta, intento, pago externo y evidencias sin secretos.

Referencias oficiales:

- [Checkout Pro](https://www.mercadopago.cl/developers/es/docs/checkout-pro/overview)
- [URLs de retorno](https://www.mercadopago.cl/developers/es/docs/checkout-pro/configure-back-urls)
- [Webhooks y validacion de firma](https://www.mercadopago.cl/developers/es/docs/your-integrations/notifications/webhooks)
- [Prueba de integracion](https://www.mercadopago.cl/developers/es/docs/checkout-pro/integration-test)
