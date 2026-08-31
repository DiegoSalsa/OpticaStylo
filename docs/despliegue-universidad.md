# Despliegue automatizado en el servidor universitario

Este despliegue convive con producción sin compartir infraestructura:

- Vercel continúa desplegando `main` mediante su integración y utiliza Neon.
- El servidor universitario utiliza un runner propio, PM2, Nginx y su archivo de entorno privado.
- La base universitaria puede ser otra instancia PostgreSQL. Nunca debe reutilizar datos clínicos reales para demostraciones.

## Requisitos que deben solicitarse

La aplicación requiere:

- Ubuntu 20.04 o Debian 11.
- PostgreSQL 13.7 o una versión posterior compatible.
- Puertos 22, 80 y 443 habilitados.
- Acceso SSH con un usuario sin privilegios permanentes de root.
- Al menos 2 GB de memoria; 4 GB son recomendables para compilar Next.js en el mismo servidor.

No se puede completar la activación hasta recibir del laboratorio la IP, el usuario SSH, el host y las credenciales de PostgreSQL, además de confirmar si la base ofrece TLS con un certificado verificable.

## Preparar el servidor

Conectarse usando los datos entregados por la universidad:

```bash
ssh <usuario>@<ip> -p 22
```

Actualizar el sistema e instalar las herramientas necesarias:

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y ca-certificates curl nginx rsync
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 22
nvm use 22
npm install --global pm2@latest
mkdir -p ~/apps/optica-stylo/releases
```

Configurar PM2 para recuperar los procesos guardados después de reiniciar el servidor:

```bash
pm2 startup
```

El comando mostrará una instrucción con `sudo`. Ejecutar exactamente esa instrucción una sola vez. El pipeline ejecutará `pm2 save` después de cada despliegue correcto.

## Crear el archivo de entorno

Copiar `config/universidad.env.example` al servidor como `~/optica-stylo.env`, completar únicamente allí los valores reales y protegerlo:

```bash
chmod 600 ~/optica-stylo.env
```

El archivo no se copia al repositorio ni se guarda en GitHub. `DATABASE_SSL=true` es obligatorio. Si PostgreSQL universitario no ofrece TLS verificable, se debe solicitarlo al laboratorio o utilizar temporalmente una base de pruebas compatible; no se deshabilitará la verificación para ocultar el problema.

## Configurar Nginx

La aplicación escucha solo en `127.0.0.1:3000`. Nginx recibe el tráfico público en el puerto 80:

```bash
sudo cp deploy/nginx-optica-stylo.conf /etc/nginx/sites-available/optica-stylo
if [ -L /etc/nginx/sites-enabled/default ]; then sudo unlink /etc/nginx/sites-enabled/default; fi
sudo ln -s /etc/nginx/sites-available/optica-stylo /etc/nginx/sites-enabled/optica-stylo
sudo nginx -t
sudo systemctl reload nginx
```

El inicio por HTTP permite corroborar la instalación, pero las sesiones usan cookies seguras en producción. Antes de probar autenticación, recuperación de contraseñas, pagos o datos clínicos se necesita HTTPS. Cuando se conozca la IP se puede utilizar un subdominio institucional o un nombre gratuito basado en IP, y emitir un certificado gratuito. No se debe desactivar la seguridad de las cookies.

## Instalar el runner de GitHub

En GitHub abrir `Settings > Actions > Runners > New self-hosted runner`, elegir Linux x64 y ejecutar en el servidor los comandos que GitHub muestre. El token de registro es temporal y no debe copiarse al repositorio ni a documentación.

Durante `config.sh`, agregar la etiqueta personalizada:

```text
opticastylo-universidad
```

Instalar el runner como servicio del sistema en lugar de dejarlo ligado a una terminal:

```bash
cd ~/actions-runner
sudo ./svc.sh install
sudo ./svc.sh start
sudo ./svc.sh status
```

El runner debe pertenecer al usuario de despliegue y nunca ejecutarse como root.

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
systemctl status nginx
```

La respuesta de salud debe informar `success=true` y `status=ok`. Las credenciales reales, imágenes de recetas y datos clínicos no deben utilizarse en esta comprobación.
