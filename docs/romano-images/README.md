# Fotografías del inventario Romano

## Resultado de la revisión del 22–23 de octubre de 2026

Se recorrió el archivo `Optica_Stylo_Inventario_Romano_Precios_Actualizados_2026-10-22.xlsx` completo. Su SHA-256 es `72406ed352ea5452d694b7cf3a026500730f6cdd897dbe3d6e481e32aa0c2580`.

| Indicador | Resultado |
| --- | ---: |
| Filas con marca y modelo investigables | 1.513 |
| Filas excluidas: lotes o sin modelo | 10 |
| Marcas conservadas tras las equivalencias confirmadas | 76 |
| Modelos investigados | 728 |
| Referencias normalizadas de modelo y color | 1.422 |
| Referencias sin color explícito | 21 |
| Modelos con pistas de búsqueda sin verificar | 156 |
| Fotografías candidatas con código de variante coincidente | 3 |
| Fotografías oficiales confirmadas con el fabricante | 0 |
| Fotografías con autorización comercial comprobada | 0 |
| Fotografías de Romano subidas a Cloudinary | 0 |
| Fotografías de Romano asociadas en BD | 0 |

Las búsquedas combinaron marca, modelo y los colores registrados. Se conservaron consultas, resultados candidatos y fecha por modelo. Un resultado indexado no prueba correspondencia, oficialidad ni permiso. Los códigos genéricos devuelven también resultados ajenos a óptica; no se utilizaron como fotografías.

[coverage.json](2026-10-22/coverage.json) contiene el estado y motivo de cada referencia, con trazabilidad a todas sus filas originales. [inventory.json](2026-10-22/inventory.json) conserva marcas, códigos, colores y precios confirmados originales. Los archivos `search-*.json` registran las 728 búsquedas de modelos. [candidates.json](2026-10-22/candidates.json) es el manifiesto pendiente; no autoriza ninguna carga.

Distribución de referencias: 1.117 sin fotografía exacta verificada en la búsqueda, 302 con coincidencia incierta o color incompleto y 3 con fotografía encontrada pendiente de autorización. Estas categorías no demuestran que el fabricante carezca de fotografías.

## Fuentes y correspondencias

- [Mercavisión](https://mercavision.cl/): publica las marcas Angelo Falconi, Foose, Gattizoni, George, Jorgio, Game, Ice Look, Lacrosse, Le Giro, Maxcome, Moodkids, Silmo y Vespa. Los enlaces de catálogos y publicidades conducen a SharePoint; el acceso consultado requiere autenticación o no respondió. No se eludió ese control.
- [Atlantis](https://impoatlantis.cl/lavanett/): la ficha Lavanett invita a solicitar catálogo. Su [tienda](https://impoatlantis.cl/tienda/) es exclusiva para clientes. La página pública no ofrece una licencia comercial para reutilizar fotografías.
- [Formosa Importadora](https://taplink.cc/formosachile): ofrece acceso comercial por categorías de Marchioni, Difroli, Vozzen, Formosa y Clip On. No se obtuvo una fotografía con modelo, color y permiso verificables.
- [On Deck](https://www.ondeck.cl/collections/all): catálogo público y datos públicos de productos; no se confirmó una correspondencia exacta entre los códigos OD del Excel y las denominaciones publicadas.
- [Tecnobrasil / colección Frida Kahlo](https://tecnobrasil.com.br/fridakahlo/): tres recursos de 2.414 × 1.585 píxeles coinciden con `FK1010A R`, `FK1012A F` y `FK1012A PR`. Se verificaron códigos publicados, formato, dimensiones y hash sin guardar archivos de producto en el repositorio. La galería publica una vista por referencia encontrada. Falta confirmar oficialidad con el titular, uso comercial y revisión visual final; no se cargaron a Cloudinary.
- [Rodenstock, declaración del fabricante](https://www.rodenstock-pro.com/dam/jcr%3A689e9029-77e7-4baa-b599-7c3ccaddf3fc/rod_ce_doc_spectacle_frames.pdf): sirve para contrastar referencias técnicas; no constituye una fotografía ni una autorización de imágenes.

No se convirtieron `O` en `0`, colores desconocidos en negro, ni referencias parecidas en equivalentes. Lavanette/Lavanett y otros alias sin confirmar permanecen separados. Las equivalencias expresamente confirmadas por la óptica sí se aplicaron. Las búsquedas individuales de las demás marcas quedan en los archivos de registro.

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
8. Generar cobertura con `npm run images:report -- --inventory INVENTARIO.json --candidates MANIFIESTO.json --research DIRECTORIO --journal DIARIO.jsonl --output REPORTE.json`.

La aplicación consulta permisos del usuario activo y reutiliza `addProductImage`, validaciones de bytes, repositorio, transacciones e historial existentes. Solo se descarga desde hosts HTTPS aprobados, con DNS público fijado en la conexión, sin redirecciones ni credenciales. Se admiten JPEG, PNG y WebP para importación, hasta 4 MiB, con dimensiones seguras y un mínimo de 600 × 200 píxeles. No se cambia el color ni la geometría del producto.

El lote admite hasta 100 candidatas y entre 1 y 4 trabajadores; el valor inicial es 25/2. Los reintentos son acotados, respetan `Retry-After` hasta 30 segundos y distinguen 404 de fallos técnicos. No hay borrado de galerías anteriores.

Agrupar consecutivamente las vistas de cada producto e indicar `galleryOrder` desde cero en las candidatas autorizadas, empezando por la principal. El importador serializa las vistas del mismo producto y no divide una galería entre lotes; `nextOffset` marca el siguiente inicio válido. Si falla una vista, las posteriores autorizadas de ese producto no continúan en ese lote. Las imágenes se añaden después de las existentes, conservando su orden anterior.

## Interrupciones y recursos huérfanos

El diario JSONL se escribe y sincroniza antes de contactar Cloudinary. Registra también asociaciones, duplicados y errores; no contiene secretos. Tras una caída, revisar el bloqueo `.lock` y comprobar que no exista un importador activo antes de retirarlo manualmente. Volver a ejecutar el mismo lote permite recuperar el recurso por su identificador determinista.

Una asociación cuya confirmación se perdió conserva el archivo para evitar borrar una transacción que sí se confirmó. `npm run images:reconcile -- --journal DIARIO.jsonl --actor UUID` inspecciona el diario sin borrar. Para limpiar, agregar `--apply-cleanup --expected-cloud NUBE --expected-database-host HOST`. Solo se consideran identificadores `opticastylo/productos/romano-*` sin asociación en BD y con más de 24 horas desde el último evento. El comando toma el mismo bloqueo del diario y exige permisos; protege imágenes vinculadas, incluidas las retiradas.

## Tienda, administrador y archivos anteriores

La cuadrícula, los destacados y el detalle utilizan URLs persistidas de Cloudinary, `c_limit`, `f_auto`, `q_auto`, tamaños responsivos y `contain`. Se conservan márgenes, proporciones y colores. El detalle incluye miniaturas de 82 píxeles y ampliación con diálogo que se cierra con Escape. Un fallo de carga muestra el fallback Stylo.

El administrador distingue fotografía verificada, pendiente y procedencia por revisar; muestra la fuente de las imágenes importadas. Las imágenes anteriores sin evidencia no se reclasifican como autorizadas.

Se retiraron las tres URLs locales de respaldo de HD0896-001. Los archivos históricos de `public/images/products/hd0896-001` se conservan: no hubo coincidencia por hash con una imagen persistida en Cloudinary y falta comprobar sus derechos. No se borraron ni se subieron sin evidencia. Ya no participan en el catálogo. `.gitignore` bloquea nuevas fotografías en ese directorio; ningún commit de esta intervención añade binarios de producto. Los modelos GLB permanecen intactos.

## Validación

Se ejecutaron `npm run lint`, `npm test` y `npm run build`. Las comprobaciones adicionales cubren descarga insegura, 404, autorización desconocida, color distinto, producto sustituido, hash alterado, resolución insuficiente, límites y reintentos, persistencia y cargas concurrentes. El test de BD requiere `PRODUCT_IMAGES_DATABASE_TEST=true` y rechaza cualquier base fuera del PostgreSQL local dedicado. Las pruebas académicas y sus expectativas no se modificaron; se restauraron únicamente los bytes LF del checkout que Git había convertido a CRLF para que sus fingerprints coincidan con HEAD.

Las capturas antes/después y la prueba de galería se realizaron sobre el catálogo comercial ya existente, no representan incorporación de fotografías Romano. Se comprobaron escritorio de 1.440 píxeles y móvil de 390 píxeles: cuatro miniaturas, cambio de vista, zoom, cierre con Escape, imágenes cargadas, ausencia de desbordamiento horizontal y de errores JavaScript. Las capturas se entregan fuera de Git.

La rama de entrega es [mejoras-imagenes-romano](https://github.com/DiegoSalsa/OpticaStylo/tree/mejoras-imagenes-romano), basada en `bd16505`. No se modificó ni fusionó `main`. El Preview del commit final se comprueba después de publicar la rama y se informa en la entrega.

Para incorporar fotografías comerciales reales sigue faltando evidencia de autorización y correspondencias de productos aprobadas para producción. Ninguna búsqueda, archivo técnico o preparación local se declara como una fotografía de Romano publicada.
