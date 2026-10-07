# Continuidad del tracking con inferencia lenta

Fecha: 2026-10-07. Rama: `provadorv2`. Referencia aprobada: `9b6af11df2f298f1655633bb824a2c98bdae4c12`.

La corrección está lista para una nueva prueba humana en un teléfono físico. La causa temporal se reproduce con pruebas deterministas; estas pruebas no permiten asegurar que sea la única causa del parpadeo observado en ese teléfono.

## Causa comprobada

El filtro anterior guardaba el timestamp de captura como `lastSeen`. `sample()` ocultaba la pose cuando esa medición superaba `MAX_RESULT_AGE_MS = 180`, aunque MediaPipe acabara de devolver un rostro válido. Una inferencia de 220 o 300 ms producía una pose que ya había vencido al llegar. Además, `update()` reiniciaba el estado al superar 180 ms entre mediciones, y un resultado nulo borraba velocidad y velocidad angular incluso durante una pérdida breve.

La simulación del código aprobado reproduce las ocultaciones de la tabla siguiente. La instrumentación permite comprobar en el teléfono si además intervienen resultados sin rostro, rechazos geométricos, errores del SDK o resultados descartados por orden/sesión.

## Relojes y política

Todos los timestamps usan milisegundos de `performance.now()`; `mediaTime` solamente identifica frames.

| Timestamp | Uso |
| --- | --- |
| `measurementTimestamp` | Captura de la última imagen procesada, incluido un miss. |
| `receivedTimestamp` | Recepción de su resultado después de convertir la pose y antes de actualizar el filtro. |
| `lastValidMeasurementTimestamp` | Última medición con pose aceptada; controla `dt`, velocidad y predicción. |
| `lastValidReceivedTimestamp` | Última recepción con pose aceptada; controla visibilidad y pérdida sostenida. |

Ejemplo: captura en 0, recepción válida en 220. En ese instante `measurementAgeMs = 220`, `timeSinceLastValidResultMs = 0`; la pose está visible.

La gracia se calcula como tres intervalos esperados de entrega, limitada a **180–800 ms**. Se consideran la cadencia observada, su media suavizada, el coste de procesamiento y el tiempo de una inferencia pendiente. El mínimo de 180 ms conserva la ventana de escritorio aprobada. Tres intervalos permiten dos misses breves y la próxima entrega esperada; el máximo de 800 ms limita la persistencia sin rostro a menos de un segundo. Con entregas cada 264 ms resulta 792 ms; con entregas cada 363 ms resulta 800 ms.

El máximo tiene prioridad: si no llega una pose válida durante más de 800 ms, se declara pérdida incluso si el dispositivo solamente alcanzó a entregar pocos resultados. No se promete conservar visibilidad durante dos misses arbitrariamente largos.

- `SEARCHING`: todavía no hay una pose válida.
- `TRACKING`: se aceptó una pose válida; las nuevas mediciones se aplican inmediatamente.
- `TRACKING_GRACE`: un miss conserva pose, filtros, quaternion, escala, patillas y dinámica; cancela la predicción. Los misses no renuevan el timestamp de la última recepción válida.
- `LOST`: al vencer la gracia se oculta, se reinician filtros de movimiento y velocidad, y se cuenta una sola expiración. La siguiente pose reaparece directamente, sin viajar desde la anterior.

La predicción sigue limitada a **25 ms** y pierde confianza después del horizonte corto. Una medición retrasada 220 ms no se extrapola 220 ms. El badge de rostro usa la misma pose estabilizada que la visibilidad del render. No se añadieron fades ni retrasos para aplicar poses nuevas.

El `dt` ahora usa el intervalo real entre mediciones válidas, sin recortarlo a 200 ms en un dispositivo lento. Los coeficientes del filtro y los cálculos de posición, orientación, escala y patillas permanecen iguales.

## Métricas para la nueva prueba

Abrir el probador con `?vtoDebug=1` y expandir **Diagnóstico de seguimiento**. Estas métricas no aparecen en el flujo normal:

- `backend`: `worker` o `main-thread`.
- `inferenceCount`, `faceResultCount`, `noFaceResultCount`.
- `poseAcceptedCount`, `poseRejectedCount`, `poseConversionRejectedCount`, `poseFilterRejectedCount`.
- `temporaryMissCount`, `visibilityTimeoutCount`, `inferenceErrorCount`, `discardedResultCount`.
- `measurementAgeMs`, `timeSinceLastValidResultMs`, los cuatro timestamps y `currentGraceMs`.
- `sdkExecutionTimeMs` / `inferenceDurationMs`, `smoothedInferenceDurationMs`, `totalProcessingTimeMs`, `resultDeliveryIntervalMs` y su media suavizada.
- `trackingState`, `predictionEnabled`, `poseRejectReason` y `poseFilterRejectReason`.

`landmarksToGlassesPose()` conserva todos sus umbrales. Solamente agrega causas de rechazo: `missing-metadata`, `no-landmarks`, `invalid-video-dimensions`, `landmark-count`, `invalid-landmarks`, `invalid-quaternion`, `eye-distance`, `face-width`. Una excepción de conversión registra `pose-exception`; una excepción del SDK se cuenta aparte de cero rostros. El filtro identifica `invalid-timestamps`, `stale-measurement` y `stale-receipt`.

En worker se usa el tiempo SDK informado por el propio worker. En fallback se mide la invocación síncrona de `detectForVideo()` antes de hacer `await`. El tiempo total incluye recepción y conversión; el intervalo de entrega mide la separación real entre resultados. Las inferencias mantienen la cadencia anterior y una sola solicitud en vuelo.

## Evidencia reproducible

Simulación de **6 segundos**, captura cada **33 ms** y reloj de render a **60 Hz**. En main-thread se omiten callbacks RAF durante el bloqueo síncrono simulado; no se atribuyen 60 FPS a un hilo bloqueado. La continuidad se verifica en todos los callbacks disponibles, y el bloqueo del SDK sigue siendo una limitación de rendimiento.

| SDK simulado | Backend | Entrega | Inferencias | Renders ocultos después de primera recepción: antes / después |
| --- | --- | --- | --- | --- |
| 220 ms | worker | 264 ms | 22 | 346 / **0** |
| 220 ms | main-thread | 264 ms | 22 | 58 / **0** |
| 300 ms | worker | 363 ms | 16 | 342 / **0** |
| 300 ms | main-thread | 363 ms | 16 | 61 / **0** |

La alternancia 20/220/300/30 ms también tiene cero ocultaciones en ambos backends. En worker, el filtro anterior ocultaba 229 renders de esa secuencia. Los resultados completos están en [vto-liveness-evidence.json](./vto-liveness-evidence.json).

Se añadieron **34 tests**: 21 de liveness y 13 de diagnóstico. Cubren latencia lenta y variable, diferencia entre edades, uno/dos misses a 4 Hz, límite de pérdida real, misses que no renuevan vida, recuperación sin velocidad residual, `dt` real, predicción acotada, aplicación inmediata, orden temporal, cadencia y causas geométricas. Un test existente se ajustó para exigir conservación de dinámica durante el miss y limpieza después de pérdida confirmada.

La regresión de escritorio compara 181 renders durante 3 segundos con capturas cada 33 ms y latencias de **15, 20 y 30 ms** contra el filtro archivado del commit aprobado. Los fingerprints de posición, quaternion, escala y patillas coinciden, con precisión de 1e-10. La referencia se guarda en `tests/fixtures/tracking-desktop-baseline.json`.

También se comprobó la integración local del navegador: worker activo, panel con contadores separados y sin errores de consola. Una observación sin rostro registró 1440 inferencias y 1440 respuestas sin rostro, cero rechazos de pose y cero timeouts; SDK 13.6 ms, procesamiento total 14.5 ms y entrega 33.9 ms. Esta comprobación valida la instrumentación; no sustituye una prueba humana de seguimiento. El replay sintético de escritorio mostró el modelo y movimiento con render cercano a 60 FPS.

Validación final:

- `npm test`: **653 aprobados**, cero fallos, cero omitidos.
- `npm run lint`: aprobado.
- `npm run build`: aprobado, producción compilada y 67 páginas generadas.

No cambiaron importer, canonicalización, dimensiones físicas, bridge fitting, colisión, oclusión, materiales, assets GLB, worker, cámara desktop, configuración de cámara móvil ni su `contain` aprobado. El cambio de geometría solamente expone razones de rechazo; el cambio de interfaz solamente ordena métricas en debug.

## Retest físico pendiente

En el mismo teléfono, repetir movimientos frontales y laterales con el probador normal; después repetir con `?vtoDebug=1`. Si aparece parpadeo, observar qué contador crece: `noFaceResultCount`, `poseConversionRejectedCount`, `poseFilterRejectedCount` o `visibilityTimeoutCount`. Comparar `measurementAgeMs` con `timeSinceLastValidResultMs`, `currentGraceMs`, backend y duración SDK. Verificar desaparición tras pérdida sostenida y reaparición sin recorrido residual. La aprobación definitiva del comportamiento móvil corresponde a esta nueva prueba física.
