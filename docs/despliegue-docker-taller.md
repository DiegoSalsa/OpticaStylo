# Despliegue Docker para Taller de Desarrollo

## Desde GitHub

En un servidor Linux con acceso a internet, Docker Engine local y Compose con las
opciones `--wait` y `--pull`, ejecuta:

```bash
git clone https://github.com/DiegoSalsa/OpticaStylo.git
cd OpticaStylo
bash instalar-taller.sh
```

El servidor necesita el permiso habitual para usar su socket Docker local,
Git, Bash, curl, tar, iproute2, sha256sum y flock. Pide al administrador los
prerrequisitos que falten. Para compilar se necesita acceso a Docker Hub, npm y
los repositorios Debian de la imagen Node.

Durante la primera ejecución el instalador propone la IP del lado Linux de SSH,
un puerto libre entre 3000, 8080, 3001 y 8081, y el origen HTTP correspondiente.
Usa la IP de la interfaz autorizada del aula y el origen exacto que abrirá el
navegador. Para HTTPS escribe el origen del proxy TLS existente. Next.js escucha
HTTP y el proxy termina TLS. Los valores se guardan con una contraseña aleatoria
en un archivo privado, con permisos 0600 en Linux.

Al finalizar, el instalador muestra la URL y el comando para consultar la clave
de cada cuenta demo desde una terminal privada. `/api/health` debe responder HTTP
200 con `data.database` igual a `ok`. La cuenta de administración es
`admin-demo@example.invalid`.

## Paquete transportable

La entrega `stylo-taller.tar.gz` incluye las fuentes, las dos imágenes Linux
AMD64 y sus manifiestos. Comprueba su SHA-256 de entrega antes de extraerlo.
Luego ejecuta `bash instalar.sh` desde la extracción. La misma edición verifica
su manifiesto interno antes de instalar. En otra arquitectura, el instalador
pide permiso explícito y verifica la conectividad antes de construir desde las
fuentes incluidas.

`registrar-imagenes.mjs` genera el SHA-256 del tar y extrae el digest de
configuración, el manifiesto y el descriptor OCI por etiqueta. El almacén clásico
y containerd pueden mostrar un ID distinto para los mismos bytes. Cada valor
aceptado está vinculado a su etiqueta y a Linux AMD64. La instalación offline
usa imágenes verificadas y Compose con `--pull never` y `--no-build`.

## Reanudar y diagnosticar

Repite el mismo comando de instalación con el mismo usuario y edición. El
instalador conserva el directorio privado, el nombre del proyecto y sus
credenciales. El inicializador vuelve a comprobar las migraciones y solo carga
los datos de demostración en la primera inicialización. Los volúmenes con
nombre se reutilizan y Compose conserva los contenedores existentes que
pertenezcan al proyecto.

El directorio `~/.local/share/opticastylo-taller/instalacion` registra la edición,
el motor y el proyecto. Una edición distinta o un motor distinto requieren
otro entorno de instalación. Usa el nombre que muestra el instalador para
consultar el estado o los logs:

```bash
docker ps -a --filter label=com.docker.compose.project=PROYECTO
docker logs --tail 80 PROYECTO-db-1
docker logs --tail 80 PROYECTO-web-1
```

Ante un error de conexión comprueba la IP, el puerto y los permisos del socket.
Si el navegador no alcanza la aplicación, comprueba la ruta y el firewall con
el administrador del servidor. Si Prisma detiene una migración, conserva el
volumen y diagnostica el error antes de reintentar.

Compose separa la web y PostgreSQL en redes diferentes del resto de proyectos.
PostgreSQL se comunica con Next.js por la red privada y conserva su volumen
aunque se vuelva a iniciar el proyecto. El entorno usa datos sintéticos y las
integraciones comerciales quedan deshabilitadas.
