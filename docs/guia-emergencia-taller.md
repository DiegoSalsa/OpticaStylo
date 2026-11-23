# Guía de emergencia de Taller

## Instalación con internet

```bash
git clone https://github.com/DiegoSalsa/OpticaStylo.git
cd OpticaStylo
bash instalar-taller.sh
```

Confirma la IP del servidor en la red del aula, el puerto propuesto y el origen
exacto del navegador, incluido el puerto. Si se corta SSH, vuelve a conectarte y
repite `bash instalar-taller.sh` desde el mismo clon. Cuando el inicializador ya
está en marcha, Docker lo mantiene en segundo plano y el reintento espera su
resultado. La salida indica el proyecto y el comando para consultar las claves.

## Paquete offline AMD64

Transfiere `stylo-taller.tar.gz` con `scp` y conéctate por SSH. Compara el
SHA-256 del archivo con el de la entrega por un canal de confianza.

```bash
printf '%s  %s\n' 'SHA256_DE_LA_ENTREGA' stylo-taller.tar.gz | sha256sum -c -
d=$(mktemp -d "$HOME/stylo-taller.XXXXXX")
tar -xzf stylo-taller.tar.gz -C "$d" && bash "$d/instalar.sh"
```

Continúa con la extracción únicamente si el SHA-256 es correcto. Si el
instalador informa que otra edición ocupa la ruta, ejecuta
`bash "$d/instalar.sh" --alternativa`. Elige un puerto libre. El respaldo inicia
con datos sintéticos y volúmenes nuevos. Los datos de la instalación principal
quedan en sus volúmenes. Conserva el paquete para los reintentos.

## Diagnóstico rápido

Usa el nombre del proyecto anunciado por el instalador en lugar de `P`.
`bash instalar-taller.sh estado` muestra los servicios de la instalación principal.
Para el respaldo, usa `bash instalar.sh --alternativa estado`.

| Mensaje o síntoma | Diagnóstico | Acción |
| --- | --- | --- |
| DNS, timeout o acceso a Docker Hub | `getent ahosts registry-1.docker.io` | Usa el paquete AMD64 si persiste. Si falla solo el pull, revisa el proxy del daemon. |
| Falta Docker, Compose o permisos | `docker info; docker compose version` | Usa una cuenta autorizada o un servidor con Docker operativo. |
| Arquitectura incompatible | `docker info --format '{{.OSType}}/{{.Architecture}}'` | Usa Linux AMD64 para el paquete o ARM64 con internet y compilación autorizada. |
| Memoria, disco o compilación | `free -h; df -h; docker system df` | Revisa el primer error. El paquete evita compilar. Si falta disco, solicita espacio. |
| IP incorrecta o puerto ocupado | `ip -br addr; ss -ltn` | En el primer intento, elige IP local y un puerto libre. En un reintento, recupera el enlace original o usa el respaldo aislado. |
| Salud local correcta, acceso externo fallido | `curl -fsS http://IP:PUERTO/api/health` desde el cliente | Confirma IP del aula, ruta y firewall con el administrador. |
| PostgreSQL no saludable | `docker logs --tail 60 P-db-1` | Revisa espacio y arranque antes de reintentar. Conserva el volumen. |
| Inicialización fallida o P3009 | `docker logs --tail 60 P-inicializar` | Corrige fallos transitorios y reintenta. Si Prisma registró una migración fallida, conserva el volumen y usa el respaldo para la evaluación. |
| Next.js no saludable | `docker logs --tail 60 P-web-1` | Corrige la causa indicada y repite el instalador. |
| SHA-256, etiqueta o digest inválido | `sha256sum stylo-taller.tar.gz` | Copia de nuevo el archivo oficial y comprueba su SHA-256. |

Evita `down -v`, `prune` y `migrate reset`. Consulta las credenciales demo en
una terminal privada con el comando mostrado al terminar.
