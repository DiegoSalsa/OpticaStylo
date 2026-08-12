# Migraciones de PostgreSQL

Las migraciones son archivos SQL inmutables y se ejecutan en orden ascendente.

El nombre debe respetar el formato:

```text
001_descripcion_breve.sql
002_otra_modificacion.sql
```

Cada cambio debe incluirse en un archivo nuevo. No se debe modificar ni eliminar una migración que ya haya sido aplicada, porque el ejecutor comprueba su checksum SHA-256.

Cada migración se ejecuta dentro de una transacción independiente. Por esta razón, no debe contener instrucciones que PostgreSQL prohíba dentro de una transacción.
