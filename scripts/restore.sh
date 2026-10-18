#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ $# -ne 2 || "$1" != "--replace" || ! -f "$2" ]]; then
  echo 'Uso: bash scripts/restore.sh --replace backups/archivo.dump' >&2
  echo 'Reemplaza los datos actuales. Crea primero un respaldo y detén el servicio al público.' >&2
  exit 1
fi
docker compose stop app
docker compose exec -T db pg_restore -U bar -d bar --clean --if-exists --no-owner --single-transaction < "$2"
docker compose exec -T db psql -U bar -d bar -v ON_ERROR_STOP=1 -c 'DELETE FROM sessions;'
docker compose start app
echo 'Respaldo restaurado. Todos los usuarios deben iniciar sesión de nuevo.'
