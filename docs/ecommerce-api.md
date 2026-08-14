# API de comercio electrónico

La etapa 5 reutiliza las ventas y los pagos comerciales como núcleo operativo.
Un carrito confirmado crea una venta `ONLINE` en estado `PENDING`; no existe un
segundo modelo de pedidos que pueda divergir de la venta atendida por el
negocio.

## Identidad del comprador

Paciente, cliente y cuenta web siguen siendo conceptos independientes:

- una cuenta web pertenece a un cliente comercial;
- ese cliente puede o no estar vinculado a un paciente;
- comprar como invitado no crea una cuenta;
- una receta clínica existente solo puede seleccionarse desde una cuenta cuyo
  cliente esté vinculado al paciente de la receta.

Las cuentas web usan la cookie `opticastylo_customer_session`, separada de las
sesiones internas. Los carritos usan `opticastylo_store_cart`. Ambas son
`HttpOnly`, `SameSite=Lax` y `Secure` en producción.

### Cuentas

- `POST /api/store/accounts/register`
- `POST /api/store/accounts/login`
- `POST /api/store/accounts/logout`
- `GET /api/store/accounts/me`

El registro solicita RUT, nombres, apellidos, teléfono, correo, dirección y una
contraseña de al menos 15 caracteres. Si el RUT ya pertenece a un cliente del
negocio, no se vincula automáticamente: responde
`409 CUSTOMER_ACCOUNT_REQUIRES_LINKING` para evitar apropiaciones de identidad.

## Catálogo público

- `GET /api/store/products?page=1&pageSize=20&search=&category=`
- `GET /api/store/products/{productId}`

Solo se exponen productos activos. Las categorías disponibles son:

- `FRAME`
- `PRESCRIPTION_LENS`
- `TREATMENT`
- `ACCESSORY`
- `OTHER`

Tratamientos y adicionales se representan como productos separados y, por lo
tanto, siempre suman su precio como una línea adicional. Los valores continúan
siendo administrables hasta confirmarlos con la óptica.

La disponibilidad responde temporalmente:

```json
{
  "available": true,
  "exactQuantityKnown": false,
  "source": "MOCK"
}
```

No se inventa una cantidad de stock antes de la integración de la etapa 6.

## Carrito

### Crear o recuperar

- `POST /api/store/cart` crea un carrito y establece su cookie.
- `GET /api/store/cart` consulta el carrito accesible por la cookie.

Una cuenta conserva un solo carrito activo. Crear otro rota el token opaco y
recupera sus líneas existentes. Un carrito expira a los 30 días.

### Productos

- `PUT /api/store/cart/items/{productId}` agrega o reemplaza la cantidad.
- `DELETE /api/store/cart/items/{productId}` elimina la línea.

Body del `PUT`:

```json
{
  "quantity": 1
}
```

El backend recalcula siempre los precios desde el catálogo. No acepta precios
enviados por el navegador.

### Comprador y entrega

`PATCH /api/store/cart` recibe la identidad comercial y el método de entrega:

```json
{
  "buyer": {
    "rut": "12345678-5",
    "firstNames": "Ana",
    "lastNames": "Pérez",
    "phone": "+56912345678",
    "email": "ana@example.com",
    "address": "Dirección de contacto"
  },
  "fulfillment": {
    "method": "DELIVERY",
    "address": "Dirección de despacho",
    "city": "Santiago",
    "region": "Región Metropolitana",
    "notes": "Opcional"
  },
  "clinicalPrescriptionId": null
}
```

`method` acepta `PICKUP` o `DELIVERY`. Hasta definir el agente externo, los
despachos quedan identificados con `shippingQuoteSource: "MOCK"` y costo cero.
Esto es deliberadamente visible en la respuesta y deberá reemplazarse antes de
producción.

## Recetas externas

### Ingreso manual

`PUT /api/store/cart/prescription/manual`

```json
{
  "rightEye": {
    "sphere": -1.25,
    "cylinder": -0.5,
    "axis": 90,
    "addition": null
  },
  "leftEye": {
    "sphere": -1,
    "cylinder": 0,
    "axis": null,
    "addition": null
  },
  "pupillaryDistance": 62,
  "fulfillmentNotes": "Opcional"
}
```

Queda inmediatamente `READY` y utiliza las mismas validaciones ópticas que las
recetas clínicas.

### Imagen y confirmación asistida

- `PUT /api/store/cart/prescription/image`: `multipart/form-data`, campo
  `image`.
- `GET /api/store/cart/prescription/image`: descarga privada para el dueño del
  carrito.
- `POST /api/store/cart/prescription/extract`: solicita lectura automática.
- `PATCH /api/store/cart/prescription/confirm`: confirma o corrige los datos.

Se aceptan JPEG, PNG, WEBP, HEIC y HEIF de hasta 8 MiB. El archivo se guarda de
forma privada en PostgreSQL durante esta etapa; antes de escalar debe migrarse a
un almacenamiento de objetos privado.

La lectura automática está desacoplada mediante un adaptador. Actualmente
responde `503 PRESCRIPTION_READER_NOT_CONFIGURED`: no se transmiten recetas a
un tercero hasta seleccionar un proveedor y acordar privacidad, retención,
costos y revisión humana. La imagen puede completarse manualmente desde ya y
queda `READY` después de confirmar sus datos.

El negocio consulta una receta externa con permisos de ventas:

- `GET /api/external-prescriptions/{prescriptionId}`
- `GET /api/external-prescriptions/{prescriptionId}/file`

## Checkout y pedidos

`POST /api/store/cart/checkout` realiza una operación idempotente:

1. bloquea el carrito;
2. valida productos activos, datos del comprador y entrega;
3. exige receta `READY` solamente si alguna línea la requiere;
4. congela nombres, categorías y precios en las líneas de venta;
5. crea una venta `ONLINE` en estado `PENDING`;
6. crea o reutiliza el intento de Mercado Pago.

Un marco sin cristales graduados puede comprarse sin receta. Repetir el checkout
no crea otra venta ni otra preferencia vigente.

Consultas posteriores:

- `GET /api/store/orders`: pedidos de la cuenta autenticada.
- `GET /api/store/orders/{orderId}`: pedido propio de una cuenta o el pedido del
  token invitado.

La respuesta pública omite información interna, otros clientes, eventos y
datos clínicos no necesarios.
