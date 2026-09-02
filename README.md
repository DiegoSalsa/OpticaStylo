# Óptica Stylo

Plataforma web para centralizar los procesos comerciales, clínicos y de comercio electrónico de una óptica. Utiliza Next.js, JavaScript y PostgreSQL, con despliegues independientes para producción y el entorno académico.

## Alcance funcional

- Tienda pública con catálogo, carrito invitado o autenticado, pedidos y retiro en tienda.
- Reserva pública de horas y gestión interna de agenda profesional.
- Administración de pacientes, clientes, usuarios y profesionales.
- Ficha clínica, atenciones, recetas ópticas y conservación del historial.
- Punto de venta con cotizaciones, descuentos autorizados, abonos y comprobantes.
- Catálogo administrativo, imágenes en Cloudinary e inventario simulado.
- Pago mediante Mercado Pago y conciliación segura por webhook.
- Lectura asistida de recetas externas con revisión humana obligatoria.
- Probador virtual 3D con seguimiento facial y alternativa mediante fotografía.

## Requisitos

- Node.js 20.9.0 o posterior.
- npm 11 o una versión compatible.
- PostgreSQL, necesario a partir de la etapa de conexión con la base de datos.

## Configuración local

1. Instalar las dependencias:

   ```bash
   npm install
   ```

2. Copiar `.env.example` como `.env.local` y completar los valores locales.

3. Iniciar el servidor de desarrollo:

   ```bash
   npm run dev
   ```

4. Verificar PostgreSQL y aplicar las migraciones pendientes:

   ```bash
   npm run db:check
   npm run db:migrate
   ```

## Comandos disponibles

- `npm run dev`: inicia el servidor de desarrollo.
- `npm run build`: genera la compilación de producción.
- `npm run start`: inicia una compilación de producción.
- `npm run lint`: comprueba la calidad estática del código.
- `npm test`: ejecuta las pruebas automatizadas.
- `npm run db:check`: comprueba la conexión configurada con PostgreSQL.
- `npm run db:migrate`: aplica las migraciones SQL pendientes.
- `npm run db:migrate:status`: muestra el estado de las migraciones.
- `npm run users:bootstrap-admin`: crea interactivamente el primer administrador cuando la base no contiene usuarios.
- `npm run users:create-sales`: crea o renueva la cuenta operativa `SALES` del
  POS usando `POS_SALES_EMAIL` y `POS_SALES_PASSWORD`; si la contraseña está
  vacía, genera una aleatoria fuerte y la muestra al terminar.

## Estructura principal

```text
.github/workflows/  Despliegue automatizado del entorno académico
config/             Plantillas de configuración y calibración 3D
deploy/             Configuración del proxy Nginx
postman/            Colección reproducible de pruebas manuales de la API
public/             Recursos de marca, productos y modelo 3D
scripts/            Migraciones, usuarios, despliegue y publicación 3D
src/
├── app/api/       Route Handlers y contratos HTTP
├── app/           Interfaces públicas e internas
├── auth/          Autenticación, sesiones y autorización
├── components/    Componentes reutilizables del frontend
├── config/        Lectura y validación de variables de entorno
├── constants/     Constantes compartidas
├── db/            Conexión, transacciones y migraciones
├── integrations/  Adaptadores de servicios externos
├── repositories/  Acceso a PostgreSQL
├── services/      Reglas y coordinación de negocio
├── utils/         Utilidades comunes
└── validations/   Validación de entradas
tests/              Pruebas unitarias, integración, seguridad e infraestructura
```

Las rutas HTTP deben delegar la lógica de negocio a los servicios, y los servicios deben acceder a PostgreSQL mediante repositorios.

## Roles y separación de datos

- `ADMIN`: administración global, usuarios, catálogo, reportes y agendas.
- `SALES`: clientes, POS, pagos, pedidos y lectura comercial de recetas emitidas.
- `CLINICAL_PROFESSIONAL`: agenda propia, pacientes asignados, atenciones y recetas clínicas.

Paciente y cliente se modelan como conceptos distintos. Los datos clínicos no se exponen a administración ni ventas, salvo la proyección mínima de una receta finalizada necesaria para preparar una venta.

## Migraciones

Las migraciones se almacenan en `src/db/migrations` y utilizan nombres como `001_crear_usuarios.sql`. Una migración aplicada es inmutable: cualquier modificación posterior será detectada mediante su checksum.

Después de aplicar las migraciones en una base nueva, ejecutar una sola vez:

```bash
npm run users:bootstrap-admin
```

El comando solicita la contraseña sin mostrarla ni recibirla mediante argumentos del shell.

Para preparar una credencial limitada al punto de venta después de crear el
administrador:

```bash
npm run users:create-sales
```

El comando asigna exclusivamente el rol `SALES`, reactiva la cuenta si ya
existía y revoca sus sesiones anteriores al renovar la contraseña.

## Comprobación inicial de la API

```text
Método: GET
URL: http://localhost:3000/api/health
Headers: no requiere
Body: no requiere
Respuesta esperada: 200 OK con success=true y status="ok"
```

La colección `postman/OpticaStylo.postman_collection.json` permite recorrer los contratos de la API. Sus contraseñas y cookies se dejan vacías deliberadamente y deben configurarse solo en el entorno local de Postman.

## Calidad y seguridad

Antes de integrar cambios a `main` se deben ejecutar:

```bash
npm run lint
npm test
npm run build
npm audit --omit=dev
```

El proyecto incluye controles de acceso por permisos, sesiones revocables, cookies `HttpOnly`, limitación de solicitudes, idempotencia, validación de archivos, verificación de webhooks y migraciones con checksum. Los secretos nunca deben versionarse; `.env.example` y `config/universidad.env.example` contienen únicamente nombres y valores de referencia.

## Despliegues

- Producción continúa desplegándose en Vercel y utilizando la base configurada en Neon.
- El entorno académico puede desplegarse en un servidor universitario mediante un runner propio, PM2 y Nginx.
- Las variables privadas se conservan fuera del repositorio y cada entorno utiliza su propia base de datos.
- El workflow `.github/workflows/despliegueuniversidad.yml` valida y despliega exclusivamente los cambios de `main` mediante el runner propio.
- Los correos transaccionales permanecen deshabilitados hasta disponer de proveedor, remitente y dominio verificados; no se utiliza programación cron.

## Decisiones pendientes del negocio

- Proveedor, tarifas y reglas de despacho.
- Precios definitivos de cristales y adicionales ópticos.
- Datos reales del catálogo, existencias y sucursales de retiro.
- Software externo de inventario, versión, API, autenticación y documentación.

La integración definitiva de inventario permanece aplazada hasta recibir esa información. Mientras tanto, la disponibilidad mostrada por el sistema es explícitamente simulada.
