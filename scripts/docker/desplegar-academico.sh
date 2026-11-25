#!/usr/bin/env bash
set -Eeuo pipefail
stage=argumentos
trap 'rc=$?; printf "ERROR [%s] Código de salida %s.\n" "$stage" "$rc" >&2; exit "$rc"' ERR
fail() { printf 'ERROR [%s] %s\n' "$stage" "$*" >&2; exit 1; }
step() { stage=$1; printf '\n== %s ==\n' "$stage"; }

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
resume=false
if [[ "${1:-}" == --reanudar ]]; then
  resume=true
  shift
fi
mode=${1:-}
env_file=.env.academico
if [[ "$mode" == preparar && $# == 1 ]]; then
  step 'Crear entorno privado'
  [[ ! -e "$env_file" && ! -L "$env_file" ]] || fail 'El entorno ya existe. Revísalo antes de reutilizarlo.'
  password=$(od -An -N24 -tx1 /dev/urandom | tr -d '[:space:]')
  [[ "$password" =~ ^[a-f0-9]{48}$ ]] || fail 'No se pudo generar la contraseña.'
  (
    umask 077
    set -C
    {
      sed '/^ACADEMIC_DB_PASSWORD=/d' config/academico.env.example
      printf 'ACADEMIC_DB_PASSWORD=%s\n' "$password"
    } > "$env_file"
  )
  printf 'Creado %s. Configura la IP, el puerto y el origen antes de iniciar.\n' "$env_file"
  exit 0
fi

if ! { [[ "$mode" == con-internet && $# == 2 ]] || [[ "$mode" == sin-internet && $# == 3 ]]; }; then
  printf '%s\n' 'Uso:' \
    '  bash desplegar-academico.sh preparar' \
    '  bash desplegar-academico.sh [--reanudar] con-internet PROYECTO' \
    '  bash desplegar-academico.sh [--reanudar] sin-internet PROYECTO RUTA_A_IMAGENES.tar.gz' >&2
  exit 2
fi
project=$2
[[ "$project" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || fail 'Usa un nombre de proyecto Compose válido y exclusivo.'
[[ "$project" != opticastylo-demo && "$project" != opticastylo-academico ]] || fail 'Elige un nombre propio para la entrega.'

step 'Motor, Compose y recursos'
command -v docker >/dev/null || fail 'Falta Docker Engine y su CLI.'
command -v curl >/dev/null || fail 'Falta curl para verificar la salud desde el host.'
docker version --format 'Docker Engine {{.Server.Version}}' || fail 'Revisa el motor y los permisos con docker info.'
docker compose version
up_help=$(docker compose up --help)
[[ "$up_help" == *--wait-timeout* && "$up_help" == *--pull* ]] || fail 'Actualiza el plugin Docker Compose.'
engine=$(docker info --format '{{.OSType}}/{{.Architecture}}')
case "$engine" in
  linux/x86_64|linux/amd64) platform=linux/amd64 ;;
  linux/aarch64|linux/arm64) platform=linux/arm64 ;;
  *) fail "Arquitectura incompatible: $engine. Usa Docker Engine Linux AMD64 o ARM64." ;;
esac
docker info --format 'CPU del motor: {{.NCPU}} | Memoria del motor en bytes: {{.MemTotal}}'
docker_root=$(docker info --format '{{.DockerRootDir}}')
printf 'Plataforma del motor: %s\n' "$platform"
printf 'Almacén de Docker: %s\n' "$docker_root"

step 'Variables y puerto'
[[ -f "$env_file" && -r "$env_file" ]] || fail 'Ejecuta preparar y completa el archivo privado.'
setting() {
  awk -v key="$1" 'index($0,key "=")==1 { sub(/\r$/, ""); value=substr($0,length(key)+2) } END { print value }' "$env_file"
}
# Preferir las asignaciones NOMBRE=valor del archivo privado a las del shell.
unset ACADEMIC_BIND_IP ACADEMIC_PORT ACADEMIC_PUBLIC_URL ACADEMIC_ALLOW_HTTP \
  ACADEMIC_DB_USER ACADEMIC_DB_NAME ACADEMIC_DB_PASSWORD COMPOSE_PROFILES \
  COMPOSE_COMPATIBILITY COMPOSE_REMOVE_ORPHANS
bind_ip=$(setting ACADEMIC_BIND_IP)
port=$(setting ACADEMIC_PORT)
public_url=$(setting ACADEMIC_PUBLIC_URL)
allow_http=$(setting ACADEMIC_ALLOW_HTTP)
db_user=$(setting ACADEMIC_DB_USER)
db_name=$(setting ACADEMIC_DB_NAME)
db_password=$(setting ACADEMIC_DB_PASSWORD)
bind_ip=${bind_ip:-127.0.0.1}
port=${port:-3000}
allow_http=${allow_http:-false}
db_user=${db_user:-stylo_academico}
db_name=${db_name:-opticastylo_academico}

[[ "$port" =~ ^[1-9][0-9]{0,4}$ ]] && (( port <= 65535 )) || fail 'Indica un puerto entre 1 y 65535.'
[[ "$db_user" =~ ^[a-z_][a-z0-9_]{0,62}$ && "$db_name" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] ||
  fail 'Los nombres de usuario y base deben usar letras minúsculas, números y guiones bajos.'
case "$db_name" in postgres|template0|template1) fail 'Elige una base académica propia.' ;; esac
[[ "$db_password" =~ ^[a-zA-Z0-9._~-]+$ ]] && ((${#db_password} >= 24)) ||
  fail 'Genera una contraseña exclusiva de al menos 24 caracteres válidos en URL.'
unset db_password
[[ "$public_url" =~ ^https?://(\[[[:xdigit:]:]+\]|[a-zA-Z0-9.-]+)(:[0-9]+)?$ ]] ||
  fail 'ACADEMIC_PUBLIC_URL debe ser el origen del navegador, con esquema y puerto si corresponde, sin ruta.'
case "$public_url $allow_http" in
  http://*\ true|https://*\ false) ;;
  *) fail 'Para HTTP local o restringido usa ACADEMIC_ALLOW_HTTP=true. Con HTTPS usa false.' ;;
esac
case "$bind_ip" in
  0.0.0.0) probe_host=127.0.0.1 ;;
  ::) probe_host=::1 ;;
  *) probe_host=$bind_ip ;;
esac
if [[ "$probe_host" == *:* ]]; then probe_url="http://[$probe_host]:$port"; else probe_url="http://$probe_host:$port"; fi
step 'Verificar que los recursos pertenecen a esta instalación'
existing_containers=$(docker ps -aq --filter "label=com.docker.compose.project=$project")
for container in $existing_containers; do
  working_dir=$(docker container inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$container")
  $resume && [[ "$working_dir" == "$PWD" ]] ||
    fail "El proyecto $project ya contiene un contenedor ajeno a esta instalación: $container."
done
web_running=false
for service in db web; do
  name="$project-$service-1"
  if owner=$(docker container inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{.State.Running}}' "$name" 2>/dev/null); then
    $resume && [[ "$owner" == "$PWD|$project|$service|"* ]] ||
      fail "Ya existe el contenedor $name fuera del contexto de reanudación."
    if [[ "$service" == web && "$owner" == *'|true' ]]; then web_running=true; fi
  fi
done
for resource in network:database network:browser volume:postgres-data volume:demo-credentials; do
  kind=${resource%%:*}
  name=${resource#*:}
  template='{{index .Labels "com.docker.compose.project"}}|{{index .Labels "com.docker.compose.'
  template+="$kind\"}}"
  if owner=$(docker "$kind" inspect --format "$template" "${project}_$name" 2>/dev/null); then
    $resume && [[ "$owner" == "$project|$name" ]] ||
      fail "Ya existe un recurso incompatible: ${project}_$name."
  fi
done

step 'Verificar puerto de la aplicación'
if [[ "$bind_ip" != 0.0.0.0 && "$bind_ip" != :: ]] && command -v ip >/dev/null; then
  addresses=$(ip -o addr show | awk '$3=="inet" || $3=="inet6" {split($4, parts, "/"); print parts[1]}')
  grep -Fxq -- "$bind_ip" <<< "$addresses" || fail "La IP $bind_ip ya no está asignada. Ejecuta ip -br addr y recupera la interfaz original."
fi
if $web_running; then
  published=$(docker port "$project-web-1" 3000/tcp)
  expected_host=$bind_ip
  if [[ "$bind_ip" == *:* ]]; then expected_host="[$bind_ip]"; fi
  [[ "$published" == "$expected_host:$port" ]] || fail 'El contenedor existente publica en otra dirección o puerto.'
elif command -v ss >/dev/null; then
  listeners=$(ss -H -lnt "sport = :$port")
  if awk -v host="$bind_ip" -v port="$port" '
    $4 == host ":" port || $4 == "[" host "]:" port || $4 == "*:" port ||
    $4 == "0.0.0.0:" port || $4 == "[::]:" port ||
    (NF && (host == "0.0.0.0" || host == "::")) { found=1 }
    END { exit(found ? 0 : 1) }
  ' <<< "$listeners"; then
    fail "El puerto $port ya está ocupado en una interfaz compatible."
  fi
elif command -v timeout >/dev/null &&
   timeout 2 bash -c 'exec 3<>"/dev/tcp/$1/$2"' _ "$probe_host" "$port" 2>/dev/null; then
  fail "Ya hay un servicio escuchando en $probe_host:$port."
fi
printf 'Publicación solicitada: %s:%s. Docker confirmará el enlace al arrancar.\n' "$bind_ip" "$port"

read_offline_metadata() {
  local manifest=IMAGENES-AMD64.txt schema key arch extra
  local hex='^[a-f0-9]{64}$' digest='^sha256:[a-f0-9]{64}$'
  local tag='^[a-z0-9][a-z0-9._/:-]*:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$'
  local -a rows

  [[ -r "$manifest" ]] || fail "Falta $manifest en el paquete fuente."
  mapfile -t rows < "$manifest"
  [[ ${#rows[@]} -eq 3 ]] || fail "Formato inválido en $manifest."
  read -r schema archive_sha extra <<< "${rows[0]}"
  [[ "$schema" == stylo-image-archive-v1 && "$archive_sha" =~ $hex && -z "$extra" ]] ||
    fail "Encabezado inválido en $manifest."

  read -r key STYLO_WEB_IMAGE arch web_config web_manifest web_target extra <<< "${rows[1]}"
  [[ "$key" == web && "$STYLO_WEB_IMAGE" =~ $tag && "$arch" == linux/amd64 && -z "$extra" &&
     "$web_config" =~ $digest && "$web_manifest" =~ $digest && "$web_target" =~ $digest ]] ||
    fail "Entrada web inválida en $manifest."
  read -r key STYLO_DB_IMAGE arch db_config db_manifest db_target extra <<< "${rows[2]}"
  [[ "$key" == db && "$STYLO_DB_IMAGE" =~ $tag && "$arch" == linux/amd64 && -z "$extra" &&
     "$db_config" =~ $digest && "$db_manifest" =~ $digest && "$db_target" =~ $digest &&
     "$STYLO_WEB_IMAGE" != "$STYLO_DB_IMAGE" ]] || fail "Entrada PostgreSQL inválida en $manifest."
}

if [[ "$mode" == con-internet ]]; then
  STYLO_WEB_IMAGE="$project-web:entrega-20261130"
  STYLO_DB_IMAGE='postgres:18-bookworm@sha256:ece55f7868da684e400f82f1030a050718adbdd65c23aa500c486f6e2950dc0f'
else
  step 'Leer los metadatos del archivo transportado'
  [[ "$platform" == linux/amd64 ]] || fail "El archivo offline requiere linux/amd64. Motor actual: $platform."
  read_offline_metadata
fi
export STYLO_WEB_IMAGE STYLO_DB_IMAGE

compose() {
  docker compose --profile inicializacion -p "$project" -f compose.academico.yaml -f compose.entrega.yaml \
    --env-file "$env_file" "$@"
}
image_info() { docker image inspect --format '{{.Id}} {{.Os}}/{{.Architecture}}' "$1"; }

offline_info() {
  docker image inspect --format '{{.Id}} {{.Os}}/{{.Architecture}} {{range .RepoTags}}{{.}} {{end}}' "$1"
}
offline_image_matches() {
  local info=$1 tag=$2 config=$3 manifest=$4 target=$5 id arch tags
  read -r id arch tags <<< "$info"
  [[ "$arch" == linux/amd64 &&
     ( "$id" == "$config" || "$id" == "$manifest" || "$id" == "$target" ) &&
     ( " $tags " == *" $tag "* || " $tags " == *" docker.io/$tag "* ||
       " $tags " == *" docker.io/library/$tag "* ) ]]
}
check_existing_tag() {
  local current
  if current=$(offline_info "$1" 2>/dev/null); then
    offline_image_matches "$current" "$@" || fail "La etiqueta $1 ya apunta a una imagen distinta."
  fi
}
verify_loaded_image() {
  local current
  current=$(offline_info "$1") || fail "No se encontró la etiqueta $1 después de cargar el tar."
  offline_image_matches "$current" "$@" ||
    fail "La etiqueta, el digest o la arquitectura de $1 difieren del archivo transportado."
}

check_endpoint() {
  local name=$1 url=$2 expected=$3 attempt code rc reason
  for attempt in 1 2 3; do
    if code=$(curl -sS --connect-timeout 15 --max-time 25 -o /dev/null -w '%{http_code}' "$url"); then
      [[ "$code" =~ $expected ]] && return 0
      reason="respuesta HTTP $code"
    else
      rc=$?
      case "$rc" in
        5|6) reason='falló la resolución DNS';;
        7) reason='no se pudo abrir la conexión';;
        28) reason='se agotó el tiempo de DNS o conexión';;
        35|60) reason='falló la verificación TLS';;
        *) reason="curl devolvió $rc";;
      esac
    fi
    printf '%s, intento %s/3: %s.
' "$name" "$attempt" "$reason" >&2
    if ((attempt < 3)); then sleep "$((attempt * 2))"; fi
  done
  fail "Sin acceso a $name tras 3 intentos. Verifica DNS, proxy o TLS. En Linux AMD64 puedes usar el paquete offline."
}

check_resources() {
  local memory available_memory disk filesystem
  memory=$(docker info --format '{{.MemTotal}}')
  [[ "$memory" =~ ^[0-9]+$ ]] || fail 'Docker no reportó la memoria del motor. Ejecuta docker info.'
  if [[ "$mode" == con-internet && "$need_web" == true ]]; then
    if ((memory < 2147483648)); then
      fail 'Memoria del motor inferior a 2 GiB para compilar. Usa el paquete AMD64 o solicita más memoria.'
    fi
    if [[ -r /proc/meminfo ]]; then
      available_memory=$(awk '$1=="MemAvailable:" {print $2}' /proc/meminfo)
      if [[ "$available_memory" =~ ^[0-9]+$ ]] && ((available_memory < 1048576)); then
        fail 'Linux tiene menos de 1 GiB de memoria disponible para iniciar la compilación. Consulta free -h y solicita más memoria o usa el paquete AMD64.'
      fi
    fi
  fi
  if filesystem=$(df -Pk -- "$docker_root" 2>/dev/null); then
    disk=$(awk 'END {print $4}' <<< "$filesystem")
    [[ "$disk" =~ ^[0-9]+$ ]] || fail 'No se pudo interpretar el espacio libre del almacén Docker. Consulta df -h.'
    if ((disk < 2097152)); then
      fail 'Almacén Docker con menos de 2 GiB libres. Consulta df -h y solicita espacio.'
    fi
  else
    printf 'AVISO: el usuario no puede consultar el espacio de %s. Si Docker reporta falta de espacio, solicita revisar esa partición.\n' "$docker_root" >&2
  fi
}

step 'Validar Compose'
compose config --quiet

if [[ "$mode" == con-internet ]]; then
  need_db=false
  need_web=false
  if ! image_info "$STYLO_DB_IMAGE" >/dev/null 2>&1; then need_db=true; fi
  if image_info "$STYLO_WEB_IMAGE" >/dev/null 2>&1; then
    $resume || fail "La etiqueta $STYLO_WEB_IMAGE ya existe. Elige otro proyecto."
  else
    need_web=true
  fi
  step 'Comprobar recursos'
  check_resources
  if $need_db || $need_web; then
    step 'Comprobar conectividad'
    check_endpoint 'Docker Hub' https://registry-1.docker.io/v2/ '^(200|401)$'
    check_endpoint 'autenticación de Docker Hub' https://auth.docker.io/ '^(200|301|302|404)$'
  fi
  if $need_db; then
    step 'Descargar PostgreSQL'
    docker image pull "$STYLO_DB_IMAGE" || fail 'Falló docker pull. Corrige la conectividad o usa el paquete offline.'
  fi
  if $need_web; then
    step 'Comprobar conectividad'
    check_endpoint 'npm' https://registry.npmjs.org/ '^200$'
    step 'Compilar Next.js'
    compose build web || fail 'Falló la compilación. Revisa el primer error del build, la memoria y el disco, o usa el paquete offline.'
  fi
else
  step 'Comprobar recursos'
  need_web=false
  check_resources
  step 'Verificar y cargar las imágenes transportadas'
  [[ -f "$3" ]] || fail 'Falta el archivo de imágenes.'
  command -v sha256sum >/dev/null || fail 'Falta sha256sum para verificar el archivo de imágenes.'
  actual=$(sha256sum -- "$3")
  [[ "${actual%% *}" == "$archive_sha" ]] || fail 'El SHA-256 del archivo de imágenes no coincide.'
  check_existing_tag "$STYLO_WEB_IMAGE" "$web_config" "$web_manifest" "$web_target"
  check_existing_tag "$STYLO_DB_IMAGE" "$db_config" "$db_manifest" "$db_target"
  if ! $resume || ! offline_info "$STYLO_WEB_IMAGE" >/dev/null 2>&1 ||
     ! offline_info "$STYLO_DB_IMAGE" >/dev/null 2>&1; then
    docker image load --input "$3"
  fi
  verify_loaded_image "$STYLO_WEB_IMAGE" "$web_config" "$web_manifest" "$web_target"
  verify_loaded_image "$STYLO_DB_IMAGE" "$db_config" "$db_manifest" "$db_target"
fi

step 'Comprobar la plataforma de las imágenes'
for image in "$STYLO_WEB_IMAGE" "$STYLO_DB_IMAGE"; do
  current=$(image_info "$image")
  [[ "${current##* }" == "$platform" ]] || fail "La plataforma de $image no coincide con $platform."
done

step 'Iniciar PostgreSQL'
compose up -d --no-recreate --no-build --pull never --wait --wait-timeout 120 db
step 'Aplicar migraciones e inicializar datos sintéticos'
job="$project-inicializar"
job_format='{{index .Config.Labels "com.docker.compose.project.working_dir"}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{.Config.Image}}|{{.State.Status}}|{{.State.ExitCode}}'
if job_info=$(docker container inspect --format "$job_format" "$job" 2>/dev/null); then
  $resume && [[ "$job_info" == "$PWD|$project|init|$STYLO_WEB_IMAGE|"* ]] ||
    fail "Ya existe un inicializador incompatible: $job."
  case "$job_info" in
    *'|running|'*|*'|exited|0') ;;
    *'|created|'*|*'|exited|'*) docker start "$job" >/dev/null ;;
    *) fail "El inicializador está en un estado inesperado. Ejecuta docker inspect -f '{{.State.Status}}' $job." ;;
  esac
else
  compose run -d --no-deps --interactive=false -T --pull never --name "$job" init >/dev/null
fi
printf 'Inicializador: %s. Si se corta SSH, el trabajo continúa en Docker.
' "$job"
init_status=$(docker wait "$job")
docker logs "$job"
[[ "$init_status" == 0 ]] ||
  fail "Inicialización fallida (código $init_status). Revisa docker logs $job. Si Prisma registra una migración fallida, conserva el volumen y usa la alternativa aislada."
step 'Verificar el historial Prisma'
compose run --rm --no-deps --interactive=false -T --pull never init node_modules/prisma/build/index.js migrate status
step 'Iniciar Next.js'
compose up -d --no-recreate --no-build --pull never --wait --wait-timeout 120 web
step 'Verificar salud desde el host'
health=$(curl --noproxy '*' -fsS --max-time 10 "$probe_url/api/health")
grep -Eq '"database"[[:space:]]*:[[:space:]]*"ok"' <<< "$health" || fail 'La respuesta de salud no confirma PostgreSQL.'
printf '%s\n' "$health"
compose ps
printf '\nURL para el navegador: %s\n' "$public_url"
