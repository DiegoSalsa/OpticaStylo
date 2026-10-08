# Auditoría previa — 7 octubre 2026

Base: main, árbol limpio. Rama de intervención: feature/vto-perfection-v2.
Se inspeccionaron tracking, overlay, renderer, geometría, materiales, contrato,
importador, publicación, preparación RB2140, configuraciones, sidecars y tests.

| Hallazgo | Causa | Severidad | Intervención |
|---|---|---|---|
| Seguimiento escalonado y tardío | Inferencia síncrona en RAF, intervalo fijo de 40 ms, sin deduplicar video.currentTime | Alta | Rediseñar adquisición: RVFC, una inferencia en vuelo, worker y fallback medido |
| Retraso acumulado | Filtro basado en error contra la pose filtrada, coeficientes bajos, dead zones, ninguna predicción visual | Alta | Filtro temporal adaptativo por canal y predicción acotada sin colas |
| Pose dependiente de mirada | Diámetro iris contribuye 45% a la escala por frame | Alta | Estructuras rígidas para pose/escala; no usar iris dinámico |
| Signos de rotación ambiguos | Euler de matriz y elección de signo por heurística de nariz | Alta | Conversión explícita de matriz y espejo; quaternion; fallback con base ortonormal |
| Puente ignorado | Anchor bridge almacenado pero posición tomada de eyeCenter más dos offsets | Alta | Alinear bridgeSeat con nariz; origen físico del modelo |
| Patillas dentro de cabeza | Ángulo simétrico, máximo 0.14 rad, sin volumen ni comprobación de vértices | Alta | Solver por lado, proxy elipsoidal y muestras reales de geometría |
| Bending en espacio incorrecto | Shader usa position local frente a anchors calculados en mundo GLB | Alta | Hornear transformaciones del GLB antes de deformar |
| Escala física inventada | Inferencia de unidades por rango de bounding box | Alta | Exigir frameWidth o declaración inequívoca de unidades |
| Importador dependiente de nombres | Roles obligatorios, ejes arbitrarios requieren preparación manual | Alta | Orientación geométrica, anchors con confianza, Full/Partial/Basic |
| RB2140 usa pipeline distinto | SHA fijo, bridge manual, Z y origen distintos | Alta | Reimportar con el mismo pipeline genérico |
| Oclusor desfasado del marco | Suavizado independiente de 1404 coordenadas; geometría y modelo no comparten transform | Alta | Máscara en coordenadas locales, una misma pose renderizada |
| Cámara ortográfica aproximada | Correcta coincidencia XY a plano de referencia, sin perspectiva de patillas; near negativo | Media | Perspectiva con intrínsecos declarados y reproyección consistente; documentar focal estimada |
| Recursos y carreras | Foto no tiene token de cancelación; cambios de modelo conservan metadata/pose anterior; inicio puede continuar tras video.play | Alta | Invalidación de sesiones y resultados, reset de filtro y cleanup |
| Allocations | Arrays/objetos/Quaternions nuevos en estimador y filtro; malla nueva cada inferencia | Media | Buffers reutilizados en render; medir coste de estimador, no optimizar a ciegas |
| React | No hay setState de pose por frame; estado de detección cambia sólo en transiciones | Baja | Conservar refs; métricas fuera de estado React |
| Ajustes normales | Default scale 0.97 + offset 2 mm encima de offset de modelo 2 mm | Alta | Valores neutros; controles sólo en debug |
| Publicación | No verifica SHA sidecar frente a GLB a publicar | Alta | Validar identidad binaria antes de acceso a BD |

## Referencias inspeccionadas

- [WebAR.rocks.face](https://github.com/WebAR-rocks/WebAR.rocks.face),
  commit 819cdbad4e87a43635d5f9724e30f277a7e7964d: ThreeHelper computa pose
  PnP con focal y correspondencias; Mirror inyecta bending y fading por shader;
  estabilizadores incluyen One Euro. Licencia MIT del repositorio verificada.
  Aprovechar conceptos de intrínsecos, adaptación a velocidad y profundidad.
  Descartar ángulo fijo global y dependencia de nombres/materiales; no cambiar motor.
- [GlassesTryOn](https://github.com/estephanobrusa/GlassesTryOn),
  commit 80ee6a244005d46a0ecce43bdd11269c93a72b55: separación runner/estimator/
  applier/scene; base eye-line y forehead/chin ortogonalizada; slerp adaptativo.
  CameraCalibration declara fx/fy pero estimator no los usa; escala y offsets
  siguen heurísticos. MIT verificada. Aprovechar separación y fallback de ejes,
  conservar medidas físicas de Stylo y evitar coeficientes dependientes del FPS.
- [basic-virtual-tryon-glasses](https://github.com/alperenuzun/basic-virtual-tryon-glasses),
  commit a1413d539e816aa4cfd6f893b1b61075cda08a86: FaceLandmarker, control de
  inferencia, base ortogonal y máscara Face Oval con centro profundo. Sin LICENSE
  encontrada: referencia conceptual, ningún código copiado. Conservar máscara
  densa en Stylo: fan no representa nariz ni profundidad anatómica.
- [MediaPipe Web](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js)
  confirma detectForVideo síncrono: un worker evita bloqueo del hilo UI.
- [One Euro](https://gery.casiez.net/1euro/) fundamenta cutoff dependiente de velocidad.

## Aceptación y límites antes de implementar

Pruebas deterministas: máximo una inferencia; timestamps duplicados/antiguos
descartados; recuperación sin arrastrar velocidad; quaternion normalizado;
reducción de ruido subpíxel; horizonte máximo 25 ms; escala ajena a iris;
invariancia de importación en rotaciones, traslación, unidades y nombres;
geometría real de patillas fuera del proxy con margen 1 mm o resultado explícito
de límite físico alcanzado. Test/lint/build completos. No escribir datos productivos.

Objetivos de hardware a verificar, no resultados asumidos: render >=55 Hz en
pantalla 60 Hz, p95 edad de tracking <80 ms, jitter quieto <0.5 px de cámara,
sin penetración visible a yaw ±45°. No puede garantizarse una focal real,
ancho craneal absoluto ni orientación de un sólido perfectamente simétrico
sólo con webcam/GLB arbitrario; incertidumbre debe quedar visible en metadata
y en informe. La validación humana en cámara y móvil es distinta de fixtures.
