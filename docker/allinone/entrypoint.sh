#!/bin/sh
set -eu

. /opt/baker-runtime/lib.sh
. /opt/baker-allinone/lib.sh

: "${BAKER_DATA_DIR:=/var/lib/baker}"
: "${BAKER_RUNTIME_DIR:=$BAKER_DATA_DIR/runtime}"
: "${PGDATA:=$BAKER_DATA_DIR/postgres}"
: "${REDIS_DATA_DIR:=$BAKER_DATA_DIR/redis}"
: "${TURN_ENABLED:=false}"

export BAKER_DATA_DIR
export BAKER_RUNTIME_DIR
export PGDATA
export REDIS_DATA_DIR
export TURN_ENABLED

create_runtime_dirs() {
  mkdir -p "$BAKER_DATA_DIR" "$BAKER_RUNTIME_DIR" "$PGDATA" "$REDIS_DATA_DIR" /var/run/postgresql
  chown -R postgres:postgres "$PGDATA" /var/run/postgresql
  chown -R redis:redis "$REDIS_DATA_DIR"
  chmod 2775 /var/run/postgresql
}

validate_turn_settings() {
  if ! is_true "$TURN_ENABLED"; then
    return 0
  fi

  if [ -z "${TURN_USERNAME:-}" ] || [ -z "${TURN_PASSWORD:-}" ]; then
    echo "TURN_ENABLED=true requires TURN_USERNAME and TURN_PASSWORD." >&2
    exit 1
  fi
}

start_temp_postgres() {
  postgres_start_log="$PGDATA/startup.log"

  if ! gosu postgres pg_ctl -D "$PGDATA" -o "$(postgres_server_opts)" -l "$postgres_start_log" start >/dev/null; then
    echo "Failed to start PostgreSQL." >&2
    if [ -f "$postgres_start_log" ]; then
      cat "$postgres_start_log" >&2
    fi
    exit 1
  fi

  if ! wait_for_tcp 127.0.0.1 5432 PostgreSQL 60; then
    if [ -f "$postgres_start_log" ]; then
      cat "$postgres_start_log" >&2
    fi
    exit 1
  fi
}

stop_temp_postgres() {
  gosu postgres pg_ctl -D "$PGDATA" -m fast -w stop >/dev/null
}

ensure_postgres_role_and_database() {
  user_lit="$(sql_literal "$POSTGRES_USER")"
  db_lit="$(sql_literal "$POSTGRES_DB")"
  password_lit="$(sql_literal "$POSTGRES_PASSWORD")"
  db_ident="$(sql_identifier "$POSTGRES_DB")"
  user_ident="$(sql_identifier "$POSTGRES_USER")"

  gosu postgres psql --dbname=postgres -v ON_ERROR_STOP=1 <<EOF
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${user_lit}) THEN
    EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', ${user_lit}, ${password_lit});
  ELSE
    EXECUTE format('ALTER ROLE %I WITH LOGIN PASSWORD %L', ${user_lit}, ${password_lit});
  END IF;
END
\$\$;
SELECT format('CREATE DATABASE %I OWNER %I', ${db_lit}, ${user_lit})
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = ${db_lit}) \gexec
ALTER DATABASE ${db_ident} OWNER TO ${user_ident};
EOF
}

initialize_postgres_cluster() {
  if [ -s "$PGDATA/PG_VERSION" ]; then
    return 0
  fi

  echo "[Init] Initializing PostgreSQL cluster at $PGDATA"
  gosu postgres initdb -D "$PGDATA" --encoding=UTF8 --auth-local=trust --auth-host=scram-sha-256 >/dev/null
}

run_database_migrations() {
  export DATABASE_URL
  DATABASE_URL="$(postgres_dsn)"

  start_temp_postgres
  trap 'stop_temp_postgres' EXIT INT TERM
  wait_for_tcp 127.0.0.1 5432 PostgreSQL 30
  ensure_postgres_role_and_database

  echo "[Init] Applying Baker database schema"
  pnpm --filter @baker/db db:push

  trap - EXIT INT TERM
  stop_temp_postgres
}

create_runtime_dirs
capture_turn_runtime_overrides
/opt/baker-runtime/bootstrap.sh
load_runtime_env
apply_turn_runtime_overrides
default_turn_urls_if_needed
validate_turn_settings
initialize_postgres_cluster
run_database_migrations

echo "[Start] Launching Baker all-in-one services"
exec /usr/bin/supervisord -c /etc/baker/supervisord.conf
