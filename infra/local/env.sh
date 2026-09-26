#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOCAL_DIR="$REPO_ROOT/.local"
PG_DATA="$LOCAL_DIR/postgres/data"
PG_LOG="$LOCAL_DIR/postgres/server.log"
PG_PORT="${SPARK_PG_PORT:-54329}"
CREDENTIALS_FILE="$LOCAL_DIR/credentials.env"
export LC_ALL="${SPARK_PG_LOCALE:-en_US.UTF-8}"

resolve_pg_bin() {
  if command -v brew >/dev/null 2>&1 && brew --prefix postgresql@17 >/dev/null 2>&1; then
    echo "$(brew --prefix postgresql@17)/bin"
    return
  fi
  if command -v pg_ctl >/dev/null 2>&1; then
    dirname "$(command -v pg_ctl)"
    return
  fi
  echo "PostgreSQL 17 was not found. Install it with: brew install postgresql@17" >&2
  exit 1
}

PG_BIN="$(resolve_pg_bin)"
