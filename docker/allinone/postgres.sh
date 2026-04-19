#!/bin/sh
set -eu

. /opt/baker-allinone/lib.sh

: "${BAKER_DATA_DIR:=/var/lib/baker}"
: "${PGDATA:=$BAKER_DATA_DIR/postgres}"

mkdir -p /var/run/postgresql
chown postgres:postgres /var/run/postgresql
chmod 2775 /var/run/postgresql

exec gosu postgres postgres -D "$PGDATA" $(postgres_server_opts)
