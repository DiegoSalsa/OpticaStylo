# Probador virtual 3D

El producto final usa exclusivamente un probador 3D. La interfaz, geometría y activos del prototipo 2D fueron retirados.

## Arquitectura actual

1. El navegador solicita la cámara mediante `getUserMedia`.
2. MediaPipe Face Landmarker detecta puntos del rostro localmente.
3. `virtual-try-on-3d-geometry.js` calcula posición, rotación y escala física.
4. React Three Fiber y Three.js renderizan un GLB calibrado.
5. Una malla de profundidad oculta correctamente parte de las patillas al girar.
6. Ningún fotograma se envía al backend.

El prototipo intenta GPU y usa CPU como alternativa. Requiere HTTPS fuera de `localhost`.

## Estado del catálogo

Existe un GLB calibrado de muestra en `public/virtual-try-on/models`. Sirve para validar el pipeline, pero no debe presentarse como catálogo real.

La migración 015 agrega `virtual_try_on_3d_assets`, con:

- versión por producto;
- un solo activo vigente;
- GLB y metadatos de calibración;
- hash SHA-256;
- licencia y atribución;
- retiro sin borrar historial.

Los endpoints públicos de modelos solo exponen activos vigentes asociados a marcos activos. El frontend usa el catálogo cuando existen modelos publicados y conserva el GLB de muestra como fallback de desarrollo.

## Restricción de licencias

Solo se aceptan:

- `CC0-1.0`;
- `CC-BY-4.0`, con atribución obligatoria;
- `OWNED_BY_OPTICA_STYLO`, para modelos creados a partir de productos propios.

No se deben incorporar bibliotecas, servicios o activos que exijan licencias comerciales por uso, usuario, modelo o volumen.

## Cómo convertirlo en catálogo real

Por cada marco se necesita:

1. identificar el producto real y su SKU;
2. crear o recibir una geometría fiel, con frente y patillas;
3. documentar origen y derechos;
4. limpiar, orientar y optimizar el GLB con Blender u otra herramienta libre;
5. ejecutar el importador y revisar su sidecar de calibración;
6. probar frente, giro, oclusión y escala en varios rostros/dispositivos;
7. publicar una versión asociada al producto;
8. retirar la versión anterior sin eliminarla.

## Criterios antes de producción

- Peso objetivo por GLB y presupuesto de memoria definidos.
- Sin texturas o extensiones incompatibles con navegadores objetivo.
- Dimensiones físicas cotejadas con el marco real.
- Pruebas Android, iOS, Windows y navegadores soportados.
- Mensajes accesibles para permiso denegado, cámara ausente y fallo de tracking.
- Política de privacidad validada.
- Catálogo real cargado; el modelo de muestra no debe ser el único modelo en producción.
