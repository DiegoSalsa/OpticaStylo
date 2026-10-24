# Fotografías del inventario Romano

## Revisión ampliada del 23 de octubre de 2026

La primera entrega registró tres fotografías de un solo catálogo y dejó sin examinar suficientes fuentes. Las 728 consultas indexadas no equivalían a 728 modelos revisados en fichas y galerías. Esta revisión amplía la evidencia y corrige ese alcance.

El Excel completo contiene 1.513 filas investigables, 728 modelos y 1.422 referencias normalizadas; 21 no tienen color explícito. Su SHA-256 es `72406ed352ea5452d694b7cf3a026500730f6cdd897dbe3d6e481e32aa0c2580`. Se conservan precios confirmados y trazabilidad a las filas; no se deduce stock disponible.

| Resultado comprobado | Cantidad |
| --- | ---: |
| Archivos fotográficos candidatos con códigos de modelo y color publicados coincidentes | 81 |
| Modelos representados por esos archivos | 30 |
| Variantes representadas por esos archivos | 49 |
| Fotos adicionales del modelo con color o correspondencia de vista pendientes | 138 |
| Catálogos PDF públicos examinados mediante OCR | 19 |
| Páginas de esos catálogos | 432 |
| Páginas PDF con modelos del Excel | 51 |
| Variantes con código de modelo y color localizado en PDF | 88 |
| Referencias con archivo candidato o código coincidente en PDF | 137 |
| Fotos confirmadas con el fabricante | 0 |
| Fotos con permiso comercial comprobado | 0 |
| Fotos de Romano subidas a Cloudinary en esta revisión | 0 |
| Fotos de Romano vinculadas en BD en esta revisión | 0 |

Las fotos siguen pendientes de revisión visual y de derechos. Coincidir en el código publicado no prueba por sí solo que el comerciante haya fotografiado la variante correcta. Los PDF son hallazgos documentales separados: una página con varias monturas no se cuenta como una foto individual lista para importar. Se revisaron visualmente las páginas de Marchioni MT002, MT004 y MT006; las demás revisiones visuales pendientes se identifican como tales.

| Marca | Modelos con archivos candidatos | Variantes | Archivos |
| --- | ---: | ---: | ---: |
| FRIDA KAHLO | 5 | 6 | 11 |
| GUESS | 4 | 5 | 10 |
| JORGIO | 8 | 10 | 19 |
| LAVANETT | 9 | 23 | 29 |
| MARCIANO | 3 | 4 | 8 |
| PRUNE | 1 | 1 | 4 |

Los 81 archivos tienen hashes distintos. Ocho archivos Lavanett quedan además pendientes de mayor resolución: sus anchos publicados son de 530 a 592 píxeles, por debajo del mínimo de importación de 600. Las demás candidatas tienen metadatos suficientes para la comprobación técnica inicial; falta evaluar su contenido visual. No se ampliaron artificialmente las imágenes pequeñas.

## Fuentes y correspondencias

- [Luxvision](https://www.luxvision.cl/productos/lavanett-modelo-lt1000-c2-23ym0/): galerías de Lavanett. Incluye LT1000 C2/C3 con cuatro recursos por variante, además de LT1001, LT1002, LT1003, LT1004, LT1005, LT1008, LT1009 y LT1010 en los colores detallados en el manifiesto.
- [Óptica Ónix](https://opticaonix.uy/products/frida-kahlo-fk1017a-r): dos vistas publicadas para FK1017A R, FK1019A BLU, FK1022A PU y FK1010A R. Los colores alternativos BL, W, PO o F que no coinciden con la referencia buscada no se trasladan a ella.
- [Tecnobrasil](https://tecnobrasil.com.br/fridakahlo/): tres recursos de 2.414 × 1.585 píxeles para FK1010A R, FK1012A F y FK1012A PR.
- [Select Eyewear](https://selecteyewear.com/products/guess-gu50194): recursos por variante Guess y Marciano, con códigos en el nombre del archivo y opciones de color. Se conserva el código original de tres dígitos (por ejemplo, 083) y se documenta su contraste con el número 83 del Excel; no se aplica esa regla a letras ni a otras marcas.
- [Ópticas Osman](https://opticasosman.cl/products/lente-optico-jorgio-occhiali-dljo048): Jorgio, incluyendo variantes enlazadas por `featured_image`. Las vistas que no tienen vínculo claro con un color permanecen en el archivo de coincidencias inciertas.
- [Óptica Lumilens](https://opticalumilens.com.ar/productos/prune-rosalba-09/): galería de Prune Rosalba 09, contrastada con el color numérico 9 del Excel.
- [Formosa Importadora](https://taplink.cc/formosachile): 19 catálogos PDF públicos de Marchioni, Difroli, Vozzen, Formosa y otras líneas. Las páginas candidatas conservan título, enlace original, página, hash del documento, códigos, confianza y coordenadas del OCR. Los PDF originales y sus renders se mantienen fuera del repositorio.
- [Mercavisión](https://mercavision.cl/): los enlaces a su material comercial conducen a SharePoint; no se obtuvo acceso utilizable a esas carpetas. [Atlantis](https://impoatlantis.cl/lavanett/) remite al acceso comercial. No se eludieron controles.
- [On Deck](https://www.ondeck.cl/collections/all): el catálogo público incluye productos con nombres comerciales y una ficha de Óptica Stylo como aliado, pero eso no demuestra autorización de fotografías ni equivalencia entre los códigos OD antiguos y los modelos publicados.

Se leyeron 512 URLs web, de las cuales 492 respondieron correctamente, además de los PDF. Las páginas de Opticali incluían muchas fichas sin foto; se excluyeron los placeholders y el logotipo del sitio. Los resultados ajenos a óptica y las páginas con otro color no se suman como fotos exactas. Las fuentes no accesibles siguen pendientes.

## Archivos de revisión

- [candidates.json](2026-10-22/candidates.json): archivos candidatos con clave exacta del Excel, fuente, URL, hash, dimensiones, formato, evidencia de código y permiso desconocido. Vistas de una referencia agrupadas para permitir la simulación del importador.
- [uncertain-candidates.json](2026-10-22/uncertain-candidates.json): fotos del modelo cuyo color o correspondencia de vista no se confirmó. No son un manifiesto de importación.
- [pdf-candidates.json](2026-10-22/pdf-candidates.json): páginas con fotografías y códigos localizados por OCR, separadas de los archivos fotográficos individuales.
- [catalogue-rejections.json](2026-10-22/catalogue-rejections.json): fuentes descartadas por otra variante y errores técnicos.
- [sources-review.json](2026-10-22/sources-review.json): auditoría de lecturas y método.
- [coverage.json](2026-10-22/coverage.json): estado y motivo por cada una de las 1.422 referencias.
- [inventory.json](2026-10-22/inventory.json) y `search-*.json`: archivo maestro normalizado y registro de consultas iniciales.

No se convirtieron `O` en `0`, no se confirmó Lavanette/Lavanett como un alias nuevo y no se asignaron colores por semejanza. Todas las candidatas siguen sin autorización comercial acreditada y sin correspondencia aprobada con productos de producción.

## Entornos y datos

El usuario autorizó expresamente utilizar producción durante la conversación. Se identificaron Cloudinary `dr8dp4xqk`, carpeta comercial `opticastylo/productos`, y la base Neon configurada en `DATABASE_URL`. Se aplicó únicamente la migración aditiva `20261022000000_product_image_provenance`: añade procedencia e identificador idempotente a `product_images`. No modifica productos, precios, stock ni imágenes existentes.

La inspección inicial de producción encontró 18 productos, 13 monturas y 49 imágenes registradas; ninguna montura corresponde a los modelos Romano. No se asociaron candidatas a productos parecidos ni se incorporaron productos Romano a producción.

En PostgreSQL local `127.0.0.1:55462/stylo_images_romano` se prepararon 1.374 referencias inactivas con precio confirmado. Las 48 restantes quedaron pendientes por color o precio; no se inventaron valores. Una segunda ejecución conservó los mismos productos. Ninguna fila de Excel se convirtió en una cantidad disponible. Los datos de sucursal se mantienen identificados como `GALERIA_ROMANO`.

La prueba real de Cloudinary utilizó un fondo neutro propio, sin representar una montura, en `opticastylo/pruebas/romano-20261023`. Se comprobaron subida, lectura, persistencia local e idempotencia; después se eliminó el archivo de Cloudinary. [technical-cloudinary-validation.json](2026-10-22/technical-cloudinary-validation.json) registra el resultado. Ese archivo técnico no se cuenta como fotografía comercial incorporada.

## Procedimiento reutilizable

1. `npm run images:inventory -- --excel RUTA.xlsx --output tmp/romano-images/inventory.json`
2. Investigar las referencias y preparar un manifiesto JSON como el publicado, con fuentes y candidatos. Los estados pendientes se mantienen fuera de Cloudinary.
3. Verificar con una persona responsable marca, modelo, color, vistas y autorización comercial. Registrar titular, alcance, URL de evidencia, persona y fecha de revisión. Fijar SHA-256 del recurso revisado. Para una foto compartida entre colores, registrar evidencia expresa del fabricante.
4. Identificar el producto mediante una correspondencia revisada: UUID, SKU, nombre esperado y clave del inventario. Si falta, preparar primero el entorno local con `images:stage`. El importador no crea productos.
5. Simular: `npm run images:import -- --inventory INVENTARIO.json --manifest MANIFIESTO.json --actor UUID --dry-run --batch-size 25 --offset 0`
6. Aplicar una vez comprobadas fuentes, correspondencias y destino: agregar `--apply --expected-cloud NUBE --expected-database-host HOST`. Producción también requiere `--allow-production`. No combinar `--apply` y `--dry-run`.
7. Continuar con el `nextOffset` informado. Repetir un lote es seguro: el servicio consulta hash por producto, Cloudinary usa un identificador determinista y la BD protege `import_key`. Los recursos retirados no se reactivan automáticamente.
8. Generar cobertura con `npm run images:report -- --inventory INVENTARIO.json --candidates MANIFIESTO.json --uncertain-candidates INCIERTAS.json --pdf-candidates PDF.json --research DIRECTORIO --journal DIARIO.jsonl --output REPORTE.json`. Los dos archivos adicionales son opcionales; separan fotografías, variantes inciertas y páginas PDF.

La aplicación consulta permisos del usuario activo y reutiliza `addProductImage`, validaciones de bytes, repositorio, transacciones e historial existentes. Solo se descarga desde hosts HTTPS aprobados, con DNS público fijado en la conexión, sin redirecciones ni credenciales. Se admiten JPEG, PNG y WebP para importación, hasta 4 MiB, con dimensiones seguras y un mínimo de 600 × 200 píxeles. No se cambia el color ni la geometría del producto.

El lote admite hasta 100 candidatas y entre 1 y 4 trabajadores; el valor inicial es 25/2. Los reintentos son acotados, respetan `Retry-After` hasta 30 segundos y distinguen 404 de fallos técnicos. No hay borrado de galerías anteriores.

Agrupar consecutivamente las vistas de cada producto e indicar `galleryOrder` desde cero en las candidatas autorizadas, empezando por la principal. El importador serializa las vistas del mismo producto y no divide una galería entre lotes; `nextOffset` marca el siguiente inicio válido. Si falla una vista, las posteriores autorizadas de ese producto no continúan en ese lote. Las imágenes se añaden después de las existentes, conservando su orden anterior.

## Interrupciones y recursos huérfanos

El diario JSONL se escribe y sincroniza antes de contactar Cloudinary. Registra también asociaciones, duplicados y errores; no contiene secretos. Tras una caída, revisar el bloqueo `.lock` y comprobar que no exista un importador activo antes de retirarlo manualmente. Volver a ejecutar el mismo lote permite recuperar el recurso por su identificador determinista.

Una asociación cuya confirmación se perdió conserva el archivo para evitar borrar una transacción que sí se confirmó. `npm run images:reconcile -- --journal DIARIO.jsonl --actor UUID` inspecciona el diario sin borrar. Para limpiar, agregar `--apply-cleanup --expected-cloud NUBE --expected-database-host HOST`. Solo se consideran identificadores `opticastylo/productos/romano-*` sin asociación en BD y con más de 24 horas desde el último evento. El comando toma el mismo bloqueo del diario y exige permisos; protege imágenes vinculadas, incluidas las retiradas.

## Tienda, administrador y archivos anteriores

La referencia visual aportada por la óptica el 23 de octubre de 2026 fija un fondo verde menta suave, de `#f7fbfa` a `#e5f5f1`. Catálogo, destacados, detalle, miniaturas, productos relacionados y ampliación comparten `--product-photo-background`. Las imágenes transparentes permiten ver ese fondo; los archivos con fondo blanco opaco necesitan preparación y revisión antes de incorporarse. La normalización debe actuar sobre el fondo y conservar montura, lentes, sombras legítimas y color del producto. No aplicar una capa verde ni una mezcla de color sobre toda la fotografía para simular ese acabado.

La cuadrícula, los destacados y el detalle utilizan URLs persistidas de Cloudinary, `c_limit`, `f_auto`, `q_auto`, tamaños responsivos y `contain`. Se conservan márgenes, proporciones y colores. El detalle incluye miniaturas de 82 píxeles y ampliación con diálogo que se cierra con Escape. Un fallo de carga muestra el fallback Stylo.

El administrador distingue fotografía verificada, pendiente y procedencia por revisar; muestra la fuente de las imágenes importadas. Las imágenes anteriores sin evidencia no se reclasifican como autorizadas.

Se retiraron las tres URLs locales de respaldo de HD0896-001. Los archivos históricos de `public/images/products/hd0896-001` se conservan: no hubo coincidencia por hash con una imagen persistida en Cloudinary y falta comprobar sus derechos. No se borraron ni se subieron sin evidencia. Ya no participan en el catálogo. `.gitignore` bloquea nuevas fotografías en ese directorio; ningún commit de esta intervención añade binarios de producto. Los modelos GLB permanecen intactos.

## Validación

Se ejecutaron `npm run lint`, `npm test` y `npm run build`. Las comprobaciones adicionales cubren descarga insegura, 404, autorización desconocida, color distinto, producto sustituido, hash alterado, resolución insuficiente, límites y reintentos, persistencia y cargas concurrentes. El test de BD requiere `PRODUCT_IMAGES_DATABASE_TEST=true` y rechaza cualquier base fuera del PostgreSQL local dedicado. Las pruebas académicas y sus expectativas no se modificaron; se restauraron únicamente los bytes LF del checkout que Git había convertido a CRLF para que sus fingerprints coincidan con HEAD.

Las capturas antes/después y la prueba de galería se realizaron sobre el catálogo comercial ya existente, no representan incorporación de fotografías Romano. Se comprobaron escritorio de 1.440 píxeles y móvil de 390 píxeles: cuatro miniaturas, cambio de vista, zoom, cierre con Escape, imágenes cargadas, ausencia de desbordamiento horizontal y de errores JavaScript. Las capturas se entregan fuera de Git.

La rama de entrega es [mejoras-imagenes-romano](https://github.com/DiegoSalsa/OpticaStylo/tree/mejoras-imagenes-romano), basada en `bd16505`. No se modificó ni fusionó `main`. El Preview del commit final se comprueba después de publicar la rama y se informa en la entrega.

La publicación productiva siguiente conserva el estado de derechos pendiente; las fotografías no se presentan como autorizadas por el fabricante hasta documentar ese permiso.

## Publicación productiva autorizada

El 23 de octubre de 2026 el solicitante autorizó publicar las referencias que tuvieran precio confirmado e imagen coincidente. Se activaron **35 productos** en Neon productivo, con **62 imágenes** subidas a Cloudinary `dr8dp4xqk` bajo `opticastylo/productos`. Cada URL segura de Cloudinary quedó persistida en `product_images`, con SKU `ROM-*`, precio tomado del Excel y sin crear cantidades de stock.

Las 62 asociaciones conservan `USER_PUBLISHED_PENDING_RIGHTS`: la publicación fue solicitada por Óptica Stylo, pero el permiso del titular de cada fotografía aún no está documentado. Por eso el administrador las clasifica como revisión y no como `VERIFIED`. [published-production.json](2026-10-22/published-production.json) contiene los IDs, public IDs, URLs seguras, hashes y productos afectados. Las 35 fichas quedaron activas; los 21 modelos sin precio confirmado y las candidatas con resolución insuficiente no se publicaron.

