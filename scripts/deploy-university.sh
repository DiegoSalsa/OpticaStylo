#!/usr/bin/env bash

set -Eeuo pipefail

ruta_entorno="${1:-$HOME/optica-stylo.env}"
ruta_fuente="${GITHUB_WORKSPACE:-$(pwd)}"
ruta_aplicacion="$HOME/apps/optica-stylo"
ruta_versiones="$ruta_aplicacion/releases"
ruta_actual="$ruta_aplicacion/current"
version_despliegue="${GITHUB_SHA:-}"
ejecucion_despliegue="${GITHUB_RUN_ID:-}"
puerto="3000"

fallar() {
  echo "Error: $1" >&2
  exit 1
}

validar_comando() {
  command -v "$1" >/dev/null 2>&1 || fallar "Falta instalar el comando $1 en el servidor."
}

if [[ "$(id -u)" == "0" ]]; then
  fallar "El runner y la aplicación no deben ejecutarse como root."
fi

umask 077

if [[ ! -f "$ruta_entorno" ]]; then
  fallar "No existe el archivo de entorno $ruta_entorno."
fi

permisos_entorno="$(stat -c "%a" "$ruta_entorno")"
if (( (8#$permisos_entorno & 077) != 0 )); then
  fallar "El archivo de entorno debe permitir acceso únicamente a su propietario. Ejecuta chmod 600."
fi

for comando in node npm pm2 curl flock rsync stat realpath install; do
  validar_comando "$comando"
done

if [[ ! "$version_despliegue" =~ ^[0-9a-f]{40}$ ]]; then
  fallar "GITHUB_SHA no contiene una revisión válida para desplegar."
fi

if [[ ! "$ejecucion_despliegue" =~ ^[0-9]+$ ]]; then
  fallar "GITHUB_RUN_ID no contiene un identificador válido para desplegar."
fi

mkdir -p "$ruta_versiones"
ruta_version="$(realpath -m "$ruta_versiones/$version_despliegue-$ejecucion_despliegue")"
case "$ruta_version" in
  "$ruta_versiones"/*) ;;
  *) fallar "La ruta calculada para la versión no es segura." ;;
esac

exec 9>"$ruta_aplicacion/deploy.lock"
flock -n 9 || fallar "Ya existe otro despliegue universitario en ejecución."

if [[ -e "$ruta_version" ]]; then
  fallar "La ejecución $ejecucion_despliegue ya fue preparada anteriormente."
fi

mkdir -p "$ruta_version"
rsync -a \
  --exclude ".git" \
  --exclude ".next" \
  --exclude "node_modules" \
  --exclude ".env*" \
  --exclude "*.log" \
  --exclude "tmp" \
  "$ruta_fuente/" "$ruta_version/"

cd "$ruta_version"
npm ci
npm run lint
npm test
install -m 600 "$ruta_entorno" "$ruta_version/.env.production.local"
printf "\nDEPLOYMENT_VERSION=%s\n" "$version_despliegue" >> "$ruta_version/.env.production.local"
export NODE_ENV=production
export DEPLOYMENT_VERSION="$version_despliegue"
npm run db:check
npm run build
npm run db:migrate

ruta_anterior=""
if [[ -L "$ruta_actual" ]]; then
  ruta_anterior="$(realpath "$ruta_actual")"
fi

ln -sfn "$ruta_version" "$ruta_aplicacion/current.new"
mv -Tf "$ruta_aplicacion/current.new" "$ruta_actual"

if ! pm2 startOrReload "$ruta_actual/ecosystem.config.cjs" --update-env; then
  if [[ -n "$ruta_anterior" && -d "$ruta_anterior" ]]; then
    ln -sfn "$ruta_anterior" "$ruta_aplicacion/current.new"
    mv -Tf "$ruta_aplicacion/current.new" "$ruta_actual"
    pm2 startOrReload "$ruta_actual/ecosystem.config.cjs" --update-env || true
  fi
  fallar "PM2 no pudo iniciar la nueva versión."
fi

if ! curl --fail --silent --show-error \
  --retry 10 \
  --retry-delay 2 \
  --retry-connrefused \
  "http://127.0.0.1:$puerto/api/health" >/dev/null; then
  if [[ -n "$ruta_anterior" && -d "$ruta_anterior" ]]; then
    ln -sfn "$ruta_anterior" "$ruta_aplicacion/current.new"
    mv -Tf "$ruta_aplicacion/current.new" "$ruta_actual"
    pm2 startOrReload "$ruta_actual/ecosystem.config.cjs" --update-env || true
  else
    pm2 stop optica-stylo || true
  fi
  fallar "La comprobación de salud falló y se restauró la versión anterior cuando estaba disponible."
fi

pm2 save
echo "Despliegue universitario completado para la revisión $version_despliegue."
