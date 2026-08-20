# Contrato de modelos para el probador 3D

El probador 3D no contiene ajustes por marca, SKU ni archivo GLB. Cada marco se
procesa una sola vez al ingresar al catálogo y produce un sidecar JSON
versionado. En tiempo de uso, el navegador solo carga el GLB, valida el sidecar
y aplica la pose facial.

```text
GLB + medidas comerciales
          │
          ▼
 importador 3D offline
          │
          ├─ detecta piezas y ejes
          ├─ calcula origen y unidades
          ├─ calcula la zona de oclusión
          └─ valida el resultado
          │
          ├─ valid ───────────────► GLB + sidecar publicados
          └─ review_required ─────► revisión excepcional
```

## Convención recomendada

Los nuevos archivos deben usar, como mínimo, estos nombres:

```text
frame_front
bridge
hinge_left
hinge_right
temple_left
temple_right
```

También se reconocen `lens_left`, `lens_right`, `nosepad_left` y
`nosepad_right`. El importador admite alias habituales para modelos existentes;
si no puede identificar con confianza las piezas obligatorias, genera metadata
con estado `review_required` y el runtime se niega a publicarla.

## Datos físicos

La ficha de importación conserva las medidas comerciales reales en milímetros:

- ancho total del marco;
- ancho de lente;
- ancho de puente;
- largo de patilla.

El tracking estima cuántos píxeles representa un milímetro mediante el iris y
usa el ancho facial como respaldo. Por eso un marco de 150 mm se muestra mayor
que uno de 137 mm: el motor no estira todos los productos hasta el mismo ancho
de cara.

## Importación

Cada SKU tiene una ficha en `config/virtual-try-on-3d`. Para generar uno o más
sidecars:

```bash
npm run frames:import-3d
node scripts/import-3d-frames.mjs config/virtual-try-on-3d/OTRO-SKU.json
```

El sidecar incluye:

- versión del contrato y hash SHA-256 del GLB;
- identidad y dimensiones físicas;
- nodos asignados a cada rol;
- anclajes del puente y las bisagras;
- conversión de unidades y transformación de origen;
- plano de profundidad situado entre el frente y las patillas;
- confianza, advertencias y estado de validación.

El contrato compartido está en
`src/virtual-try-on-3d/model-contract.js`. El análisis offline está en
`src/virtual-try-on-3d/model-importer.js`; este módulo no se incluye en el
bundle del navegador.

## Primer artefacto

`HD0896-001` es el primer modelo validado por el pipeline. Sus medidas son
`56-15-145`, con ancho total declarado de 137 mm. Sus nombres originales se
conservan en el GLB y se relacionan con los roles estándar en el sidecar; no hay
condiciones especiales para Harley-Davidson en el motor de render.
