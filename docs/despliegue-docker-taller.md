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
un puerto TCP libre y el origen HTTP correspondiente. Prueba 3000, 8080, 3001 y
8081, seguido del rango 18000–18199. Si se agotan esas opciones, pide otro puerto
autorizado o permite cancelar. Un servicio que ocupe el
puerto después de la comprobación puede impedir el arranque de Next.js.
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

Consulta la [guía de emergencia](guia-emergencia-taller.md) para ver los diagnósticos y el respaldo aislado.

Repite el mismo comando de instalación con el mismo usuario y edición. El
instalador conserva el directorio privado, el nombre del proyecto y sus
credenciales. Docker mantiene el inicializador en segundo plano si se corta SSH.
El reintento recupera su resultado, comprueba el historial de Prisma y conserva
los contenedores y volúmenes del proyecto. Si la instalación principal dejó de
ser utilizable, el paquete permite ejecutar `bash instalar.sh --alternativa` con
un puerto libre y volúmenes nuevos. Sus datos parten de la demostración sintética.

Bajo `~/.local/share/opticastylo-taller/` se guarda un directorio privado por
edición, identificado por el commit de Git o el SHA-256 del manifiesto offline.
Una edición conserva su ruta, puerto y volúmenes al reintentar. Las instalaciones
anteriores en `instalacion` o `alternativa-offline` se reutilizan cuando coincide
la edición y conservan sus archivos al instalar otra versión. Cada edición
mantiene su propio proyecto Compose, redes y volúmenes.

Para compilar, el motor debe reportar al menos 2 GiB de memoria y Linux debe
tener al menos 1 GiB disponible cuando reporta ese dato. El instalador
comprueba el espacio para preparar las fuentes y, cuando es accesible, el espacio
libre en el almacén de Docker. Si la ruta del motor requiere permisos especiales,
pide al administrador que compruebe su partición. El instalador funciona con un
usuario normal autorizado a usar el socket.

Usa el nombre que muestra el instalador para consultar el estado o los logs:

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
