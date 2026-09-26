#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

if [[ ! -f "$PG_DATA/PG_VERSION" ]]; then
  echo "No local cluster yet. Run: pnpm db:setup" >&2
  exit 1
fi

if "$PG_BIN/pg_ctl" --pgdata="$PG_DATA" status >/dev/null 2>&1; then
  echo "Local PostgreSQL is already running on port $PG_PORT."
  exit 0
fi

"$PG_BIN/pg_ctl" --pgdata="$PG_DATA" --log="$PG_LOG" --wait start >/dev/null
echo "Local PostgreSQL is running on 127.0.0.1:$PG_PORT."
