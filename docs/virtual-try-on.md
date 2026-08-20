# Prueba virtual de marcos

La etapa 7 se implementa en la rama `pruebaVisual` y no depende de la futura
integración de inventario. Su objetivo es validar una experiencia de prueba
virtual útil antes de invertir en modelos tridimensionales o licencias
comerciales para todo el catálogo.

## Alternativa elegida

Se utiliza MediaPipe Face Landmarker en el navegador y una imagen 2D calibrada
por marco. La cámara, la detección y la composición se ejecutan en el dispositivo
del visitante. El backend solo entrega el catálogo y las imágenes de los marcos;
no recibe fotogramas, puntos faciales ni capturas.

La elección considera estas alternativas:

| Alternativa | Ventajas | Costos o límites | Decisión |
| --- | --- | --- | --- |
| MediaPipe + superposición 2D | Código abierto, sin licencia por usuario, procesamiento local y recursos sencillos | No representa con precisión las patillas ni la profundidad al girar mucho el rostro | Elegida para el MVP |
| MediaPipe + modelos 3D | Mejor perspectiva y rotación | Requiere un modelo 3D calibrado para cada marco y una canalización de Three.js/WebGL | Piloto disponible con un modelo real |
| SDK comercial especializado | Seguimiento, renderizado y herramientas de autor más completas | Licencia, dependencia del proveedor y preparación de efectos propia | Reevaluar si el MVP demuestra valor |

Referencias evaluadas:

- [MediaPipe Face Landmarker para Web](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js)
- [MediaPipe Tasks Vision](https://github.com/google-ai-edge/mediapipe/tree/master/mediapipe/tasks/web/vision)
- [Banuba Web AR](https://www.banuba.com/webar-sdk)
- [DeepAR Web](https://docs.deepar.ai/deepar-sdk/platforms/web/overview)
- [Jeeliz Face Filter](https://jeeliz.github.io/jeelizFaceFilter/)

## Experiencia implementada

La página está disponible en:

```text
GET /virtual-try-on
GET /virtual-try-on/3d
```

Incluye:

- solicitud automática del permiso de cámara al entrar en el probador;
- reintento explícito cuando el permiso fue rechazado o retirado;
- seguimiento facial automático de una sola persona;
- respaldo manual cuando el modelo no puede cargarse;
- selección de marcos;
- ajuste de escala, altura y rotación;
- suavizado de movimientos para reducir vibraciones;
- captura descargada únicamente al dispositivo;
- diseño adaptable para escritorio y teléfono;
- mensajes para permisos rechazados, cámara ausente u ocupada;
- tres marcos ilustrativos mientras no existan recursos reales activos.

La ruta 3D usa un contrato versionado común a todo el catálogo. Un importador
offline analiza cada GLB una sola vez, detecta sus piezas, conserva las medidas
físicas y genera anclajes y datos de oclusión. El navegador no inspecciona la
geometría: carga la metadata validada y calcula una escala aproximada en
milímetros mediante el iris, con el ancho facial como respaldo. Así los marcos
de tamaños distintos no terminan visualizándose con el mismo ancho.

El piloto incluye seguimiento de inclinación y giro, compensación de
perspectiva, suavizado entre detecciones, tolerancia breve ante pérdidas de
rostro y una máscara de profundidad común a todos los modelos. El HD0896 es el
primer artefacto validado por este pipeline; la especificación completa está en
[`virtual-try-on-3d-model-contract.md`](./virtual-try-on-3d-model-contract.md).

La cámara requiere `HTTPS` en producción. Los navegadores también permiten usarla
desde `localhost` durante el desarrollo, pero una dirección HTTP de la red local,
como `http://192.168.x.x`, no es un contexto seguro y no puede mostrar el permiso
de cámara. Las pruebas en teléfonos deben realizarse mediante HTTPS.

## Recursos necesarios por marco

Cada producto de categoría `FRAME` necesita:

1. una fotografía frontal recortada;
2. fondo transparente;
3. formato PNG o WebP;
4. encuadre horizontal, sin rostro ni fondo fotográfico;
5. peso máximo de 5 MiB;
6. una calibración inicial realizada sobre varios rostros.

La configuración almacenada contiene:

- `widthScale`: ancho relativo a la distancia entre los extremos de los ojos;
- `verticalOffset`: desplazamiento vertical relativo a esa distancia;
- `rotationOffsetDegrees`: corrección fija de inclinación;
- notas internas de calibración;
- versión, hash y trazabilidad del usuario que la creó o retiró.

Al reemplazar una imagen se retira la versión anterior sin eliminarla. Esto deja
un historial auditable y permite diagnosticar diferencias de calibración.

## API interna

Los endpoints internos requieren sesión y permisos de productos.

### Consultar versiones

```http
GET /api/products/:productId/virtual-try-on
```

### Crear una versión

```http
PUT /api/products/:productId/virtual-try-on
Content-Type: multipart/form-data
```

Campos:

| Campo | Tipo | Requerido |
| --- | --- | --- |
| `image` | PNG o WebP | Sí |
| `widthScale` | Decimal entre 1.2 y 4 | No; valor inicial 2.2 |
| `verticalOffset` | Decimal entre -1 y 1 | No; valor inicial 0 |
| `rotationOffsetDegrees` | Decimal entre -30 y 30 | No; valor inicial 0 |
| `notes` | Texto de hasta 500 caracteres | No |

El servidor valida el tamaño, el tipo declarado y la firma binaria del archivo.
Una carga nueva pasa a ser la única versión activa del producto.

### Retirar la versión activa

```http
DELETE /api/products/:productId/virtual-try-on
```

No elimina el archivo ni su historial.

## API pública

```http
GET /api/store/virtual-try-on/frames
GET /api/store/virtual-try-on/frames/:assetId/image
```

Solo expone recursos activos asociados a productos `FRAME` activos. La respuesta
pública no incluye nombres de archivo, notas ni identificadores del personal.
Las imágenes usan `ETag`, caché pública y `X-Content-Type-Options: nosniff`.

## Criterios de viabilidad

La prueba se considera técnicamente viable si, al evaluarla con los dispositivos
objetivo de la óptica:

- el navegador solicita consentimiento al entrar y la cámara inicia después de
  que la persona lo acepta;
- el seguimiento mantiene el marco estable mirando de frente;
- cambiar de marco no reinicia la cámara;
- el modo manual permite continuar en dispositivos no compatibles;
- no aparecen fotogramas en solicitudes de red ni en PostgreSQL;
- los recursos reales se pueden preparar y calibrar con un costo aceptable.

La implementación limita la detección a aproximadamente 15 inferencias por
segundo y renderiza la vista con `requestAnimationFrame`. El rendimiento real
debe registrarse al menos en un teléfono Android, un iPhone y un equipo de
escritorio antes de promover la funcionalidad a producción.

## Límites conocidos

- La superposición 2D está pensada para una pose mayormente frontal.
- No estima medidas físicas ni garantiza el calce real del marco.
- No sustituye la recomendación profesional ni la prueba presencial.
- El modelo y el runtime de MediaPipe se descargan actualmente desde servicios
  públicos de Google y jsDelivr; antes de producción se puede evaluar su
  alojamiento propio.
- La promoción a producción requiere pruebas reales de dispositivos,
  accesibilidad y aceptación de la clienta.
