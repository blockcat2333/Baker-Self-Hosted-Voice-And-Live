#!/bin/sh
set -eu

. /opt/baker-runtime/lib.sh
load_runtime_env

exec pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"
