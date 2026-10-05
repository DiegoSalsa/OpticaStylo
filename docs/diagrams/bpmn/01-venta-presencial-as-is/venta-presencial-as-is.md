# BPMN-01 — Proceso actual de venta presencial en Óptica Stylo (AS-IS)

> **BORRADOR PENDIENTE DE VALIDACIÓN CON ÓPTICA STYLO.** El repositorio no contiene un levantamiento narrativo del proceso presencial vigente. El flujo incluido en esta carpeta es una hipótesis de trabajo para entrevista y aprobación; no debe citarse como proceso AS-IS validado hasta confirmar las preguntas del final de este documento.

## Resultado de la investigación previa

Se revisó el árbol completo del repositorio (424 archivos rastreados por `rg --files`), con lectura específica del README, la documentación vigente, el esquema Prisma, la migración baseline, las interfaces y reglas de ventas, clientes, pacientes, recetas, productos, pagos, agenda y atención clínica, además de pruebas relacionadas. También se consultaron documentos técnicos eliminados del árbol actual pero conservados en el historial Git, sin restaurarlos ni modificar código.

### A. Hechos documentados utilizables como contexto AS-IS

1. El alcance solicitado por el responsable del Proyecto de Título comienza cuando un cliente llega al local de Óptica Stylo y termina con compra completada, abandono o una derivación relacionada. Esta es la única fuente explícita para el inicio y los resultados del proceso.
2. El sitio contiene una presentación pública de una **evaluación oftalmológica en sucursal con reserva de hora** (`src/app/page.js`, sección “Evaluación Oftalmológica”). Esto respalda la existencia del servicio como contexto, pero no confirma que forme parte de cada venta ni cómo se deriva al cliente desde el mostrador.
3. El sitio reproduce una reseña pública según la cual se encargaron lentes ópticos y estuvieron disponibles en menos de 24 horas (`src/app/page.js`). Esto es un indicio de preparación posterior, no una descripción suficiente del procedimiento, los responsables ni el plazo habitual.
4. El repositorio identifica expresamente información comercial todavía no confirmada: precios definitivos de cristales y adicionales, catálogo, disponibilidad y sucursales de retiro (`README.md`, “Alcance actual y límites”).
5. Un documento histórico del proyecto declara que las decisiones de comercio electrónico eran provisionales y debían revisarse al confirmar el “proceso operativo real” (`docs/ecommerce-decisions.md` en el historial Git). Esto confirma la ausencia de un levantamiento AS-IS aprobado.
6. No se encontró en el repositorio una copia, enlace o identificación bibliográfica de la tesis anterior mencionada como referencia metodológica. En consecuencia, no se extrajo ni copió contenido de ese trabajo; el nivel de detalle y la notación se guiaron por BPMN 2.0 y por las instrucciones de este encargo.

### B. Información inferida del dominio, no confirmada como práctica actual

- La distinción entre cliente, paciente y persona usuaria de la receta.
- La venta de marcos, cristales graduados y otros productos ópticos.
- La posible utilización de una receta emitida en la óptica o por un tercero.
- La posible relación entre venta, evaluación visual, preparación de lentes y retiro posterior.
- La existencia de uno o más medios de pago, comprobantes, cotizaciones y registros comerciales.

Estas ideas aparecen en el modelo de dominio y ayudan a formular preguntas. No se utilizaron como prueba de que el personal las ejecute hoy de la misma manera.

### C. Funcionalidades de la plataforma futura que se excluyen del AS-IS

- POS web, cotizaciones digitales, descuentos autorizados, abonos, caja y comprobantes electrónicos.
- Registro digital de clientes, pacientes, fichas clínicas y recetas.
- Mercado Pago, conciliación por webhook, correo transaccional y lectura automática de recetas.
- Catálogo web, pedidos en línea, retiro en tienda y probador virtual 3D.
- Estados y automatizaciones definidos por el software (`PENDING`, `PAID`, `READY`, etc.).

## Descripción textual del proceso

### Proceso actual de venta presencial en Óptica Stylo

El proceso se inicia cuando una persona llega al local de Óptica Stylo y solicita atención para resolver una necesidad de compra. Como el repositorio no documenta el procedimiento vigente, se propone que el personal de atención identifique la necesidad y presente las alternativas comerciales disponibles. Cuando la necesidad pudiera requerir una evaluación visual previa, el borrador representa una derivación a un subproceso clínico; tanto el criterio de derivación como la participación efectiva del profesional deben ser confirmados con la óptica.

Después de definir el producto y sus condiciones, el personal comunica el precio y el plazo estimado. Si el cliente rechaza la propuesta, la atención termina sin venta. Si la acepta, el borrador supone que se solicitan los datos estrictamente necesarios, se recibe el pago, se deja constancia de la venta y se entrega un comprobante. El medio usado actualmente para cada uno de estos pasos no está documentado y, por ello, el diagrama no representa ningún sistema, terminal o registro específico.

Finalmente, el borrador distingue entre productos disponibles para entrega inmediata y productos que requieren preparación y retiro posterior. En el primer caso, el cliente recibe el producto y la compra concluye; en el segundo, recibe las indicaciones de preparación o retiro y la venta queda pendiente de entrega. Esta bifurcación se incluye como hipótesis razonable respaldada sólo de forma indirecta por la reseña pública sobre elaboración de lentes, y debe validarse antes de considerar el BPMN como AS-IS definitivo.

## Participantes

| Participante | Responsabilidad en el proceso |
| --- | --- |
| Cliente | Inicia la atención presencial, comunica su necesidad, evalúa la propuesta, decide si compra y, si acepta, entrega la información y el pago requeridos. |
| Óptica Stylo — Personal de atención y ventas | Atiende la solicitud, identifica la necesidad, presenta alternativas, informa precio y plazo, formaliza la operación y coordina la entrega. La denominación exacta del cargo y sus tareas requieren validación. |
| Óptica Stylo — Profesional clínico | Participa solamente en la rama hipotética de evaluación visual previa. Debe confirmarse si interviene en la venta presencial, cuándo lo hace y si la atención ocurre en el momento o mediante una reserva separada. |

No se incorpora un pool para una entidad o sistema de pago porque el repositorio no confirma qué medios ni qué participantes externos intervienen actualmente en el local.

## Flujo enumerado propuesto

> Todos los pasos intermedios de esta sección son **propuestos para validación**. Los puntos 5 y 16 representan las dos decisiones que más pueden cambiar la estructura del BPMN.

1. El cliente llega al local y solicita atención.
2. El cliente expresa su necesidad de compra.
3. El personal identifica la necesidad comercial.
4. El personal presenta las alternativas disponibles.
5. ¿Se requiere una evaluación visual previa?
   1. **Sí:** el profesional clínico realiza la atención clínica como subproceso y el flujo retorna a la atención comercial.
   2. **No:** el flujo continúa directamente con la definición de la propuesta.
6. El personal define el producto y las condiciones comerciales.
7. El personal informa el precio y el plazo estimado.
8. El cliente evalúa la propuesta comercial.
9. El cliente comunica su decisión.
10. ¿El cliente acepta la propuesta?
    1. **No:** el personal cierra la atención sin venta y el cliente finaliza el proceso sin compra.
    2. **Sí:** el proceso continúa con la formalización de la venta.
11. El personal solicita los datos y el medio de pago necesarios.
12. El cliente proporciona los datos y realiza el pago.
13. El personal registra la venta y el pago por el medio actualmente utilizado.
14. El personal entrega el comprobante y las indicaciones correspondientes.
15. El cliente recibe el comprobante y las indicaciones.
16. ¿La entrega del producto es inmediata?
    1. **Sí:** el personal entrega el producto, el cliente lo recibe y la compra finaliza.
    2. **No:** el personal coordina la preparación y el retiro; el cliente queda a la espera y la compra termina esta instancia como pendiente de entrega.

## Correspondencia entre el texto y el dibujo

- El pool **Cliente** contiene únicamente acciones de la persona compradora.
- El pool **Óptica Stylo** contiene las lanes **Personal de atención y ventas** y **Profesional clínico**.
- Los sequence flows permanecen dentro de cada pool; los intercambios Cliente–Óptica Stylo se representan con message flows.
- Los gateways exclusivos modelan tres decisiones: evaluación visual previa, aceptación de la propuesta y entrega inmediata.
- La atención clínica se representa como subproceso colapsado para evitar detallar un proceso que tendrá su propio BPMN.
- Existen eventos de fin para rechazo de la compra, cierre sin venta, compra completada y compra pendiente de entrega.

## DATOS DEL PROCESO QUE REQUIEREN VALIDACIÓN CON ÓPTICA STYLO

1. ¿Quién recibe al cliente y cuál es el nombre real del rol: vendedor/a, asesor/a, encargado/a u otro?
2. ¿Qué tipos de venta presencial existen hoy: marco solo, marco con cristales, cristales para montura propia, accesorios u otros?
3. ¿Cómo se comprueba la disponibilidad del producto y qué ocurre cuando no hay existencia?
4. ¿En qué casos se exige o revisa una receta, qué vigencia se acepta y cómo se relaciona hoy con la compra?
5. ¿La evaluación visual forma parte del proceso de venta presencial? Si corresponde, ¿puede hacerse de inmediato, requiere hora o interrumpe la compra para otro día?
6. ¿Quién realiza la evaluación visual y cómo entrega el resultado al personal comercial?
7. ¿Cómo se configura actualmente el tipo de cristal, tratamientos, medidas, montura y observaciones de fabricación?
8. ¿Se entrega una cotización formal? ¿Cómo se calcula el precio, cuánto dura la oferta y qué ocurre cuando el cliente la rechaza o desea pensarlo?
9. ¿Qué datos se solicitan al comprador y cuáles al paciente cuando no son la misma persona? ¿Hay reglas distintas para menores de edad?
10. ¿Dónde y cómo se registra hoy la venta: papel, planilla, software, talonario u otro medio?
11. ¿Qué medios de pago se aceptan actualmente? ¿Existen abonos, pagos mixtos, crédito, convenios, descuentos o autorización de terceros?
12. ¿Interviene una entidad o terminal de pago que deba representarse como pool externo? ¿Qué ocurre si el pago es rechazado?
13. ¿Qué comprobante se entrega y quién lo emite: boleta, factura, recibo de abono, orden de trabajo u otro?
14. ¿Qué productos se entregan de inmediato y cuáles requieren preparación? ¿Quién prepara los lentes: personal interno o laboratorio/proveedor externo?
15. ¿Cómo se acuerda el plazo, cómo se avisa que el producto está listo y quién efectúa la entrega o retiro?
16. ¿Qué cancelaciones, devoluciones o abandonos pueden ocurrir después de aceptar la propuesta o pagar?

## Fuentes revisadas y criterio de uso

| Fuente | Hallazgo | Uso en este BPMN |
| --- | --- | --- |
| `README.md` | Alcance de la plataforma y decisiones comerciales pendientes. | Delimitar funcionalidades futuras y evitar presentarlas como AS-IS. |
| `docs/prisma-migration.md` | Arquitectura de persistencia del software. | Revisada y excluida del proceso de negocio. |
| `prisma/schema.prisma` y baseline | Entidades de clientes, pacientes, productos, recetas, ventas, pagos, agenda y clínica. | Vocabulario y preguntas; no evidencia operativa. |
| `src/app/page.js` | Texto de evaluación en sucursal y reseña sobre preparación de lentes. | Indicios contextuales, no confirmación del flujo. |
| Interfaces, servicios, validaciones y pruebas | Reglas implementadas para POS, recetas, pagos, agenda y clínica. | Identificación de preguntas y exclusión de funciones TO-BE. |
| Historial Git: `docs/ecommerce-decisions.md` | Declara decisiones provisionales hasta confirmar el proceso operativo real. | Evidencia de que el AS-IS no está levantado. |
| Historial Git: `docs/implementation-status.md` | Separa decisiones del sistema e información todavía pendiente de la clienta. | Corroborar brechas, no definir la operación actual. |
| Tesis anterior mencionada como referencia | No existe archivo, enlace ni referencia bibliográfica en el repositorio. | No fue posible revisarla; no se copió su flujo ni sus participantes. |

## Control de calidad

- [x] Está marcado explícitamente como **BORRADOR PENDIENTE DE VALIDACIÓN**.
- [x] No aparecen tecnologías, controladores, API, ORM ni bases de datos en el dibujo.
- [x] Las funcionalidades del software futuro no se presentan como prácticas actuales.
- [x] Los pools y lanes expresan participantes de negocio, con las hipótesis señaladas.
- [x] Los sequence flows permanecen dentro de sus pools.
- [x] Los message flows conectan pools distintos.
- [x] Los gateways expresan decisiones y sus salidas están etiquetadas.
- [x] Todos los caminos importantes alcanzan un evento de fin.
- [x] El flujo principal está dispuesto de izquierda a derecha en una página horizontal.
- [x] Las actividades usan verbo + objeto y pueden comprenderse sin conocer el código.
- [x] La descripción, el flujo enumerado, el archivo BPMN y el dibujo comparten la misma lógica.
- [ ] La operación representada coincide con la práctica real de Óptica Stylo. **Pendiente de entrevista y aprobación.**
