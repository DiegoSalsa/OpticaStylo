# VTO V2: propuesta de corrección de escala física

**Pendiente de comparación humana en PC. Ninguna rama está aprobada. Sin merge.**

Rama `provadorv2-scale-fix`, creada exactamente desde
`7290abcfdd898b06a77416a5499e958370fb088c`, sin experimentos del rebuild móvil.
`main` conserva `f06fa1317c4c1e3aa438f64dc0cdc30c5c4bd57d`.
El checkout original con cambios sin commit se conservó; el trabajo vive en
un worktree independiente.

## Primer experimento, antes de cambiar la escala

Se añadió primero el comparador por cada medición facial válida, conservando
el render V2 original. Ese estado quedó en el commit `fcfa294`.
Se ejecutaron 43 comparaciones contra copias completas del código histórico
V1 y V2, con iguales landmarks, resolución y dimensiones del modelo.

Después se procesó localmente, con MediaPipe IMAGE, la región de cámara de
las dos capturas adjuntas. Se guardaron sólo métricas agregadas, sin imágenes
personales ni landmarks faciales en Git. La medición previa está en
[vto-scale-comparator-before.json](vto-scale-comparator-before.json).

Las regiones se analizaron a **814 × 458 px**, factor manual 1, offset 0.
Son nuevas detecciones sobre capturas que ya contienen gafas virtuales y
reflejos. No son los landmarks originales de la webcam ni una aprobación
visual. Sus ratios sirven para explicar la regresión; la prueba en vivo sigue
pendiente. El ajuste 97% visible en la segunda captura no se reutilizó.

## Qué cambió entre f06fa… y 7290abc…

V1 medía la distancia 2D entre `234 ↔ 454`, corregía yaw con
`max(0.68, cos(yaw))`, dividía por 135 mm y combinaba con dos diámetros de iris:
`470 ↔ 472` y `475 ↔ 477`. El iris se acotaba a 72–138% del prior facial y la
fusión final era `face × 0.55 + boundedIris × 0.45`.

V2 desproyectó primero las mejillas a la profundidad del puente, dividió ese
ancho por `projectionLength = max(0.35, hypot(headX.x, headX.y))` y pasó a
`correctedFaceWidth / 135`, eliminando la medición de iris y su fusión.
Los 135 mm dejaron de ser un prior y pasaron a imponer el tamaño absoluto.

| Métrica previa | Captura 21:21:34 | Captura 21:21:21 |
|---|---:|---:|
| projectedFaceWidthPx | 184.964 | 184.149 |
| unprojectedFaceWidthPx | 210.669 | 209.177 |
| projectionLength | 0.999964 | 0.999990 |
| correctedFaceWidthPx | 210.676 | 209.179 |
| V2 / V1 | **1.195057** | **1.165557** |
| Aumento de ancho respecto de V1 | **19.51%** | **16.56%** |

La desproyección aumenta esas distancias aproximadamente **13.90% y 13.59%**.
Aquí `projectionLength` apenas añade **0.0036% y 0.0010%**, porque las caras
están casi de frente. El resto procede de quitar el iris de la fusión.
Los efectos se multiplican; no se suman. En yaw el corrector de orientación
puede contribuir más, y también queda registrado.

## Comparación con la propuesta

Anchos estimados = `frameWidthMm × pixelsPerMm`, a profundidad del puente,
antes de rotación, perspectiva final y `cover` de CSS. No son un bounding box
renderizado ni píxeles del viewport. Se conservan **147.85990119 mm para
RB2140** y **137 mm para HD0896**, sin cambiar GLB, sidecars o contrato.

Primera captura:

| Métrica | V1 | V2 actual | V2 con scale fix, propuesto |
|---|---:|---:|---:|
| Face scale px/mm | 1.370167 | 1.560567 | 1.560567 (fallback) |
| Iris scale px/mm | 1.227243 | — | 1.276596 |
| Final scale px/mm | 1.305851 | 1.560567 | **1.276596** |
| RB2140 ancho px | 193.083 | 230.745 | **188.757** |
| HD0896 ancho px | 178.902 | 213.798 | **174.894** |

`V2 actual / V1 = 1.195057`; `V2 propuesto / V1 = 0.977597` (**−2.24%**).
`estimatedFaceWidthMm = 210.676495 / 1.276596 = 165.030 mm`.

Segunda captura:

| Métrica | V1 | V2 actual | V2 con scale fix, propuesto |
|---|---:|---:|---:|
| Face scale px/mm | 1.364074 | 1.549473 | 1.549473 (fallback) |
| Iris scale px/mm | 1.286985 | — | 1.339609 |
| Final scale px/mm | 1.329384 | 1.549473 | **1.339609** |
| RB2140 ancho px | 196.563 | 229.105 | **198.074** |
| HD0896 ancho px | 182.126 | 212.278 | **183.526** |

`V2 actual / V1 = 1.165557`; `V2 propuesto / V1 = 1.007691` (**+0.77%**).
`estimatedFaceWidthMm = 209.178812 / 1.339609 = 156.149 mm`.

Estos anchos faciales son estimaciones monoculares con la focal V2 y una
referencia poblacional de iris; no son medidas anatómicas calibradas. Explican
cuantitativamente por qué representar esa distancia como 135 mm sobredimensiona
los modelos. La propuesta cambia respecto a V1 por usar cuatro diámetros y
permitir que una referencia física consistente tenga peso completo.

## Estimador y separación de canales

Los índices se confirmaron en las
[conexiones oficiales de MediaPipe](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/python/solutions/face_mesh_connections.py):
el iris derecho anatómico tiene el anillo `469–472`; el izquierdo, `474–477`.
Los pares opuestos son `469 ↔ 471`, `470 ↔ 472`, `474 ↔ 476`, `475 ↔ 477`.
Los centros `468/473`, sus coordenadas absolutas y todos los z de iris quedan
excluidos de la estimación.

1. Mediana de diámetros, rechazo de valores que difieran más de 25% del centro.
2. Verificación por ojo y entre ojos; desacuerdo mayor de 18% se rechaza.
3. Apertura de párpados relativa al diámetro para invalidar parpadeos aunque
   MediaPipe siga produciendo un anillo plausible. Alta confianza exige cuatro
   diámetros, razón entre ejes ≥0.85, apertura ≥0.5 y diferencia entre ojos ≤10%.
4. `AVERAGE_IRIS_DIAMETER_MM = 11.7` permanece documentado. No hay factores por
   modelo ni clamp contra el prior facial para un iris válido.
5. Confianza media: `face × 0.55 + iris × 0.45`. Alta confianza: iris tiene peso
   1. En video, ese peso crece durante 240 ms de consistencia temporal y al menos
   tres muestras; se verifica el ratio iris/face para conservar respuesta ante
   cambios de distancia. Después, variaciones ordinarias del prior facial no
   vuelven a dominar el iris. En fotos se evalúa la consistencia geométrica.
6. Última escala válida retenida hasta 500 ms ante iris inválido/degradado;
   después, transición exponencial con constante 300 ms hacia face/blend.
   Se conserva el filtro de escala de `PoseFilter`. Una discrepancia temporal
   >20% se retiene hasta tres mediciones consistentes; no se bloquean cambios
   persistentes. Estado normalizado por videoWidth para cambios de resolución.

Los umbrales de confianza son criterios geométricos de ingeniería, pendientes
de validación humana; no son probabilidades calibradas.

Iris sólo modifica `pixelsPerMm`. Posición, quaternion, orientación y apoyo
nasal proceden del código V2 existente. Incluso el offset vertical de debug
conserva su referencia facial para que iris no afecte Y. La malla facial se
normaliza con la nueva escala, por lo que al recomponerla mantiene la misma
superficie en mundo; los algoritmos de patillas y colisión reciben esas medidas
sin cambios en su implementación.

Worker, scheduling, `PoseFilter`, prediction, temples, head collision, importer,
model contract, shaders, CSS y modelos permanecen sin cambios respecto a la base.

## Cómo hacer la prueba humana en PC

Abrir `/virtual-try-on/3d?vtoDebug=1` en esta rama. El selector de debug permite
**V2 con escala física**, **Escala histórica V1 (55/45)** y **Escala V2 original**.
Renderiza un único modelo; compara los estimadores simultáneamente por frame.
La opción histórica mantiene tracking, bridge y quaternion V2 y recupera sólo
la escala exacta V1. Permite probar primero la fusión que tenía evidencia humana.

También se puede iniciar con `?vtoDebug=1&vtoScale=historical` o
`?vtoDebug=1&vtoScale=v2`. Fuera de debug se usa la propuesta física.

Con controles en 100% y Centro, probar ambos modelos, frente/yaw, movimiento
rápido, mirar a los lados y parpadear. Comparar después con el probador anterior
completo: el selector histórico aísla escala, pero no recrea todo el renderer V1.
El criterio sigue siendo tamaño similar al anterior y tracking V2 superior.
Móvil se abordará después de la comparación física en PC.

El panel y `window.__OPTICA_STYLO_VTO__.snapshot()` incluyen todos los datos
solicitados, además de confianza, peso, fuente y ratio propuesto/V1.
`window.__OPTICA_STYLO_VTO__.scaleSamples()` devuelve las últimas 300 mediciones
válidas mientras debug está activo. La comparación es previa al filtro; el
campo existente `pixelsPerMm` muestra la escala que usa el renderer (filtrada
en video, incluyendo el factor manual). No se registran rostros ni video.

## Reproducción y validación

`node scripts/report-vto-scale.mjs` reproduce tablas, ratios y escenarios, y
genera [vto-scale-fix-evidence.json](vto-scale-fix-evidence.json).
Los escenarios sintéticos separan anatomía facial y distancia de cámara.

Las pruebas ejecutan los algoritmos archivados completos de ambos commits;
sus SHA-256 verifican que sólo cambian rutas de importación. Comparan px/mm
y ancho final de ambos modelos con inputs iguales, matriz normal/tipada o
ausente, yaw, pitch, distintas resoluciones, iris ausente y un solo iris.
También prueban rostros de 115/135/155/180 mm, cerca/lejos, rechazo de outliers,
mirada con diámetro constante, independencia del offset, retención, transición,
recuperación, timestamps viejos y la prioridad de iris=2 frente a face=2.8.

Validación final:

| Comando | Resultado |
|---|---|
| `npm test` | **636 tests pasaron**, 0 fallos, 0 omitidos |
| `npm run lint` | Éxito, 0 errores / 0 warnings |
| `npm run build` | Éxito, Next 16.3.8 / Turbopack; 67 páginas; compilación 27.5 s |

El primer intento de build rechazó el enlace de node_modules fuera de la raíz.
Se sustituyó por una copia local de las mismas dependencias, sin modificar
lockfile, versiones o configuración de Next. El build final incluye las
métricas nuevas; se verificó también en `next start`.

En navegador se observaron los tres modos sobre la primera captura:
histórico **1.305850946**, V2 original **1.560566633**, físico **1.276596003**,
con posición y quaternion iguales. En producción, la segunda captura dio
RB2140 **198.074444 px** y HD0896 **183.526423 px**, ambos con ratio a V1
**1.007691323**, y ancho de HD0896 conservado en **137 mm**.
El selector queda disponible sólo en debug. La webcam no se activó durante
estas verificaciones; se usaron las capturas suministradas.

Se verificó por diff que los archivos protegidos de tracking, worker, filtros,
fitting, importación, contrato, CSS y modelos coinciden con `7290abc…`.
El checkout original conserva exactamente la misma lista de cambios sin
commit en `provadorv2-mobile-rebuild`; `main` sigue en `f06fa…`.

Para la comparación física queda servido este worktree en
`http://localhost:3003/virtual-try-on/3d?vtoDebug=1`, con cámara apagada.
Esta propuesta y estos checks **no constituyen aceptación visual humana**.
