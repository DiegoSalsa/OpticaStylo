# Migración integral a Prisma ORM

## Resultado arquitectónico

La arquitectura anterior era `Route Handler → Service → Repository → pg → PostgreSQL`. La arquitectura vigente es `Route Handler → Service → Repository → Prisma ORM → PostgreSQL`.

Prisma solo se importa desde `src/db/prisma.js`, repositories y scripts administrativos. Los Route Handlers y Services conservan sus contratos y no acceden directamente al ORM. Se eliminaron `pg`, el pool, los helpers `executeQuery`/`executeTransaction` y el migrador SQL propio. No se usa `$queryRaw`, `$executeRaw` ni sus variantes inseguras.

## Modelo y decisiones

`prisma/schema.prisma` fue introspectado desde la base existente y contiene las 49 tablas, claves primarias, claves foráneas, índices, restricciones únicas, tipos PostgreSQL, defaults y relaciones. `@map` y `@@map` fijan explícitamente los nombres físicos existentes para evitar renombrados accidentales.

PostgreSQL sigue aplicando los CHECK, índices de expresión y triggers que Prisma no representa semánticamente. Estas estructuras se conservan en el baseline. Prisma Client expresa todas las lecturas y escrituras de runtime con `findUnique`, `findFirst`, `findMany`, `create`, `createMany`, `update`, `updateMany`, `deleteMany`, `upsert`, `count`, `aggregate`, `groupBy` y `$transaction`.

Las garantías concurrentes se implementan con transacciones `Serializable`, constraints únicas y actualizaciones condicionales. El worker de correo reemplaza `FOR UPDATE SKIP LOCKED` por una selección seguida de `updateMany` condicional: solo el trabajador que cambia la fila desde `PENDING`/`FAILED` a `PROCESSING` obtiene la reclamación. Pagos, citas, caja, descuentos, recetas, ventas y checkout se ejecutan de forma atómica.

## Baseline y conservación de datos

La migración `prisma/migrations/20260908000000_baseline/migration.sql` consolida, en orden, las 32 migraciones históricas. En una base vacía, `prisma migrate deploy` crea el esquema completo. En una base existente no se ejecuta el DDL otra vez:

1. `npm run db:baseline` comprueba mediante Prisma que `schema_migrations` contiene exactamente las versiones 1 a 32.
2. Solo después ejecuta `prisma migrate resolve --applied 20260908000000_baseline`.
3. `npm run db:migrate` confirma y despliega cualquier migración Prisma posterior.

Nunca se debe ejecutar `prisma migrate reset` contra una base con datos.

## Base nueva

```bash
cp .env.example .env.local
npm ci
npm run prisma:validate
npm run db:migrate
npm run db:check
npm run users:bootstrap-admin
```

## Base existente

Crear un respaldo según las herramientas del proveedor y ejecutar una sola vez:

```bash
npm ci
npm run prisma:validate
npm run db:baseline
npm run db:migrate
npm run db:check
```

Si la comprobación de las 32 versiones históricas no coincide, el baseline se detiene y requiere una reconciliación manual; nunca intenta reparar o borrar datos.

## Migraciones futuras

En desarrollo, modificar `schema.prisma` y crear una migración versionada:

```bash
npx prisma migrate dev --name descripcion_del_cambio
npm run prisma:generate
```

Revisar el SQL generado por Prisma, ejecutar lint/tests/build y versionar conjuntamente el schema y la carpeta nueva. En CI, universidad y Vercel se usa exclusivamente `prisma migrate deploy`, que no es interactivo.

## Vercel

`postinstall` genera Prisma Client. `vercel.json` valida el schema, ejecuta las migraciones pendientes y compila Next.js. `DATABASE_URL` es la única fuente de credenciales. La URL debe incluir los parámetros TLS/pooling requeridos por el proveedor PostgreSQL; ninguna variable de servidor se expone al navegador.

## Universidad

El workflow usa Node 22 y npm 11.6.2, instala dependencias, genera y valida Prisma Client, ejecuta lint y tests y llama a `scripts/deploy-university.sh`. El script prepara una release aislada, instala el entorno privado, verifica la base con una consulta Prisma, compila, ejecuta `prisma migrate deploy`, conmuta el symlink, recarga PM2 y consulta `http://127.0.0.1:3000/api/health`.

Si una base universitaria histórica todavía no posee `_prisma_migrations`, un error P3005 activa la validación estricta del baseline y luego reintenta el deploy. No se establece un baseline si falta alguna migración histórica.

## Rollback

Si PM2 o el health check fallan, el script restaura el symlink de la release anterior y vuelve a cargar PM2. Prisma Migrate no revierte automáticamente DDL: una migración futura que necesite rollback debe incluir una migración correctiva hacia delante compatible con los datos. Antes de cambios destructivos se requiere respaldo verificado.

## Riesgos conocidos

- Los CHECK, triggers e índices de expresión de PostgreSQL viven en el baseline porque Prisma 6 no los modela completamente.
- Las transacciones serializables pueden abortar ante contención extrema; los callers reciben el error y pueden reintentar la operación completa sin producir duplicados.
- Los reportes agrupan en memoria después de una consulta Prisma para evitar SQL raw. Si el volumen crece sustancialmente, conviene introducir tablas de agregados mantenidas mediante Prisma.
