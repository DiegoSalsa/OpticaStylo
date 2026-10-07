# Pipeline reducido y consistencia geométrica

Trabajo en `provadorv2`, 2026-10-07. Referencia de escritorio aprobada: `ab3e5bef3d644cce553687a712f52b544e3cac6e`.

La implementación está preparada para otra prueba física. No se dispone de las métricas del teléfono que mostró el marco enorme; por tanto no se puede atribuir su causa exacta a una matriz, focal o magnitud concreta. Se corrigió una vulnerabilidad matemática reproducible, se redujo el coste del pipeline y se añadieron mediciones para distinguir esos mecanismos en el teléfono.

## Qué mostró la auditoría

Antes, tanto `createImageBitmap(video)` en worker como `detectForVideo(video)` en fallback recibían el video completo, sin límite de tracking. La preferencia móvil era ancho 1280 y 60 FPS, con dimensiones finales elegidas por el navegador. No existen registros de sus dimensiones efectivas en el teléfono. El SDK síncrono podía bloquear el hilo de interfaz; mantener la pose visible no eliminaba ese bloqueo ni la antigüedad de sus mediciones.

La escala dependía del eje X de la matriz facial: `faceWidth = unprojectedCheekWidth / max(0.35, projectionLength)`. Una matriz numéricamente válida pero incompatible con los landmarks podía multiplicar el ancho hasta 2.857 veces. El filtro temporal estabilizaba luego una pose ya demasiado grande.

La representación column-major y la reflexión `S R S` eran correctas. No encontramos un error universal por pasar de landscape a portrait: la misma cara sintética conserva escala relativa, quaternion y patillas en las siete dimensiones requeridas. Una imagen portrait real también produjo una matriz coherente en el SDK local. No se agregó una rotación de 90° por dispositivo ni un factor de escala móvil.

## Corrección de orientación y escala

Se calcula la base geométrica de ojos, frente y mentón, y se contrasta con la matriz. Ojos, mejillas y puntos laterales aportan tres direcciones rígidas independientes. Cuando al menos dos señales concuerdan dentro de 25°, una discrepancia matriz/geometría mayor de 35° o una amplificación relativa mayor de 1.5 identifica una matriz inconsistente. En ese caso se usa la base geométrica y la mediana de las proyecciones rígidas para compensar el ancho de mejillas. Estos límites detectan discrepancias grandes; no son correcciones de fitting ni filtros adicionales de movimiento.

Cuando la matriz es consistente se conservan exactamente el quaternion y la fórmula aprobados. No se modifica la estimación anatómica de 135 mm, la escala visual existente, ningún iris ni las dimensiones de los GLB. No se aplica un clamp silencioso a un marco gigante. El debug identifica `orientationSource = landmarks-consistency`, las proyecciones de ambas fuentes y sus yaw/pitch/roll.

Caso **controlado**, con cara canónica frontal en 720×1280 e inyección de una matriz de yaw 70°:

| Magnitud | Antes | Después |
| --- | ---: | ---: |
| Ancho de mejillas en imagen | 158.711 px | 158.711 px |
| Ancho de mejillas desproyectado | 180 px | 180 px |
| Proyección X de la matriz | 0.342020 | 0.342020, descartada por inconsistencia |
| Proyección usada en corrección | 0.35 | 1 |
| Factor de corrección | 2.857143 | 1 |
| Ancho facial corregido | 514.286 px | 180 px |
| Pixels/mm y scale | 3.809524 | 1.333333 |

Estos valores demuestran el mecanismo, **no son medidas del teléfono**. En la imagen portrait real de 820×1024, la matriz produjo proyección ≈0.9995, ancho raw ≈191.5 px, corregido ≈218.3 px y escala ≈1.617, con discrepancia geométrica ≈3.2°; se conservó la matriz.

El focal sigue siendo la estimación explícita `focalPx = videoWidth`, con FOV horizontal aproximado de 53.13°. La unprojection usa X y profundidad en unidades del ancho del video, Y en unidades de su altura, y un único mirroring. La prueba frontal con focal 0.7×–1.3× del ancho varió la escala menos de 3%; no explica por sí sola duplicarla. La estimación afecta profundidad, compensación lateral, proxy y patillas; no se presenta como calibración de una cámara física.

## Entrada de tracking separada del display

El video visual conserva su resolución y el `contain` móvil aprobado. Una superficie de dibujo reutilizable reduce únicamente la entrada de MediaPipe, conserva aspect, no recorta, no refleja y no rota. El fallback reutiliza esa superficie directamente. Worker crea un bitmap transferible por **inferencia aceptada**, que se cierra en `finally`; no se crean bitmaps por callback de render ni se acumulan solicitudes.

Los landmarks normalizados se convierten a pose usando las dimensiones originales del video. Cambiar resolución de tracking no cambia unidades físicas. Se registran las dimensiones efectivas del bitmap antes de transferirlo; si no coinciden con la entrada esperada se vuelve a obtener desde la superficie de dibujo. Una respuesta capturada antes de una rotación no se aplica a dimensiones nuevas. Cambiar el espacio del video reinicia el estado de coordenadas antes de aceptar la siguiente pose.

Perfiles:

| Ruta | Entrada inicial / límite | Objetivo de inferencia |
| --- | --- | --- |
| Escritorio rápido | Native, mismo frame original | Cadencia aprobada, sin gate nuevo |
| Viewport compacto + worker | Máximo 640 px | 30 Hz |
| Viewport compacto + fallback | Máximo 480 px | 20 Hz |
| Perfil 480 | Máximo 480 px | 20 Hz |
| Perfil 360 | Máximo 360 px | 15 Hz, limitado a 20 en fallback |

Los objetivos no son FPS garantizados. El tamaño real conserva aspect: 1280×720 se reduce a 640×360; 720×1280 a 360×640. La cámara móvil prefiere 30 FPS; escritorio conserva 1280×720, 16:9 y sus constraints de 60 FPS. Se mantiene `resizeMode: ideal none` cuando está soportado para preservar el encuadre nativo; la inferencia ya no depende de esa resolución visual.

La adaptación usa p95 de SDK y entrega, presión de frames descartados mientras el SDK está ocupado, y backend. Exige más de 25% de muestras sobre presupuesto, dos evaluaciones de ocho resultados y al menos 1.5 s entre reducciones. Los valores del último conjunto de hasta 16 muestras evitan responder a un outlier. Para recuperar resolución exige seis evaluaciones con margen y 10 s desde el cambio anterior. La recuperación contempla el pacing deliberado: 20 Hz sobre cámara de 30 Hz entrega aproximadamente cada 66 ms incluso con SDK de 12 ms.

No se usa user agent. El worker compacto conserva una sola inferencia en vuelo y omite el margen adicional de CPU 1.15; ese margen hacía que SDK de 62 ms necesitara tres frames de cámara, alrededor de 100 ms por entrega. En escritorio y fallback se mantiene el margen aprobado.

## Gráficos y liveness

En viewport compacto el DPR máximo es 1 y el Environment pasa de 128 a 64. Se conservan antialiasing, materiales, luces, shaders del marco y proxy. No se reduce la malla física ni se cambia el calce. La malla de oclusión se sube al GPU sólo cuando llega un nuevo buffer facial o cambia su geometría; modelo y oclusores siguen transformándose con la misma pose en cada render.

Liveness no agrega espera para aplicar mediciones. Permanece ligado a recepción válida y a tres intervalos reales, con 180 ms mínimos de escritorio y máximo de 800 ms para pérdida sostenida. Tras reducir coste, la gracia disminuye automáticamente con la cadencia observada; no se aumentaron timeouts. En simulaciones optimizadas queda entre 180 y ≈297 ms, según perfil/coste. El límite de 800 no certifica rendimiento aceptable: un coste fijo de 250 ms sigue marcado fuera de presupuesto al llegar al perfil mínimo.

El debug evalúa un presupuesto independiente:

- Bueno: render ≥50 FPS, inferencia ≥20 FPS y entrega p95 <100 ms.
- Aceptable: render ≥45 FPS, inferencia ≥12 FPS y entrega p95 <150 ms.
- Fuera de presupuesto: no cumple esas condiciones; pasar tests no cambia esa clasificación.

La tabla muestra camera/render/inference FPS, cámara y tracking px, backend, perfil, DPR, SDK/entrega p50/p95, preparación, edades, gracia, anchos raw/corregido, pixels/mm, scale, yaw/pitch/roll, proyección y pérdidas. Las ventanas estadísticas tienen 32 resultados. Camera FPS se estima por callbacks de frames observados y puede subcontar si el hilo está bloqueado; settings de cámara se mantienen en el JSON. Render e inferencia recientes permiten ver el estado actual en lugar de diluirlo en la media de toda la sesión.

## Mediciones reales locales

SDK real, imagen estática portrait 820×1024, cuatro warmups y **32 muestras por caso**, secuencia native →640→480→360. Todos los casos detectaron rostro en **32/32**. El orden, caches y hardware afectan estas medidas; no se hizo un benchmark de teléfono ni de movimiento humano.

La columna Total incluye preparación, ejecución y entrega del SDK; excluye conversión a pose y render. El `totalProcessingTimeMs` del probador normal sí incluye conversión y actualización del filtro, y tampoco pretende medir el tiempo hasta presentar el frame en pantalla.

| Backend | Tracking | SDK p50 / p95 ms | Total p95 ms | Scale |
| --- | --- | --- | ---: | ---: |
| worker | 820×1024, native | 23.9 / 29.3 | 43.3 | 1.617232 |
| worker | 513×640 | 21.4 / 26.2 | 26.9 | 1.618328 |
| worker | 384×480 | 16.2 / 21.6 | 22.4 | 1.616628 |
| worker | 288×360 | 15.2 / 19.3 | 20.5 | 1.622983 |
| main-thread | 820×1024, native | 32.5 / 45.4 | 45.4 | 1.617077 |
| main-thread | 513×640 | 16.7 / 19.1 | 19.1 | 1.618511 |
| main-thread | 384×480 | 13.2 / 15.7 | 15.8 | 1.616680 |
| main-thread | 288×360 | 15.4 / 19.6 | 19.7 | 1.623060 |

Reducir al mínimo no garantiza ser lo más rápido: en fallback 360 resultó más lento que 480. La variación de escala respecto a native quedó bajo 0.4% en ambos backends. La conversión principal del worker pasó de preparación p50 11.6 ms en native a ≈0.1 ms con frame reducido. [Datos completos](./vto-sdk-resolution-benchmark.json).

La integración con webcam **sin rostro** mostró desktop native 1280×720 y render ≈60 FPS. En viewport 390×844 el controlador eligió 480×270 durante carga de validación, sobre video 1280×720; bitmap 480×270, DPR 1 y render ≈59.7 FPS. Esto verifica entrada reducida y render independiente. No mide fitting humano y no ofrece FPS antes/después del teléfono. [Evidencia de runtime](./vto-runtime-resolution-evidence.json).

La herramienta `/virtual-try-on/3d/validation/performance` permite repetir el benchmark con imagen local y ambos backends. Sólo existe en desarrollo; en producción devuelve 404.

## Pruebas y límites

Se añadieron **90 tests**; total **743**, todos aprobados. Se cubren las siete resoluciones, portrait/landscape, mirroring, yaw ±30°, signos de pitch/roll, matriz incoherente y rotación espuria, fallback sin matriz, focal variable, superficie reutilizable, resolución/cadencia adaptativa, outliers, cooldown, recuperación con cámara real de 30 Hz, percentiles y presupuesto.

Las simulaciones de 20 s cubren costes base **25/50/80/120/180/250 ms**, ambos backends y carga dependiente de píxeles. No hay parpadeo ni cambio de escala; durante los últimos dos segundos la última pose se renueva en menos de 150 ms. La hipótesis de coste proporcional a píxeles es explícita. También se simula coste fijo 250 ms: bajar resolución no lo elimina, el fallback sigue bloqueándose y se señala presupuesto excedido. [Evidencia determinista](./vto-mobile-structure-evidence.json).

La regresión de escritorio compara la pose completa, face mesh y fitting de **30 orientaciones por modelo**, HD0896 y RB2140, contra el commit aprobado; los fingerprints coinciden a 1e-8. Se conservan además las trayectorias de PoseFilter para 15/20/30 ms. Importer, canonicalización, dimensiones, modelos GLB, colisión y materiales no cambiaron.

Validación final: `npm test` **743/743**, `npm run lint` aprobado y `npm run build` aprobado, con 67 páginas generadas. Un servidor de producción temporal confirmó probador **200** y herramienta de benchmark **404**; se cerró al terminar. El push se limita a `provadorv2`, sin merge.

Las mediciones del teléfono —incluidos projectionLength, anchos, pixels/mm y FPS antes/después— siguen pendientes. El siguiente retest debe contrastar esas magnitudes aproximadamente frontal y con yaw, verificar el perfil elegido y confirmar si cumple el presupuesto. No se declara móvil solucionado definitivamente.

## Referencias de la auditoría

[MediaPipe Web](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js) documenta el bloqueo síncrono y el uso de workers. [MatrixData](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/framework/formats/matrix_data.proto) define column-major. [Geometry pipeline](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/cc/vision/face_geometry/libs/geometry_pipeline.cc) muestra la conversión entre landmarks normalizados y cámara métrica, que depende del aspect. Las correcciones del repositorio se basan en sus propias pruebas y mediciones; no se deduce que un teléfono específico entregue una matriz incorrecta a partir de esas fuentes.
