# Óptica Stylo

Plataforma web para centralizar los procesos comerciales y clínicos de una óptica. El proyecto se desarrolla con una estrategia backend primero y utiliza Next.js, JavaScript y PostgreSQL.

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
src/
├── app/api/       Route Handlers y contratos HTTP
├── auth/          Autenticación, sesiones y autorización
├── components/    Componentes reutilizables del frontend
├── constants/     Constantes compartidas
├── db/            Conexión, transacciones y migraciones
├── repositories/  Acceso a PostgreSQL
├── services/      Reglas y coordinación de negocio
├── utils/         Utilidades comunes
└── validations/   Validación de entradas
```

Las rutas HTTP deben delegar la lógica de negocio a los servicios, y los servicios deben acceder a PostgreSQL mediante repositorios.

## Documentación de la API

- `docs/authentication-api.md`: sesiones y administración de usuarios.
- `docs/authorization.md`: roles y permisos efectivos.
- `docs/patients-api.md`: datos básicos de pacientes y responsables.
- `docs/scheduling-api.md`: profesionales, disponibilidad y reservas.
- `docs/clinical-api.md`: ficha clínica, atenciones, adendas y recetas ópticas.
- `docs/commercial-api.md`: clientes, catálogo, cotizaciones, ventas y abonos.
- `docs/mercado-pago.md`: Checkout Pro, intentos de pago y webhooks.
- `docs/ecommerce-decisions.md`: decisiones provisionales para la tienda en línea.
- `docs/ecommerce-api.md`: cuentas, catálogo público, carritos, recetas y pedidos.

- `docs/virtual-try-on.md`: prueba virtual, recursos por marco y criterios de viabilidad.

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

## Despliegues

- Producción continúa desplegándose en Vercel y utilizando la base configurada en Neon.
- El entorno académico puede desplegarse en un servidor universitario mediante un runner propio, PM2 y Nginx.
- La preparación, las variables privadas y la activación segura están documentadas en `docs/despliegue-universidad.md`.
