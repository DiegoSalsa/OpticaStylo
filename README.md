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

## Migraciones

Las migraciones se almacenan en `src/db/migrations` y utilizan nombres como `001_crear_usuarios.sql`. Una migración aplicada es inmutable: cualquier modificación posterior será detectada mediante su checksum.

Después de aplicar las migraciones en una base nueva, ejecutar una sola vez:

```bash
npm run users:bootstrap-admin
```

El comando solicita la contraseña sin mostrarla ni recibirla mediante argumentos del shell.

## Comprobación inicial de la API

```text
Método: GET
URL: http://localhost:3000/api/health
Headers: no requiere
Body: no requiere
Respuesta esperada: 200 OK con success=true y status="ok"
```
