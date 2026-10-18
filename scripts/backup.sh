#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
mkdir -p backups
destination="backups/bar-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose exec -T db pg_dump -U bar -d bar --format=custom > "${destination}.partial"
mv "${destination}.partial" "$destination"
echo "Respaldo creado: $destination"
