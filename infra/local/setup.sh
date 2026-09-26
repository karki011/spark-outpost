#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

if [[ -f "$PG_DATA/PG_VERSION" ]]; then
  echo "Cluster already exists at $PG_DATA. Nothing to do."
  exit 0
fi

mkdir -p "$LOCAL_DIR/postgres"
chmod 700 "$LOCAL_DIR"

PASSWORD="$(openssl rand -hex 24)"
PASSWORD_FILE="$(mktemp)"
trap 'rm -f "$PASSWORD_FILE"' EXIT
printf '%s' "$PASSWORD" > "$PASSWORD_FILE"

"$PG_BIN/initdb" \
  --pgdata="$PG_DATA" \
  --username=spark \
  --pwfile="$PASSWORD_FILE" \
  --auth=scram-sha-256 \
  --encoding=UTF8 \
  --locale=C >/dev/null

cat >> "$PG_DATA/postgresql.conf" <<CONF
listen_addresses = '127.0.0.1'
port = $PG_PORT
unix_socket_directories = ''
CONF

umask 077
cat > "$CREDENTIALS_FILE" <<CREDS
DATABASE_URL=postgres://spark:$PASSWORD@127.0.0.1:$PG_PORT/spark_outpost
TEST_DATABASE_URL=postgres://spark:$PASSWORD@127.0.0.1:$PG_PORT/spark_outpost_test
CREDS

"$PG_BIN/pg_ctl" --pgdata="$PG_DATA" --log="$PG_LOG" --wait start >/dev/null
export PGPASSWORD="$PASSWORD"
"$PG_BIN/createdb" --host=127.0.0.1 --port="$PG_PORT" --username=spark spark_outpost
"$PG_BIN/createdb" --host=127.0.0.1 --port="$PG_PORT" --username=spark spark_outpost_test
"$PG_BIN/pg_ctl" --pgdata="$PG_DATA" --wait stop >/dev/null

echo "Created the local cluster in .local/postgres on port $PG_PORT."
echo "Credentials are in .local/credentials.env (ignored by git)."
