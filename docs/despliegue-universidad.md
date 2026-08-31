# Despliegue automatizado en el servidor universitario

Este despliegue convive con producción sin compartir infraestructura:

- Vercel continúa desplegando `main` mediante su integración y utiliza Neon.
- El servidor universitario utiliza un runner propio, PM2, Nginx y su archivo de entorno privado.
- La base universitaria puede ser otra instancia PostgreSQL. Nunca debe reutilizar datos clínicos reales para demostraciones.

## Requisitos que deben solicitarse

La aplicación requiere:

- Ubuntu Noble 24.04 o Debian 11.
- PostgreSQL 13.7 o una versión posterior compatible.
- El contenedor publica SSH en 1997, web en 1998 y PostgreSQL en 2000.
- Acceso SSH con un usuario sin privilegios permanentes de root.
- Al menos 2 GB de memoria; 4 GB son recomendables para compilar Next.js en el mismo servidor.

El entorno entregado es un contenedor Ubuntu Noble. PostgreSQL está dentro del mismo contenedor y se conecta localmente; la excepción sin TLS solo aplica a `127.0.0.1` mediante las variables explícitas del ejemplo.

## Preparar el servidor

Conectarse usando los datos entregados por la universidad:

```bash
ssh <usuario>@<ip> -p 22
```

Actualizar el sistema e instalar las herramientas necesarias:

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y ca-certificates curl nginx rsync git
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 22
nvm use 22
npm install --global pm2@latest
mkdir -p ~/apps/optica-stylo/releases
```

El contenedor no ejecuta `systemd`, por lo que no se debe usar `pm2 startup` ni `svc.sh`. Iniciar PM2 con el usuario de despliegue y guardar el estado:

```bash
pm2 startOrReload ~/apps/optica-stylo/current/ecosystem.config.cjs --update-env
pm2 save
```

Si el laboratorio configura una política de reinicio del contenedor, debe volver a ejecutar este arranque; mientras no exista esa política, una recreación requiere intervención manual.

## Crear el archivo de entorno

Copiar `config/universidad.env.example` al servidor como `~/optica-stylo.env`, completar únicamente allí los valores reales y protegerlo:

```bash
chmod 600 ~/optica-stylo.env
```

El archivo no se copia al repositorio ni se guarda en GitHub. En Vercel/Neon `DATABASE_SSL=true` sigue siendo obligatorio; la excepción sin TLS solo es válida para la base local universitaria.

## Configurar Nginx

La aplicación escucha solo en `127.0.0.1:3000`. Nginx recibe el tráfico interno en el puerto 80, publicado externamente por el laboratorio en el puerto 1998:

```bash
sudo cp deploy/nginx-optica-stylo.conf /etc/nginx/sites-available/optica-stylo
if [ -L /etc/nginx/sites-enabled/default ]; then sudo unlink /etc/nginx/sites-enabled/default; fi
sudo ln -s /etc/nginx/sites-available/optica-stylo /etc/nginx/sites-enabled/optica-stylo
sudo nginx -t
sudo nginx -s reload
```

El inicio por HTTP permite corroborar la instalación. En este entorno de pruebas se habilita explícitamente la cookie sin `Secure`, pero esa excepción no existe en Vercel/Neon. La cámara del probador requiere HTTPS; hasta disponer de un certificado se debe probar con carga de archivos o mediante un túnel local seguro.

## Instalar el runner de GitHub

En GitHub abrir `Settings > Actions > Runners > New self-hosted runner`, elegir Linux x64 y ejecutar en el servidor los comandos que GitHub muestre. El token de registro es temporal y no debe copiarse al repositorio ni a documentación.

Durante `config.sh`, agregar la etiqueta personalizada:

```text
opticastylo-universidad
```

El contenedor no ejecuta `systemd`, así que el runner se mantiene con un proceso en segundo plano del usuario de despliegue:

```bash
cd ~/actions-runner
nohup ./run.sh > ~/actions-runner/runner.log 2>&1 &
echo $! > ~/actions-runner/runner.pid
```

El runner debe pertenecer al usuario de despliegue y nunca ejecutarse como root. Si el contenedor se recrea, hay que iniciar nuevamente este proceso.

## Activar el pipeline

El workflow `.github/workflows/despliegueuniversidad.yml` permanece inactivo hasta que el servidor esté preparado. En `Settings > Secrets and variables > Actions > Variables` crear:

- `DESPLIEGUE_UNIVERSIDAD_HABILITADO` con valor `true`.
- `RUTA_ENTORNO_UNIVERSIDAD` con la ruta absoluta del archivo privado, por ejemplo `/home/usuario/optica-stylo.env`.

Antes de activarlo también debe resolverse cualquier bloqueo de facturación de GitHub Actions. Mientras la cuenta esté bloqueada, GitHub rechaza incluso los workflows correctamente configurados.

Cada cambio posterior en `main` ejecutará:

1. Descarga limpia del código.
2. Instalación reproducible con `npm ci`.
3. Lint, pruebas y compilación.
4. Comprobación de PostgreSQL y migraciones pendientes.
5. Creación de una versión aislada.
6. Recarga con PM2.
7. Comprobación de `/api/health` y restauración de la versión anterior si falla.

El pipeline copia el archivo privado dentro de cada versión como `.env.production.local` con permisos `600`. Next.js lo carga durante la compilación y la ejecución sin interpretar su contenido como comandos del shell.

## Inicializar usuarios de demostración

Después del primer despliegue correcto, crear el administrador universitario de forma interactiva en el servidor:

```bash
cd ~/apps/optica-stylo/current
npm run users:bootstrap-admin
```

Luego se puede crear la cuenta limitada del POS usando valores de prueba guardados únicamente en `~/optica-stylo.env`:

```bash
npm run users:create-sales
```

Los profesionales clínicos y demás datos demostrativos deben crearse desde la aplicación. No se deben copiar usuarios, recetas ni fichas clínicas reales desde Neon.

## Comprobar el despliegue

En GitHub, la ejecución debe finalizar correctamente. En el servidor:

```bash
pm2 list
pm2 logs optica-stylo --lines 100
curl --fail http://127.0.0.1:3000/api/health
nginx -t
```

La respuesta de salud debe informar `success=true` y `status=ok`. Las credenciales reales, imágenes de recetas y datos clínicos no deben utilizarse en esta comprobación.
