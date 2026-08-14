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
- `requiresPrescription` gobierna la exigencia de receta, no la categoría.
- Una venta nace como `QUOTATION`; sus líneas pueden reemplazarse mientras siga
  en ese estado.
- Cada línea guarda SKU, nombre, categoría y precio del momento. Cambiar el
  catálogo después no altera ventas anteriores.
- Al confirmar una cotización pasa a `PENDING` y su composición queda congelada.
- Si alguna línea requiere receta, la venta debe indicar una receta `ACTIVE`
  perteneciente a una atención `FINALIZED`.
- Se permiten varios abonos, sin exceder el saldo.
- El primer abono fija el medio de pago de la venta. Por ahora no se mezclan
  medios dentro de una misma venta.
- Al completar el saldo, el estado cambia automáticamente de `PENDING` a `PAID`.
- Ventas, abonos y eventos históricos no tienen endpoints de eliminación.

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

### Crear cotización

`POST /api/sales`

```json
{
  "customerId": "uuid-del-cliente",
  "prescriptionId": null,
  "items": [
    {
      "productId": "uuid-del-marco",
      "quantity": 1
    }
  ]
}
```

Para una venta con lentes de receta, `prescriptionId` debe contener una receta
utilizable. La receta puede pertenecer a un paciente distinto del cliente.

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
  "paymentMethod": "BANK_TRANSFER",
  "reference": "Transferencia 12345"
}
```

Respuesta: `201 Created`. `reference` es opcional. La respuesta devuelve
`paidCents`, `balanceCents`, todos los abonos y el estado resultante.

Si la venta mantiene un intento electrónico vigente, el abono manual responde
`409 PAYMENT_ATTEMPT_ACTIVE`. El checkout y la conciliación de Mercado Pago se
documentan en `docs/mercado-pago.md`.

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

La vista comercial de receta incluida en una venta no expone graduaciones ni
metadatos internos: solo identificador, versión, estado y paciente.

## Errores comerciales relevantes

- `409 PRESCRIPTION_REQUIRED`: una línea exige receta y no se indicó una.
- `409 PRESCRIPTION_NOT_USABLE`: receta anulada o atención sin finalizar.
- `409 PRODUCT_INACTIVE`: un producto fue desactivado.
- `409 PAYMENT_METHOD_MISMATCH`: se intentó mezclar medios de pago.
- `409 PAYMENT_EXCEEDS_BALANCE`: el abono supera el saldo.
- `409 PAYMENT_ATTEMPT_ACTIVE`: existe un cobro electrónico vigente.
- `409 INVALID_SALE_STATUS_TRANSITION`: la transición no respeta el flujo.
- `409 SALE_HAS_PAYMENTS`: no se cancela por este flujo una venta con abonos.

Estas reglas son provisionales y están concentradas en validaciones, servicios y
la migración comercial para poder ajustarlas cuando se confirme el proceso real
con la clienta.
