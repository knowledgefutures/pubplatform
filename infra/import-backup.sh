#!/usr/bin/env bash
set -euo pipefail

DUMP_FILE="${1:?usage: $0 <path-to-dump.sql>}"
STACK_NAME="${2:-pubpub}"

if [[ ! -f "$DUMP_FILE" ]]; then
    echo "file not found: $DUMP_FILE"
    exit 1
fi

DB_CONTAINER=$(sudo docker ps --filter "label=com.docker.swarm.service.name=${STACK_NAME}_db" --format '{{.ID}}' | head -1)

if [[ -z "$DB_CONTAINER" ]]; then
    echo "no running db container found for stack: $STACK_NAME"
    exit 1
fi

echo "importing $DUMP_FILE into container $DB_CONTAINER ..."

if [[ "$DUMP_FILE" == *.sql ]]; then
    sudo docker exec -i "$DB_CONTAINER" \
        psql -U "$PGUSER" -d "$PGDATABASE" < "$DUMP_FILE"
else
    sudo docker exec -i "$DB_CONTAINER" \
        pg_restore --clean --if-exists --no-owner -U "$PGUSER" -d "$PGDATABASE" < "$DUMP_FILE"
fi

echo "import complete"
