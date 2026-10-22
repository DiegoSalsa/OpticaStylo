# Demostración y regresión

La presentación del **22 de octubre de 2026 será en producción, con las cuentas
y registros existentes**, según la aclaración del responsable del proyecto.
No ejecutar ningún seed en ese ambiente.

- [Guion de producción](guion-produccion-2026-10-22.md).
- [Validaciones empresariales y PA-01 a PA-16](validacion-contraparte.md).
- [Informe técnico de preparación](preparacion-2026-10-22.md).

## Preparación exclusiva del laboratorio

`prepare-demo-data.mjs` sirve para ensayar y verificar regresiones. Es manual y
nunca forma parte de instalación, CI, despliegue ni arranque. Exige PostgreSQL
local dedicado, `ACADEMIC_ISOLATION=true`, una base `stylo_academic_<id>` y un
esquema `stylo_e2e_<id>` coincidente. Un `NODE_ENV=development` por sí solo no
habilita una base remota ni una base local ajena.

En un checkout de pruebas sin `.env*` privados ni otra ejecución activa, con
Docker disponible:

```powershell
node scripts/run-academic-validation.mjs prepare tmp/demo-audit
$env:DEMO_DATE = "2026-10-22"
$env:DEMO_PREPARE_CONFIRM = "YES"
node scripts/run-academic-validation.mjs demo
```

El runner proporciona la conexión aislada y deshabilita pagos, correo y lector
externo. No copiar la conexión productiva. Si no se indica `DEMO_DATE`, el
script elige mañana en `America/Santiago`; la conversión de horarios respeta
invierno y verano. El 22 de octubre de 2026 es jueves; 09:00 corresponde a
12:00 UTC. Las credenciales aleatorias solo quedan en
`tmp/academic-validation/demo-credentials.json`, ignorado por Git.

La carga reutiliza cuentas, roles y productos del fixture académico. Agrega
ocho pacientes, un cliente vinculado, una atención histórica con ficha y
receta, reservas de distintos estados, una venta pagada, una cotización y un
pedido pendiente. Los marcos HD0896 y RB2140 y los cristales proceden del fixture
existente; las tres fotografías locales del HD0896 siguen disponibles.

El script se niega a ejecutarse con `NODE_ENV=production` y exige un dominio
de correo `.invalid`. Reutiliza identidades y claves de operación; la marca
incluye la fecha, por ejemplo `[DEMO-OPTICA-STYLO-2026-10-22]`. Repetir la misma
fecha no reinicia estados ni duplica registros. No borra datos ni envía correos.

El paciente principal es Juan Pérez Soto, con el correo persistente de demo
`jperez@demo.opticastylo.invalid`. El resto de los registros usa el mismo
dominio no enrutable y nombres comunes de Concepción. Para la carga de receta
en POS debe usarse [`receta-externa-juan-perez.png`](receta-externa-juan-perez.png);
la versión de texto contigua sirve como referencia verificable de sus valores.

Si un horario elegido ya está ocupado por datos que no pertenecen a esta demo,
el script lo conserva y lo informa como conflicto; nunca lo reemplaza.

## Regresiones reproducibles

```powershell
node scripts/run-academic-validation.mjs catalog
node scripts/run-academic-validation.mjs reports
node scripts/run-academic-validation.mjs integration
node scripts/run-academic-validation.mjs store
node scripts/run-academic-validation.mjs management
node scripts/run-academic-validation.mjs build
node scripts/run-academic-validation.mjs serve
```

Las primeras cinco suites reciben un esquema nuevo por ejecución. El servidor
permanece en la última terminal; en otra puede ejecutarse `demo-e2e` después de
`demo`. Para las suites históricas de tienda y gestión, empezar cada una con
`reset` y su correspondiente `seed-store` o `seed-management`, sin otra suite
activa. Mezclar fixtures altera sus conteos y no es una prueba válida de esos
escenarios. `reset` solo actúa sobre el esquema sintético del contenedor propio.

`store-e2e` omite dos recorridos de imagen si Cloudinary está deshabilitado.
Esos recorridos requieren almacenamiento de prueba autorizado; no copiar todos
los secretos productivos al laboratorio. `demo-e2e` simula una caída de carga
para verificar la recuperación manual y no necesita proveedores externos.

Logs y capturas permanecen en `tmp/`. Evitar nombres de scripts temporales que
coincidan con `test-*.mjs`, porque `node --test` también los descubre. Al terminar
los ensayos, detener el servidor y ejecutar `cleanup` para retirar únicamente
el contenedor registrado de esta ejecución.
