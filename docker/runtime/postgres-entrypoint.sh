#!/bin/sh
set -eu

. /opt/baker-runtime/lib.sh
load_runtime_env

export POSTGRES_DB
export POSTGRES_USER
export POSTGRES_PASSWORD

exec docker-entrypoint.sh "$@"
