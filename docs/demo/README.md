# Datos ficticios para la demostración

La preparación es manual y nunca forma parte de `postinstall`, CI, deploy ni
arranque. Para ejecutarla en una base de demostración:

```powershell
$env:DEMO_PREPARE_CONFIRM = "YES"
npm run demo:prepare
```

El script se niega a ejecutarse con `NODE_ENV=production`, exige que el dominio
de correo termine en `.invalid` y solo reutiliza sus registros cuando coinciden
con los RUT y la marca `[DEMO-OPTICA-STYLO-2026]`. No borra datos, no hace
`deleteMany` y no envía correos.

El paciente principal es Juan Pérez Soto, con el correo persistente de demo
`jperez@demo.opticastylo.invalid`. El resto de los registros usa el mismo
dominio no enrutable y nombres comunes de Concepción. Para la carga de receta
en POS debe usarse [`receta-externa-juan-perez.png`](receta-externa-juan-perez.png);
la versión de texto contigua sirve como referencia verificable de sus valores.

Si un horario elegido ya está ocupado por datos que no pertenecen a esta demo,
el script lo conserva y lo informa como conflicto; nunca lo reemplaza.
