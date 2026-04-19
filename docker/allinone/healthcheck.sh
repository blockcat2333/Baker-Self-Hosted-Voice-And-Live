#!/bin/sh
set -eu

exec curl -fsS http://127.0.0.1/health >/dev/null
