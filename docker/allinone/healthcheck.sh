#!/bin/sh
set -eu

for service in postgres redis media api gateway caddy runtime-watchdog; do
  status="$(supervisorctl -c /etc/baker/supervisord.conf status "$service")"
  case "$status" in
    "$service "*RUNNING*) ;;
    *) exit 1 ;;
  esac
done

exec curl -fsS http://127.0.0.1/health >/dev/null
