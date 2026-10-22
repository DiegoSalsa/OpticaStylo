# Guion presencial — 22 de octubre de 2026

Ambiente de presentación: <https://optica-stylo.vercel.app>. Usar las cuentas y
los registros existentes. La auditoría no creó usuarios, pacientes, reservas,
ventas ni pedidos en producción. No ejecutar `demo:prepare` allí.

Las correcciones de esta rama estarán disponibles en ese sitio después de un
merge y despliegue aprobados. La versión productiva observada durante la
auditoría es `21b85b0`; no confundirla con la rama revisada.

## Antes de comenzar

Usar la cuenta administrativa existente para gestión, la cuenta comercial
existente para POS y el profesional clínico asignado a la atención para ficha
y receta. ADMIN no recibe acceso clínico completo por el solo hecho de ser
administrador. El responsable del proyecto introduce las credenciales; no
incluir contraseñas en este guion ni en capturas.

Elegir **Juan Pérez Soto**, registro ficticio ya existente del material de
demostración, y su cliente vinculado. Su atención y receta históricas existen.
No seleccionar pacientes reales para la presentación. La revisión encontró
ocho pacientes con dominio ficticio, ocho reservas históricas marcadas como
demo, una atención y una receta. **No hay reservas futuras de esos pacientes
ni cotizaciones guardadas en producción al cierre de la inspección.**

Reservar unos 25–30 minutos. Probar antes el navegador y la cámara de notebook.
Conservar un navegador con el pedido invitado existente si se desea mostrar
su recuperación: el ID por sí solo no concede acceso sin su sesión o carrito.

## Recorrido

| Paso | Cuenta y registro | Acción para mostrar | Resultado esperado |
|---|---|---|---|
| 1. Inicio y tienda | Visitante; Harley-Davidson HD0896 | Abrir inicio, buscar `Harley`, revisar SKU, fotografías y precio CLP. Limpiar y ordenar el catálogo. | El término aparece aplicado; los resultados proceden de la API. Disponibilidad identificada como referencial. |
| 2. Probador 3D | Visitante; HD0896 y Ray-Ban RB2140 | Abrir desde el producto, autorizar cámara, centrar rostro y cambiar de modelo. Mostrar la alternativa «Usar foto». | Se identifica el modelo elegido y se explica el permiso. El procesamiento facial permanece en el navegador. |
| 3. Cristales y receta externa | Carrito existente del navegador, si está disponible | Revisar solo marco o marco con cristales, receta manual y revisión de imagen. Mostrar los datos de referencia de `receta-externa-juan-perez.png`. | El marco solo no exige receta; los cristales graduados sí exigen confirmación humana. No afirmar stock sincronizado. |
| 4. Pedido sin cobro | Cuenta propietaria o navegador del pedido invitado existente | Abrir un pedido pendiente existente y explicar recuperación y reintento. Mostrar el estado sin completar un pago. | El retorno del proveedor no acredita pago; un pedido ajeno se rechaza. No generar un cobro durante la presentación. |
| 5. Reserva pública | Visitante; profesional publicado | Seleccionar fecha futura y una hora disponible; recorrer el formulario sin enviar. | Horarios calculados desde la agenda real. No presentar una reserva inexistente como confirmada. |
| 6. Agenda y paciente | Cuenta administrativa existente; reserva histórica de Juan | Ir a la fecha del registro histórico, revisar estados y abrir el paciente ficticio. Mostrar disponibilidad, jornada y bloqueos sin cambiarlos. | Paciente, profesional y estado coinciden; los conflictos y restricciones se explican con la evidencia técnica. |
| 7. Atención y receta | Profesional asignado; atención histórica de Juan | Consultar antecedentes, atención finalizada, receta y trazabilidad. Explicar borrador, emisión y finalización con la regresión de laboratorio. | Registro finalizado inmutable y receta conservada. No finalizar ni alterar una atención real como ejemplo. |
| 8. POS, caja y comprobante | Cuenta comercial; cliente Juan y venta ficticia existente | Buscar por SKU, preparar un ticket sin guardarlo y consultar venta, abono y comprobante existentes. Mostrar caja y arqueo en consulta. | Importes del servidor y saldo coherente. Transbank/Getnet corresponden a registro manual, no conexión con un terminal físico. |
| 9. Gestión del pedido | Cuenta administrativa o comercial; pedido existente | Buscar, abrir detalle, revisar columna de estado e historial. Mostrar las acciones disponibles sin cambiar el estado. | Estado e historial se mantienen coherentes; la consulta no altera el pedido. |
| 10. Dashboard y reportes | Cuenta con permisos comerciales | Escoger período con actividad existente, aplicar el mismo filtro dos veces y exportar CSV. | Carga finaliza, cifras corresponden al período de Santiago y exportación conserva columnas. |

Si falta un carrito o pedido propio recuperable, mostrar detalle de producto y
el pedido interno permitido, sin suplantar la sesión de un cliente. La
cotización no cuenta con un registro productivo preparado: mostrar el ticket
antes de guardarlo y declarar esa limitación. La prueba completa de crear
reserva, atención, cotización, abonos y pedido está respaldada por los ensayos
aislados; no afirmar que se ejecutó en producción.

El paso de consulta a operaciones que escriben datos en producción debe
acordarse durante la sesión con la contraparte. No cargar fixtures, cambiar
permisos, cerrar caja, finalizar atenciones, registrar abonos ficticios o
alterar pedidos para aparentar una demostración ya aprobada.

## Cierre de la sesión

Completar la [matriz PA-01 a PA-16](validacion-contraparte.md) con participante,
rol, fecha, versión, resultado observado y evidencia. Registrar diferencias y
bloqueos. Una regresión técnica satisfactoria no constituye aceptación de
Óptica Stylo.
