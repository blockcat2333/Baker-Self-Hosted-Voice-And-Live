# dev-test Personal Config

`dev-test.bat` no longer stores personal information (domain, email, etc.) directly in the script.

## How to configure

1. Copy `docs/examples/dev-test.local.env.example` to `dev-test.local.env`.
2. Fill your own values in `dev-test.local.env`.
3. Run `dev-test.bat` as usual.

`dev-test.local.env` is ignored by git and must stay local-only.

## Required keys

- `TURN_HOST`
- `HTTPS_HOST`
- `HTTPS_PORT`
- `TLS_MODE` (`public` or `internal`)
- `ACME_EMAIL` (recommended when `TLS_MODE=public`)

## Optional port keys

Use these if you want the startup checklist to match your deployment exactly:

- `WEB_LAN_PORT`
- `API_PORT`
- `GATEWAY_PORT`
- `ADMIN_PORT`
- `POSTGRES_PORT`
- `REDIS_PORT`
- `TURN_PORT`
- `TURN_RELAY_MIN`
- `TURN_RELAY_MAX`

## Port and protocol checklist

- Web HTTPS entry: `HTTPS_PORT` / `TCP`
- Web dev HTTP: `WEB_LAN_PORT` / `TCP`
- API: `API_PORT` / `TCP`
- Gateway WebSocket: `GATEWAY_PORT` / `TCP`
- Admin panel: `ADMIN_PORT` / `TCP`
- PostgreSQL: `POSTGRES_PORT` / `TCP`
- Redis: `REDIS_PORT` / `TCP`
- TURN entry: `TURN_PORT` / `TCP + UDP`
- TURN relay range: `TURN_RELAY_MIN`-`TURN_RELAY_MAX` / `TCP + UDP`
