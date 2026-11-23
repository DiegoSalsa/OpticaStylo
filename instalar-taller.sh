#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

stage='Comprobar herramientas'
fail() { printf 'ERROR [%s] %s\n' "$stage" "$*" >&2; exit 1; }
trap 'code=$?; printf "ERROR [%s] Código %s. Repite el mismo instalador para reanudar cuando se corrija la causa.\n" "$stage" "$code" >&2; exit "$code"' ERR

source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
base="$HOME/.local/share/opticastylo-taller"
slot=instalacion
if [[ "${1:-}" == --alternativa ]]; then
  slot=alternativa-offline
  shift
fi
installed="$base/$slot"
app="$installed/opticastylo-academico"
env_file="$app/.env.academico"
archive_name=opticastylo-imagenes-linux-amd64-20261130.tar.gz
source_name=opticastylo-fuentes-20261130.tar.gz

for tool in docker flock sha256sum; do
  command -v "$tool" >/dev/null || fail "Falta $tool en el servidor."
done
host=${DOCKER_HOST:-}
if [[ -n "${DOCKER_CONTEXT:-}" || -z "$host" ]]; then
  host=$(docker context inspect --format '{{(index .Endpoints "docker").Host}}') || fail 'Contexto Docker inválido. Ejecuta docker context ls.'
fi
[[ "$host" == unix:///* && -S "${host#unix://}" ]] || fail 'Selecciona el socket Unix del Docker Engine local.'
docker_id=$(docker info --format '{{.ID}}') || fail 'Docker no responde o faltan permisos. Ejecuta docker info con el mismo usuario.'
[[ -n "$docker_id" && "$docker_id" != '<no value>' ]] || fail 'No se pudo identificar el Docker Engine local.'
docker compose version >/dev/null || fail 'Falta el plugin Docker Compose. Ejecuta docker compose version.'

read_installation() {
  local -a state
  [[ -d "$installed" && ! -L "$installed" && -O "$installed" &&
     -f "$installed/estado" && ! -L "$installed/estado" &&
     -f "$env_file" && ! -L "$env_file" && -O "$env_file" ]] ||
    fail 'La ruta de instalación está ocupada por archivos ajenos o incompletos.'
  mapfile -t state < "$installed/estado"
  [[ ${#state[@]} -eq 6 && "${state[0]}" == stylo-taller-v1 &&
     "${state[1]}" =~ ^(sha256:[a-f0-9]{64}|git:[a-f0-9]{40,64})$ &&
     "${state[2]}" == "$docker_id" &&
     "${state[3]}" =~ ^opticastylo-taller-[a-f0-9]{12}$ &&
     "${state[4]}" =~ ^(con-internet|sin-internet)$ &&
     "${state[5]}" =~ ^[a-f0-9]{64}$ ]] || fail 'La instalación pertenece a otra edición o a otro Docker Engine.'
  local current_env
  current_env=$(sha256sum -- "$env_file")
  [[ "${current_env%% *}" == "${state[5]}" && "$(stat -c %a -- "$env_file")" == 600 ]] ||
    fail 'El archivo privado de entorno cambió. Conserva la configuración original de esta instalación.'
  stored_release=${state[1]}
  project=${state[3]}
  mode=${state[4]}
}

stage='Proteger la instalación'
mkdir -p -- "$base"
base_mode=$(stat -c %a -- "$base")
[[ -d "$base" && ! -L "$base" && -O "$base" && "$base_mode" =~ ^[0-7]{3,4}$ ]] &&
  (( (8#$base_mode & 0777) == 0700 )) ||
  fail "La ruta $base debe pertenecer a este usuario y tener permisos 0700."
[[ ! -L "$base/.lock" ]] || fail 'Archivo de bloqueo inesperado.'
exec 9>> "$base/.lock"
flock -n 9 || fail 'Hay otro instalador ejecutándose para este usuario.'

if [[ "${1:-}" == estado ]]; then
  [[ $# -eq 1 ]] || fail 'Usa estado sin argumentos adicionales.'
  read_installation
  printf 'Proyecto: %s (%s)\n' "$project" "$mode"
  docker ps -a --filter "label=com.docker.compose.project=$project" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
  exit 0
fi

if [[ "${1:-}" == credenciales ]]; then
  stage='Consultar la credencial solicitada'
  [[ $# -le 2 ]] || fail 'Usa credenciales [admin|profesional].'
  role=${2:-admin}
  [[ "$role" == admin || "$role" == profesional ]] || fail 'Cuenta de demostración desconocida.'
  read_installation
  cd -- "$app"
  unset ACADEMIC_BIND_IP ACADEMIC_PORT ACADEMIC_PUBLIC_URL ACADEMIC_ALLOW_HTTP \
    ACADEMIC_DB_USER ACADEMIC_DB_NAME ACADEMIC_DB_PASSWORD COMPOSE_PROFILES COMPOSE_REMOVE_ORPHANS
  if [[ "$mode" == sin-internet ]]; then
    STYLO_WEB_IMAGE=$(awk '$1=="web" {print $2}' IMAGENES-AMD64.txt)
    STYLO_DB_IMAGE=$(awk '$1=="db" {print $2}' IMAGENES-AMD64.txt)
  else
    STYLO_WEB_IMAGE="$project-web:entrega-20261130"
    STYLO_DB_IMAGE='postgres:18-bookworm@sha256:ece55f7868da684e400f82f1030a050718adbdd65c23aa500c486f6e2950dc0f'
  fi
  export STYLO_WEB_IMAGE STYLO_DB_IMAGE
  docker compose --profile inicializacion -p "$project" -f compose.academico.yaml -f compose.entrega.yaml --env-file .env.academico \
    run --rm --no-deps --interactive=false -T --pull never --entrypoint cat init "/var/lib/stylo-private/$role-password"
  printf '\n'
  exit 0
fi
[[ $# -eq 0 ]] || fail 'Usa [--alternativa] sin argumentos, estado o credenciales [admin|profesional].'

stage='Verificar la edición'
archive="$source_dir/$archive_name"
packed=false
if [[ -e "$source_dir/MANIFIESTO-PAQUETE.sha256" || -e "$source_dir/$source_name" || -e "$archive" ]]; then
  packed=true
  (
    cd -- "$source_dir"
    sha256sum --strict --check --quiet MANIFIESTO-PAQUETE.sha256
  )
  release=$(sha256sum -- "$source_dir/MANIFIESTO-PAQUETE.sha256")
  release="sha256:${release%% *}"
else
  command -v git >/dev/null || fail 'Falta Git para preparar la edición del repositorio.'
  release="git:$(git -C "$source_dir" rev-parse --verify HEAD)"
fi

if [[ "$slot" == alternativa-offline ]] && ! $packed; then
  fail 'Para --alternativa ejecuta instalar.sh de un paquete offline verificado.'
fi

stage='Preparar la instalación académica'
for tool in curl ip ss tar; do
  command -v "$tool" >/dev/null || fail "Falta $tool en el servidor."
done
arch=$(docker info --format '{{.OSType}}/{{.Architecture}}')
case "$arch" in
  linux/x86_64|linux/amd64|linux/aarch64|linux/arm64) ;;
  *) fail "Arquitectura incompatible: $arch. Usa un motor Linux AMD64 o ARM64." ;;
esac
resume=()
if [[ -e "$installed" || -L "$installed" ]]; then
  read_installation
  if [[ "$stored_release" != "$release" ]]; then
    if $packed && [[ "$slot" == instalacion ]]; then
      fail 'Otra edición ocupa la instalación principal. Ejecuta bash instalar.sh --alternativa desde la extracción para crear otro proyecto con volúmenes propios.'
    fi
    fail 'Otra edición ocupa esta ruta. Conserva los volúmenes y usa la edición original.'
  fi
  resume=(--reanudar)
  printf 'Reanudando el proyecto %s con la configuración guardada.\n' "$project"
else
  mode=con-internet
  if $packed; then
    case "$arch" in
      linux/x86_64|linux/amd64) mode=sin-internet ;;
      *) [[ "$slot" != alternativa-offline ]] || fail "La alternativa offline requiere Linux AMD64. Motor actual: $arch."
         printf 'Las imágenes requieren AMD64. ¿Autorizar la compilación con internet en %s? [s/N] ' "$arch"
         read -r answer
         [[ "$answer" == s || "$answer" == S ]] || fail 'Compilación cancelada.' ;;
    esac
  fi

  stage='Elegir IP, puerto y origen'
  read -r _ _ detected _ <<< "${SSH_CONNECTION:-}"
  detected=${detected:-127.0.0.1}
  addresses=$(ip -o addr show | awk '$3 == "inet" || $3 == "inet6" { sub(/\/.*/, "", $4); print $4 }')
  if ! grep -Fxq -- "$detected" <<< "$addresses"; then detected=127.0.0.1; fi
  suggested_port=3000
  for candidate in 3000 8080 3001 8081; do
    if [[ -z "$(ss -H -ltn "sport = :$candidate")" ]]; then suggested_port=$candidate; break; fi
  done

  printf 'IP local de escucha [%s] ' "$detected"
  read -r bind_ip
  bind_ip=${bind_ip:-$detected}
  grep -Fxq -- "$bind_ip" <<< "$addresses" || fail 'Selecciona una IP asignada a una interfaz local del servidor.'
  printf 'Puerto de la aplicación [%s] ' "$suggested_port"
  read -r port
  port=${port:-$suggested_port}
  [[ "$port" =~ ^[1-9][0-9]{0,4}$ ]] && ((port <= 65535)) || fail 'El puerto debe estar entre 1 y 65535.'
  [[ -z "$(ss -H -ltn "sport = :$port")" ]] || fail "El puerto $port ya está ocupado."

  url_host=$bind_ip
  if [[ "$url_host" == *:* ]]; then url_host="[$url_host]"; fi
  suggested_url="http://$url_host:$port"
  printf 'Origen de acceso (HTTPS si ya hay proxy TLS) [%s] ' "$suggested_url"
  read -r public_url
  public_url=${public_url:-$suggested_url}
  [[ "$public_url" =~ ^https?://(\[[[:xdigit:]:]+\]|[a-zA-Z0-9.-]+)(:[0-9]+)?$ ]] ||
    fail 'Indica el origen HTTP o HTTPS exacto, sin ruta ni barra final.'
  allow_http=true
  if [[ "$public_url" == https://* ]]; then allow_http=false; fi

  stage='Guardar configuración privada'
  project="opticastylo-taller-$(od -An -N6 -tx1 /dev/urandom | tr -d '[:space:]')"
  draft=$(mktemp -d "$base/.nueva.XXXXXX")
  draft_app="$draft/opticastylo-academico"
  if $packed; then
    (umask 022; tar -xzf "$source_dir/$source_name" -C "$draft")
    (cd -- "$draft_app" && sha256sum --strict --check --quiet MANIFIESTO.sha256)
  else
    mkdir -- "$draft_app"
    git -c tar.umask=0022 -C "$source_dir" archive "${release#git:}" |
      (umask 022; tar -xf - -C "$draft_app")
    cp -- "$draft_app/scripts/docker/desplegar-academico.sh" "$draft_app/desplegar-academico.sh"
  fi
  bash "$draft_app/desplegar-academico.sh" preparar
  sed -i \
    -e "s|^ACADEMIC_BIND_IP=.*|ACADEMIC_BIND_IP=$bind_ip|" \
    -e "s|^ACADEMIC_PORT=.*|ACADEMIC_PORT=$port|" \
    -e "s|^ACADEMIC_PUBLIC_URL=.*|ACADEMIC_PUBLIC_URL=$public_url|" \
    -e "s|^ACADEMIC_ALLOW_HTTP=.*|ACADEMIC_ALLOW_HTTP=$allow_http|" "$draft_app/.env.academico"
  chmod 600 "$draft_app/.env.academico"
  env_hash=$(sha256sum -- "$draft_app/.env.academico")
  printf '%s\n' stylo-taller-v1 "$release" "$docker_id" "$project" "$mode" "${env_hash%% *}" > "$draft/estado"
  cp -- "${BASH_SOURCE[0]}" "$draft/instalar.sh"
  mv -T -- "$draft" "$installed"
fi

stage='Desplegar y verificar'
if [[ "$mode" == sin-internet ]]; then
  bash "$app/desplegar-academico.sh" "${resume[@]}" "$mode" "$project" "$archive"
else
  bash "$app/desplegar-academico.sh" "${resume[@]}" "$mode" "$project"
fi

printf '\nCuenta administrativa: admin-demo@example.invalid\n'
printf 'Cuenta clínica: profesional-demo@example.invalid\n'
printf 'En una terminal privada, consulta la contraseña elegida con:\n'
credential_flag=''
if [[ "$slot" == alternativa-offline ]]; then credential_flag='--alternativa '; fi
printf '  bash %q ' "$installed/instalar.sh"
printf '%s' "${credential_args[@]/%/ }"
printf 'credenciales admin
'
printf 'Estado del proyecto: bash %q ' "$installed/instalar.sh"
printf '%s' "${credential_args[@]/%/ }"
printf 'estado
'
