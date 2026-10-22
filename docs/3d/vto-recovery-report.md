# Probador 3D: entrega para validación física móvil

Fecha: 22 de octubre de 2026, America/Santiago. Base `origin/main`:
`db686b4b10a94efc6282fe0a717c4f7394a07a8f`. Rama: `mejoras-probador`.
Se trabajó en un worktree independiente; el checkout original con cambios
locales se conservó. No se modifican base de datos, migraciones ni pruebas
académicas. No se hace merge ni promoción a producción.

## Auditoría y causas comprobadas

Flujo inspeccionado: negociación de cámara → video completo/RVFC → una
inferencia en vuelo → worker MediaPipe, con alternativa en hilo principal →
landmarks y matriz → validación geométrica → escala iris/facial → filtro →
modelo y oclusor → WebGL → indicador/captura. Se revisaron los dos directorios
del probador, geometría, constantes, configuraciones, GLB/sidecars, importador,
materiales, contrato, tests y los informes anteriores de escala y cámara móvil.
No se encontraron los videos originales entre los archivos entregados; sólo
se recibió su descripción. No se incorporan grabaciones ni rostros a Git.

1. **Caducidad antes o durante la entrega.** `PoseFilter` usa el timestamp de
   captura, pero oculta cualquier medición de más de 180 ms. Una inferencia de
   220 ms llega ya vencida. A 140 ms quedan sólo 40 ms de representación por
   muestra, aunque MediaPipe siga devolviendo un rostro. El estado anterior
   tampoco distingue captura antigua de silencio desde la última entrega.
2. **Destrucción repetida del estimador.** El overlay ejecutaba `reset()` ante
   cualquier pose nula, tanto por ausencia de rostro como por conversión
   rechazada. Así se perdían historia y confianza aunque hubiera iris fiable
   inmediatamente antes. Con iris=2 px/mm, prior facial=2,8 px/mm y una pose
   omitida cada tres inferencias, el estimador vuelve repetidamente a 2,44
   px/mm: **22% de exceso de ancho** respecto de la referencia sintética.
3. **Retención en píxeles de una distancia anterior.** El estimador original
   conserva px/mm normalizados por resolución durante una oclusión de iris.
   Acercarse durante esa retención no actualiza la distancia. La referencia
   retenida debe relacionarse con una medida facial actual.
4. **Transición de resolución incoherente.** Se limpiaba el indicador al
   cambiar `videoWidth/videoHeight`, pero el estado que deduplicaba sus
   transiciones podía seguir indicando verdadero. El renderer se recuperaba
   y el texto permanecía buscando. Se reprodujo y corrigió con Playwright.
5. **Carrera de captura.** Una inferencia puede haber entregado una pose
   nueva sin que WebGL la haya dibujado. Validar sólo `faceDetected` no prueba
   que el Canvas contenga esa pose. La captura ahora espera el render real.
6. **Fallo permanente de worker después de iniciar.** El fallback anterior
   sólo cubría la inicialización. Un error de bitmap, timeout o cierre en
   ejecución dejaba una sesión inutilizable. Se añade una degradación acotada
   al hilo principal, con limpieza de recursos y sin reprocesar otro frame con
   el timestamp fallido.

Estas causas están demostradas en código y estímulos reproducibles. Su peso
en el teléfono del usuario, la calidad del iris detrás de lentes reales y
la latencia del sensor siguen pendientes de medición física. No se atribuye
el problema restante a CSS ni a una focal óptica conocida.

## Correcciones y límites

- `tracking-session.js` envuelve el `PoseFilter` aprobado sin modificarlo.
  Conserva timestamps de captura y separación entre no adquirido, detectado,
  estable, pérdida transitoria, perdido y recuperación. La caducidad normal
  sigue en 180 ms. Si la cadencia medida lo exige, el presupuesto de captura
  usa latencia + dos intervalos, con límite absoluto **360 ms** (dos
  presupuestos originales). El silencio desde la última pose válida nunca
  supera **180 ms**. Un resultado recibido con más de 360 ms se descarta
  **antes** de tocar escala o geometría.
- No se renueva artificialmente la edad al entregar ni se prolonga la
  predicción: permanece en **25 ms**, con atenuación original hasta cero a los
  75 ms y los mismos límites de desplazamiento. A 220 ms de inferencia no se
  promete continuidad: es preferible ocultar una pose vencida. El diagnóstico
  permite distinguir esa limitación de una detección negativa.
- Se elimina el reset por pose nula. `session-scale.js` reutiliza confianza,
  outliers, mezcla y adquisición del estimador original. Durante retención
  transporta la razón escala física/prior facial mediante el prior facial
  actual. Conserva 500 ms y transición exponencial de 300 ms. No hay factor
  móvil, factor por SKU ni medida dependiente del viewport.
- La referencia se elimina al cerrar/reiniciar/cambiar cámara, cambiar la
  resolución, o permanecer perdido más de un segundo. La escala por sí sola
  no autoriza representar una pose vencida. Cambiar de montura conserva la
  referencia física de la persona y limpia la pose del modelo anterior.
- `render-tracking-state.js` sincroniza el indicador con el ciclo WebGL,
  publica únicamente referencias y ejecuta la captura después del dibujo.
  Guardar vuelve a comprobar vigencia y timestamp. Se cancelan capturas
  pendientes al cerrar sesión o cambiar modelo.
- `resilient-face-tracking.js` conserva la configuración MediaPipe 0,5 y el
  camino original GPU/CPU; añade recuperación de un fallo de worker durante
  ejecución. No crea colas ni un bucle de reinicialización.

## Comparación antes/después con estímulos idénticos

Reproducción: `node scripts/report-vto-recovery.mjs`.
Datos: [vto-recovery-evidence.json](vto-recovery-evidence.json).
Son simulaciones deterministas de tres segundos, muestreadas a 60 Hz, no
mediciones de un teléfono. El intervalo se calcula con el scheduler aprobado.

| Latencia de inferencia | Primera pose antes/después | Fotogramas visibles antes/después |
| --- | --- | --- |
| 20 ms | 33,3 / 33,3 ms | 98,90% / 98,90% |
| 90 ms | 100 / 100 ms | 60,77% / 93,37% |
| 140 ms | 150 / 150 ms | 19,89% / 87,85% |
| 220 ms | ninguna / 233,3 ms | 0% / 45,86% |

En el caso de escala descrito: **2,44 → 2,00 px/mm**, error relativo de ancho
**22% → 0%** frente al iris sintético. Esto no mide el diámetro de iris de
una persona. La recuperación unitaria tras una inferencia nula tarda 33 ms
con una cadencia de 33 ms; después de pérdida prolongada no arrastra velocidad.
La prueba exige pose nula al vencer el presupuesto y rechazo de resultados
duplicados, fuera de orden, futuros o demasiado antiguos.

## Protección de notebook y geometría

Los **17 fingerprints originales** pasan sin actualizar hashes ni expectativas.
Permanecen idénticos: geometría, escala base, PoseFilter, timeline, MediaPipe
core/worker/adapter original, proyección, renderer de modelos, contrato,
importación, patillas, ambos GLB y sus sidecars. La prueba del CSS desktop
también permanece y pasa. Las modificaciones de integración usan módulos
nuevos; no se cambian esos archivos protegidos.

Los tests nuevos comparan todas las poses filtradas originales y nuevas a
15/30/60 FPS durante tres segundos para ambas monturas, con movimiento,
yaw/pitch y distancia variable: **igualdad completa**. El estimador de sesión
devuelve exactamente las mismas mediciones válidas del estimador aprobado.
El tamaño físico sigue siendo **147,85990119 mm** para RB2140 y **137 mm**
para HD0896. Se mantienen origen del puente, quaternion, proyección, patillas,
normalización y materiales. Las recuperaciones/oclusiones son los casos que
cambian intencionalmente. No se afirma una nueva aprobación visual de notebook.

La focal sigue siendo `videoWidth`, una **estimación**, no un intrínseco leído
del teléfono. La correspondencia video/Canvas y la reproyección de la máscara
están probadas; el ancho físico absoluto conserva incertidumbre monocular y
la referencia poblacional de iris de 11,7 mm. Sin iris fiable sólo hay un prior
facial: no puede garantizarse la dimensión real individual sin calibración.

## Validaciones

| Comando | Resultado |
| --- | --- |
| `npm run prisma:validate` | schema válido; sin migraciones |
| `npm run lint` | 0 errores, 0 advertencias |
| `npm test` | 747 tests: 738 pasan, 9 omitidos por los requisitos de integración ya existentes, 0 fallos |
| `npm run build` | compilación de producción correcta, 69 páginas |
| `npm audit --omit=dev` | 0 vulnerabilidades; se usó `NODE_OPTIONS=--dns-result-order=ipv4first` tras timeout de red IPv6 |
| `node --test tests/virtual-try-on-3d/*.test.js tests/utils/virtual-try-on-3d-geometry.test.js` | 243 pasan, 0 fallos |
| `playwright test -c playwright.vto.config.mjs` con fixture local | 9 pasan, 0 fallos |

Las herramientas npm se instalaron fuera del repositorio para no contaminar
el descubrimiento de `node --test`. No se cambian dependencias ni lockfile.
La emulación se ejecutó en Edge headless sobre Windows; no sustituye Android
o iOS físicos. Datos agregados por escenario:
[vto-browser-evidence.json](vto-browser-evidence.json).

Playwright prueba 360/390/430/768 px y 844×390 horizontal; fuentes 720×1280,
1280×720, 1080×1920 y 640×480; ausencia y conversión de pose inválida por
separado; recuperación; caducidad a 600 ms; rotación/resolución dinámica;
cambio/reinicio de cámara; selección de ambas monturas; informe JSON;
fotografía y descarga. Las aserciones comprueban escala, estados, alineación
<0,1 px y fuente visible >99,8%, además del contenido alfa no vacío del Canvas
para ambos GLB con MediaPipe real.

La integración determinista sólo existe en la ruta de desarrollo. En
producción se devuelve 404 y se ignora el proveedor de cámara de pruebas.
El test real utiliza el fixture público de MediaPipe `portrait.jpg`, disponible
en `https://storage.googleapis.com/mediapipe-assets/portrait.jpg`, SHA-256
`a6f11efaa834706db23f275b6115058fa87fc7f14362681e6abe14e82749de3e`.
Se coloca sólo en `tmp/fixtures/portrait.jpg` y se establece
`VTO_PORTRAIT_PATH` a su ruta absoluta. No se versiona imagen ni landmarks.
Referencia del fixture: [tests oficiales de MediaPipe](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/python/test/vision/face_landmarker_test.py).

Permisos rechazados y negotiation/fallback se cubren con las pruebas originales
de adquisición. Parpadeo, oclusión, un ojo, outliers, acercamiento/alejamiento,
movimiento, giros y poses inválidas se cubren con fixtures y filtros. Reflejos
de lentes reales, iluminación real y precisión de detección sobre esos casos
quedan para la prueba física: un fixture de iris ausente no reproduce reflejos.

## Diagnóstico y prueba física

Abrir el Preview final con `/virtual-try-on/3d?vtoDebug=1` y confirmar el SHA
de entrega. Vercel puede exigir autenticación de la cuenta propietaria del
proyecto; no se elimina esa protección global ni se modifica producción.
La URL exacta, el SHA y READY se verifican después del último push y se entregan
en el chat para evitar una referencia circular al commit de este informe.

El diagnóstico muestra resolución efectiva y de presentación, facing
solicitado/reportado, FPS, backend, resultados con/sin rostro, conversiones
rechazadas, descartes, edad de captura/entrega, estado, escala/fuente/confianza,
alineación y zoom/crop disponibles. Lo no informado aparece como tal.
`Descargar informe técnico JSON` produce una lista permitida explícita de
métricas agregadas. No exporta imágenes, landmarks, geometría facial,
identificadores de cámara, errores arbitrarios, URLs, sesiones ni credenciales.
No hay telemetría externa; el diagnóstico no se monta en uso normal.

En el teléfono: probar sin lentes y con lentes, de frente y girando suavemente;
acercarse/alejarse, parpadear, salir/volver, rotar, cambiar cámara y ambos
modelos. Observar si aumenta `inferencesWithoutFace` o
`poseConversionRejections`, la edad/FPS, `visualLosses`, fuente/confianza de
escala y alineación. Si persiste un fallo, descargar y compartir el JSON con
una descripción del movimiento. La aceptación final del calce corresponde
al usuario en su teléfono; esta entrega no la sustituye.
