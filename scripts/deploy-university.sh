#!/usr/bin/env bash

# Activar modo estricto para detener el despliegue ante errores, variables inexistentes o fallos en pipelines
set -Eeuo pipefail

# Resolver las rutas, identificadores y puerto que definen el despliegue inmutable
ruta_entorno="${1:-$HOME/optica-stylo.env}"
ruta_fuente="${GITHUB_WORKSPACE:-$(pwd)}"
ruta_aplicacion="$HOME/apps/optica-stylo"
ruta_versiones="$ruta_aplicacion/releases"
ruta_actual="$ruta_aplicacion/current"
version_despliegue="${GITHUB_SHA:-}"
ejecucion_despliegue="${GITHUB_RUN_ID:-}"
puerto="3000"

# Informar un error de despliegue y terminar sin continuar con un estado incompleto
fallar() {
  echo "Error: $1" >&2
  exit 1
}

# Comprobar que una herramienta requerida esté instalada antes de comenzar
validar_comando() {
  command -v "$1" >/dev/null 2>&1 || fallar "Falta instalar el comando $1 en el servidor."
}

# Impedir que el runner o la aplicación se ejecuten con privilegios de root
if [[ "$(id -u)" == "0" ]]; then
  fallar "El runner y la aplicación no deben ejecutarse como root."
fi

# Restringir los permisos por defecto de los archivos creados durante el despliegue
umask 077

# Exigir que exista el archivo de secretos proporcionado por el servidor
if [[ ! -f "$ruta_entorno" ]]; then
  fallar "No existe el archivo de entorno $ruta_entorno."
fi

# Asegurar que la configuración sensible solo pueda ser leída por su propietario
permisos_entorno="$(stat -c "%a" "$ruta_entorno")"
if (( (8#$permisos_entorno & 077) != 0 )); then
  fallar "El archivo de entorno debe permitir acceso únicamente a su propietario. Ejecuta chmod 600."
fi

# Verificar todas las herramientas necesarias para preparar, publicar y supervisar la versión
for comando in node npm pm2 curl flock rsync stat realpath install; do
  validar_comando "$comando"
done

# Exigir la versión mayor de npm que garantiza instalaciones reproducibles con package-lock.json
version_npm="$(npm --version)"
version_npm_mayor="${version_npm%%.*}"
if (( version_npm_mayor < 11 )); then
  fallar "Se requiere npm 11.6.2 o posterior para respetar el archivo de bloqueo."
fi

# Validar que el despliegue provenga de un commit SHA completo de GitHub Actions
if [[ ! "$version_despliegue" =~ ^[0-9a-f]{40}$ ]]; then
  fallar "GITHUB_SHA no contiene una revisión válida para desplegar."
fi

# Validar el identificador numérico de la ejecución para evitar colisiones entre releases
if [[ ! "$ejecucion_despliegue" =~ ^[0-9]+$ ]]; then
  fallar "GITHUB_RUN_ID no contiene un identificador válido para desplegar."
fi

# Preparar el directorio de releases y verificar que la ruta calculada quede dentro del destino permitido
mkdir -p "$ruta_versiones"
ruta_version="$(realpath -m "$ruta_versiones/$version_despliegue-$ejecucion_despliegue")"
case "$ruta_version" in
  "$ruta_versiones"/*) ;;
  *) fallar "La ruta calculada para la versión no es segura." ;;
esac

# Evitar dos despliegues simultáneos sobre la misma instalación
exec 9>"$ruta_aplicacion/deploy.lock"
flock -n 9 || fallar "Ya existe otro despliegue universitario en ejecución."

# Rechazar una release ya existente para mantener la operación idempotente
if [[ -e "$ruta_version" ]]; then
  fallar "La ejecución $ejecucion_despliegue ya fue preparada anteriormente."
fi

# Crear el directorio aislado donde se preparará la nueva versión
mkdir -p "$ruta_version"
# Copiar únicamente los artefactos necesarios, excluyendo secretos, dependencias y archivos temporales
rsync -a \
  --exclude ".git" \
  --exclude ".next" \
  --exclude "node_modules" \
  --include ".env.example" \
  --exclude ".env*" \
  --exclude "*.log" \
  --exclude "tmp" \
  "$ruta_fuente/" "$ruta_version/"

cd "$ruta_version"
# Instalar exactamente las dependencias registradas y generar el cliente de Prisma
npm ci
npm run prisma:generate
install -m 600 "$ruta_entorno" "$ruta_version/.env.production.local"
printf "\nDEPLOYMENT_VERSION=%s\n" "$version_despliegue" >> "$ruta_version/.env.production.local"
# Ejecutar las validaciones de calidad antes de publicar la release
export NODE_ENV=production
export DEPLOYMENT_ENVIRONMENT=university
export DEPLOYMENT_VERSION="$version_despliegue"
# Construir la aplicación y comprobar la conexión antes de ejecutar migraciones
npm run prisma:validate
npm run lint
npm test
npm run db:check
npm run build

# Aplicar migraciones; si la base existente requiere baseline, registrarlo y reintentar de forma explícita
ruta_log_migracion="$(mktemp)"
if ! npm run db:migrate 2>&1 | tee "$ruta_log_migracion"; then
  if grep -q "P3005" "$ruta_log_migracion"; then
    echo "Base existente detectada; validando y registrando el baseline de Prisma."
    npm run db:baseline
    npm run db:migrate
  else
    rm -f "$ruta_log_migracion"
    fallar "Prisma Migrate no pudo actualizar la base de datos."
  fi
fi
rm -f "$ruta_log_migracion"

# Conservar la release activa para poder restaurarla si el arranque o el health check fallan
ruta_anterior=""
if [[ -L "$ruta_actual" ]]; then
  ruta_anterior="$(realpath "$ruta_actual")"
fi

# Cambiar el enlace current de forma atómica para que los lectores nunca vean una ruta parcial
ln -sfn "$ruta_version" "$ruta_aplicacion/current.new"
mv -Tf "$ruta_aplicacion/current.new" "$ruta_actual"

# Recargar PM2 con la configuración de la release recién activada
if ! pm2 startOrReload "$ruta_actual/deploy/ecosystem.config.cjs" --update-env; then
  if [[ -n "$ruta_anterior" && -d "$ruta_anterior" ]]; then
    ln -sfn "$ruta_anterior" "$ruta_aplicacion/current.new"
    mv -Tf "$ruta_aplicacion/current.new" "$ruta_actual"
    pm2 startOrReload "$ruta_actual/deploy/ecosystem.config.cjs" --update-env || true
  fi
  fallar "PM2 no pudo iniciar la nueva versión."
fi

# Confirmar que la aplicación responde por HTTP antes de considerar exitoso el despliegue
if ! curl --fail --silent --show-error \
  --retry 10 \
  --retry-delay 2 \
  --retry-connrefused \
  "http://127.0.0.1:$puerto/api/health" >/dev/null; then
  if [[ -n "$ruta_anterior" && -d "$ruta_anterior" ]]; then
    ln -sfn "$ruta_anterior" "$ruta_aplicacion/current.new"
    mv -Tf "$ruta_aplicacion/current.new" "$ruta_actual"
    pm2 startOrReload "$ruta_actual/deploy/ecosystem.config.cjs" --update-env || true
  else
    pm2 stop optica-stylo || true
  fi
  fallar "La comprobación de salud falló y se restauró la versión anterior cuando estaba disponible."
fi

# Persistir la configuración de procesos y anunciar la revisión desplegada
pm2 save
echo "Despliegue universitario completado para la revisión $version_despliegue."
