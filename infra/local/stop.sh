#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

if ! "$PG_BIN/pg_ctl" --pgdata="$PG_DATA" status >/dev/null 2>&1; then
  echo "Local PostgreSQL is not running."
  exit 0
fi

"$PG_BIN/pg_ctl" --pgdata="$PG_DATA" --mode=fast --wait stop >/dev/null
echo "Stopped the local PostgreSQL cluster. Data in .local is preserved."
