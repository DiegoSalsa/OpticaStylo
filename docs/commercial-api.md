# Clientes, catálogo y ventas

La etapa comercial separa tres conceptos: paciente, cliente y comprador de una
venta. Un paciente puede existir sin comprar. Un cliente puede no ser paciente y
una venta puede asociar una receta emitida para una tercera persona.

Todos los endpoints requieren la cookie de sesión. Los montos terminados en
`Cents` son enteros en pesos chilenos (CLP); el nombre conserva una unidad
monetaria explícita en el contrato y evita números decimales.

## Reglas vigentes

- El vínculo `patientId` de un cliente es opcional y único.
- `POST /api/customers` acepta todos los datos comerciales o solamente
  `patientId`; en el segundo caso copia los datos básicos actuales del paciente.
- Esa copia es un snapshot comercial y no se sincroniza automáticamente.
- Los productos tienen precio definido, se desactivan y no se eliminan.
- Categorías iniciales: `FRAME`, `PRESCRIPTION_LENS` y `OTHER`.
- `requiresPrescription` indica que el producto admite adjuntar receta; nunca bloquea una venta ni un cobro.
- La caja puede crear una venta directa con `operation: "SALE"`; nace en
  `PENDING` y queda lista para cobrar sin una confirmación intermedia.
- El cliente se solicita por defecto. Solo una venta de mostrador compuesta
  exclusivamente por monturas puede usar `customerId: null`; no puede incluir
  paciente ni receta y se identifica como venta sin cliente registrado.
- `operation: "QUOTATION"` mantiene la cotización como alternativa explícita.
  Sus líneas se pueden editar mientras siga vigente durante 30 días, y se puede
  cancelar solo si no tiene abonos.
- Cada línea guarda SKU, nombre, categoría y precio del momento. Cambiar el
  catálogo después no altera ventas anteriores.
- Al confirmar una cotización pasa a `PENDING` y su composición queda congelada.
- Una receta puede adjuntarse de forma opcional. Si se indica una receta interna,
  debe estar `ACTIVE` y pertenecer a una atención `FINALIZED`.
- Se permiten varios abonos, sin exceder el saldo.
- El primer abono fija el medio de pago de la venta. Por ahora no se mezclan
  medios dentro de una misma venta.
- Al completar el saldo, el estado cambia automáticamente de `PENDING` a `PAID`.
- Ventas, abonos y eventos históricos no tienen endpoints de eliminación.
- Cliente y paciente se mantienen separados. La venta guarda `patientId` solo
  cuando corresponde a la receta o al producto vendido.
- El POS no admite adicionales ópticos de precio libre. Los adicionales deben
  provenir de catálogo o configuración administrable; los adicionales históricos
  se conservan como parte inmutable de la operación anterior.
- Todo descuento exige motivo y una autorización temporal de una cuenta con
  permiso `sales.discounts_authorize`. La autorización registra solicitante,
  autorizador, monto, motivo, vencimiento y venta que la consumió.
- La disponibilidad que muestra el POS es simulada hasta integrar el inventario.
- Un cliente de mostrador requiere nombres. RUT, apellidos, teléfono, correo y
  dirección se pueden completar posteriormente; el correo solo es necesario si
  se solicita el envío de un comprobante.

## Estados y transiciones

```text
QUOTATION -> PENDING -> PAID -> IN_PREPARATION -> READY -> DELIVERED
     |           |
     +-----------+-> CANCELLED (solo sin abonos)
```

`PENDING` se obtiene confirmando, y `PAID` se obtiene completando el pago. No se
pueden asignar manualmente. `DELIVERED` y `CANCELLED` son terminales.

## Medios de pago

- `CASH`
- `BANK_TRANSFER`
- `MERCADO_PAGO`
- `TRANSBANK`
- `GETNET`

Los pagos manuales de transferencia, Transbank y Getnet exigen referencia o
folio y no representan integraciones automáticas. Efectivo exige monto recibido
y calcula el vuelto. Mercado Pago no se registra por el endpoint de abonos:
debe crear un intento de Checkout Pro y acreditarse solo por conciliación segura
o webhook. El primer abono fija el único medio de pago de la venta.
Una venta sin cliente registrado no puede iniciar Mercado Pago porque el
checkout seguro requiere los datos del pagador.

## Clientes

### Crear un cliente independiente

`POST /api/customers`

```json
{
  "rut": "12345678-5",
  "firstNames": "Ana",
  "lastNames": "Pérez",
  "phone": "+56912345678",
  "email": "ana@example.com",
  "address": "Avenida Central 123"
}
```

Respuesta: `201 Created`.

### Crear un cliente desde un paciente

`POST /api/customers`

```json
{
  "patientId": "uuid-del-paciente"
}
```

### Consultar y actualizar

- `GET /api/customers?page=1&pageSize=20&search=Pérez`
- `GET /api/customers/{customerId}`
- `PATCH /api/customers/{customerId}`

El `PATCH` modifica el snapshot comercial, pero no permite reemplazar el vínculo
con el paciente.

## Catálogo

### Crear producto

`POST /api/products`

```json
{
  "sku": "MARCO-001",
  "name": "Marco acetato negro",
  "category": "FRAME",
  "requiresPrescription": false,
  "unitPriceCents": 49990
}
```

Respuesta: `201 Created`. Solo `ADMIN` puede administrar el catálogo.

### Consultar, cambiar precio o desactivar

- `GET /api/products?page=1&pageSize=20&search=acetato`
- `GET /api/products?category=FRAME&isActive=true`
- `GET /api/products/{productId}`
- `PATCH /api/products/{productId}`
- `GET /api/products/{productId}/history`

Ejemplo de actualización:

```json
{
  "unitPriceCents": 52990,
  "isActive": false
}
```

## Ventas

### Crear una venta o cotización

`POST /api/sales`

```json
{
  "operation": "SALE",
  "customerId": "uuid-del-cliente",
  "patientId": null,
  "prescriptionId": null,
  "externalPrescriptionId": null,
  "items": [
    {
      "productId": "uuid-del-marco",
      "quantity": 1
    },
    {
      "productId": "uuid-de-los-cristales",
      "quantity": 1,
      "mount": {
        "source": "SOLD_FRAME",
        "frameProductId": "uuid-del-marco"
      }
    }
  ],
  "discount": {
    "amountCents": 5000,
    "reason": "Convenio empresa",
    "authorizationId": "uuid-de-la-autorizacion-temporal"
  }
}
```

`operation: "SALE"` crea una venta pendiente de cobro. Omitirlo, o usar
`operation: "QUOTATION"`, crea una cotización. Para cristales, `mount` debe
identificar una montura vendida o indicar `CUSTOMER_FRAME` sin
`frameProductId`. Los precios, el descuento y el vínculo de la montura se
verifican en el servidor.

Para una venta que adjunte receta, `prescriptionId` debe contener una receta
utilizable o `externalPrescriptionId` una receta externa confirmada. En ambos
casos se exige `patientId`. La receta puede pertenecer a un paciente distinto
del cliente. Ninguna línea exige receta para continuar al cobro.

Para una venta directa de solo marco, el POS permite enviar `customerId: null`
después de confirmar expresamente la opción. El servidor solo acepta esa
excepción si todas las líneas son `FRAME` y no se adjuntan paciente ni receta;
no crea un cliente ficticio.

### Autorizar un descuento temporal

`POST /api/sales/discount-authorization`

```json
{
  "amountCents": 5000,
  "reason": "Convenio empresa",
  "authorizerEmail": "admin@example.com",
  "authorizerPassword": "credencial-del-autorizador"
}
```

Este paso se realiza fuera del formulario de venta. Devuelve una autorización
de un único uso, válida durante cinco minutos y auditada con solicitante y
supervisor. La venta solo recibe su identificador.

### Editar y confirmar

- `PATCH /api/sales/{saleId}` reemplaza cliente, receta y líneas de una
  `QUOTATION`.
- `POST /api/sales/{saleId}/confirm` la convierte en `PENDING`.

Confirmar no recibe cuerpo. Los precios y productos se vuelven inmutables.

### Registrar abono

`POST /api/sales/{saleId}/payments`

```json
{
  "amountCents": 20000,
  "paymentMethod": "CASH",
  "cashReceivedCents": 25000,
  "reference": null
}
```

Para `BANK_TRANSFER`, `TRANSBANK` y `GETNET`, `reference` o folio es
obligatorio. En efectivo, `cashReceivedCents` debe cubrir el abono y el
servidor calcula el vuelto. La caja de prueba debe estar abierta antes de
registrar efectivo. `MERCADO_PAGO` no es admisible en este endpoint: se
acredita únicamente desde su checkout seguro, consulta, conciliación y webhook.

Respuesta: `201 Created`. La respuesta devuelve
`paidCents`, `balanceCents`, todos los abonos y el estado resultante.

Si la venta mantiene un intento electrónico vigente, el abono manual responde
`409 PAYMENT_ATTEMPT_ACTIVE`. El checkout y la conciliación de Mercado Pago se
documentan en `docs/mercado-pago.md`.

### Caja de prueba

- `GET /api/cash-register` consulta la sesión abierta.
- `POST /api/cash-register` abre una sesión con fondo inicial y observación.
- `POST /api/cash-register/{sessionId}/movements` registra ingreso o egreso
  manual con motivo.
- `POST /api/cash-register/{sessionId}/close` registra el arqueo y calcula la
  diferencia en el servidor.

### Avanzar o cancelar

`PATCH /api/sales/{saleId}/status`

```json
{
  "status": "IN_PREPARATION"
}
```

Para cancelar una cotización o venta pendiente sin abonos:

```json
{
  "status": "CANCELLED",
  "cancellationReason": "Cliente desistió de la compra"
}
```

### Consultas

- `GET /api/sales?page=1&pageSize=20`
- `GET /api/sales?status=PENDING&customerId={customerId}`
- `GET /api/sales/{saleId}`
- `GET /api/sales/{saleId}/history`

### Comprobantes inmutables y correo

- `POST /api/sales/{saleId}/receipt` emite un comprobante inmutable. Para un
  abono recibe `{ "email": "cliente@example.com", "paymentId": "..." }`.
- Cada abono conserva un comprobante `PAYMENT`, incluido el que completa el
  saldo. Al completar el total se crea además un comprobante `FINAL` separado.
- `GET /api/sales/{saleId}/receipt` consulta el comprobante más reciente.
- `GET /api/sales/{saleId}/receipt?receiptId={receiptId}` consulta una versión
  específica sin confundirla con abonos posteriores.
- `GET /api/sales/{saleId}/receipt/print?receiptId={receiptId}` entrega esa
  versión imprimible.

El `POST` crea el comprobante y encola su correo en la misma transacción. No
espera a Resend ni marca el mensaje como enviado. El trabajador central actualiza
`sale_receipts.email_status` al simular, aceptar, fallar o recibir un evento de
entrega. Los modos y variables se documentan en
`docs/correos-transaccionales.md`.

### Reporte operativo del POS

`GET /api/reports/sales?from=2026-08-01&to=2026-08-31&origin=IN_STORE`

El rol `SALES` recibe `sales.reports_read` y accede a totales, pagos, saldos,
descuentos, estados y evolución diaria producidos por las operaciones del POS.

La vista comercial de receta incluida en una venta no expone graduaciones ni
metadatos internos: solo identificador, versión, estado y paciente.

## Errores comerciales relevantes

- `409 PRESCRIPTION_NOT_USABLE`: receta anulada o atención sin finalizar.
- `409 PRODUCT_INACTIVE`: un producto fue desactivado.
- `409 PAYMENT_METHOD_MISMATCH`: se intentó mezclar medios de pago.
- `409 PAYMENT_EXCEEDS_BALANCE`: el abono supera el saldo.
- `409 PAYMENT_ATTEMPT_ACTIVE`: existe un cobro electrónico vigente.
- `409 INVALID_SALE_STATUS_TRANSITION`: la transición no respeta el flujo.
- `409 SALE_HAS_PAYMENTS`: no se cancela por este flujo una venta con abonos.
- `409 CASH_REGISTER_CLOSED`: se intentó registrar efectivo sin una caja de
  prueba abierta.
- `409 DISCOUNT_AUTHORIZATION_INVALID`: la autorización temporal venció, ya se
  consumió o no corresponde al descuento.
- `403 DISCOUNT_AUTHORIZATION_FAILED`: las credenciales no pueden autorizar el
  descuento.
- `429 DISCOUNT_AUTHORIZATION_RATE_LIMITED`: se superó el límite temporal de
  intentos de autorización de descuentos.
- `409 RECEIPT_PAYMENT_REQUIRED`: un comprobante de abono no identificó el pago.
- `409 QUOTATION_EXPIRED`: la cotización superó su vigencia.

Estas reglas son provisionales y están concentradas en validaciones, servicios y
la migración comercial para poder ajustarlas cuando se confirme el proceso real
con la clienta.
