# Validación pendiente con Óptica Stylo

Los siguientes identificadores, títulos y resultados esperados se recuperaron
del archivo `documentacion-tecnica/validacion-empresarial/escenarios-PA-01-a-PA-16.md`
del [informe abierto en Overleaf](https://www.overleaf.com/project/6aaacb55f1ea6f9811a7085e).
No se reemplaza el instrumento original ni se declara aprobada ninguna prueba.

## Conjunto de aceptación conservado

| ID | Título original | Resultado esperado del instrumento | Estado empresarial |
|---|---|---|---|
| PA-01 | Acceso y separación de sesiones | Identidades y cookies independientes; permiso insuficiente rechazado. | Pendiente |
| PA-02 | Vínculo OTP | Vínculo único; código consumido; errores genéricos y proyección limitada. | Pendiente; entrega de correo no verificada |
| PA-03 | Reserva y concurrencia | Una reserva compatible; conflicto para la competidora, sin datos ajenos. | Pendiente |
| PA-04 | Disponibilidad | Cupos actualizados; conflicto con reserva; autorización propia/global correcta. | Pendiente |
| PA-05 | Atención clínica | Exige examen y diagnóstico; atención inmutable y reserva completada. | Pendiente |
| PA-06 | Receta y reemplazo | Versión activa coherente; anterior conservada; primera emisión tardía rechazada. | Pendiente |
| PA-07 | Receta externa | Borrador revisable; confirmación humana; archivo privado y formato inválido rechazado. | Pendiente |
| PA-08 | Compra web y pago | Receta requerida; retiro exclusivo; monto exacto acreditado una vez; retorno no aprueba. | Pendiente; sin transacción externa durante esta auditoría |
| PA-09 | Probador 3D | Seguimiento local, estado claro y alternativa; sin atribuir exactitud clínica. | Pendiente; aceptación física móvil por realizar |
| PA-10 | Venta POS y descuento | Total servidor; configuración válida; descuento de un uso; cobro MP POS bloqueado. | Pendiente |
| PA-11 | Caja, abono y comprobante | Pago único; saldo y vuelto correctos; snapshot de comprobante y diferencia de caja. | Pendiente |
| PA-12 | Catálogo | SKU único, historial conservado y producto inactivo oculto en tienda. | Pendiente |
| PA-13 | Usuarios y roles | Sesiones revocadas; salvaguardas; ADMIN aislado no recibe ficha completa. | Pendiente |
| PA-14 | Reportes | Agregados acordes a datos de prueba y acceso de ADMIN/SALES permitido. | Pendiente |
| PA-15 | Correo y reintento | Estados y métricas trazables; reintento controlado; OTP obsoleto suprimido. | Pendiente; proveedor de correo deshabilitado en la configuración disponible |
| PA-16 | Pedidos y acceso ajeno | Propiedad desde sesión/carrito; acceso ajeno rechazado; sin duplicar cobro. | Pendiente |

Para cada PA registrar: resultado observado, estado efectivo, observaciones,
evidencia, fecha y hora, ambiente y SHA, dispositivo/navegador, participante y
rol, responsable de conformidad y decisión atribuible. No copiar el resultado
esperado al observado. Estados admisibles: pendiente, ejecutado conforme,
ejecutado con observaciones, no conforme o bloqueado. La conformidad requiere
participación y evidencia de la contraparte.

## Decisiones empresariales y verificaciones de la sesión

- Confirmar qué profesional y tipo de evaluación pueden anunciarse y qué
  responsables operarán la agenda y los datos clínicos.
- Confirmar canales públicos, sucursales, direcciones y horarios. La página de
  contacto ya no muestra notas internas ni datos inventados.
- Validar formalmente términos y privacidad, conservación de antecedentes y
  condiciones comerciales. Sus advertencias provisionales se conservaron.
- Confirmar precios definitivos, publicación del catálogo, disponibilidad
  referencial y condiciones de retiro. No hay inventario externo sincronizado.
- Validar convenios, seguros y reembolsos antes de publicar afirmaciones. No se
  alteraron las reseñas existentes ni se agregaron testimonios.
- Definir proveedor y modelo del terminal POS. El registro manual de
  Transbank/Getnet no acredita integración con hardware.
- Confirmar la cuenta, modo y procedimiento de Mercado Pago sandbox y verificar
  el circuito externo de pago/webhook sin activar producción ni realizar cobros.
- Preparar Resend, dominio y buzón controlado para comprobar recepción de OTP y
  correo. Las pruebas de lógica de cola no acreditan entrega.
- Validar calce y experiencia del probador en notebook y teléfono físico con
  consentimiento del participante; la emulación no equivale a aceptación móvil.
- Acordar si la sesión productiva será de consulta o incluirá escrituras
  controladas sobre registros ficticios existentes. No existen reservas futuras
  de demo ni cotizaciones guardadas al cierre de la revisión.
- Aprobar la incorporación y el despliegue de la rama antes de atribuir sus
  correcciones al sitio productivo.
