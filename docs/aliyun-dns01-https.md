# Aliyun DNS-01 HTTPS for the All-in-One Image

## Scope

Baker 1.1.3 adds an optional HTTPS listener to the all-in-one Supervisor image. It is intended for deployments where:

- the public Baker hostname is managed by Aliyun DNS;
- the public relay can expose a TCP port, but public `80/tcp` and `443/tcp` are unavailable;
- browser users need a trusted HTTPS/WSS origin for microphone, camera, screen capture, voice, and livestream features; and
- the operator wants to keep Baker in one all-in-one container instead of adding a separate reverse-proxy container.

This listener is disabled by default. Existing HTTP, TURN, SFU, admin, and Supervisor behavior is unchanged until it is enabled.

## Traffic Model

```text
Browser
  -> https://baker-overseas.example.com:23333
  -> relay/frps TCP 23333
  -> frpc TCP tunnel
  -> Docker host 3443/tcp
  -> Baker Caddy 3443/tcp (TLS + WebSocket termination)
  -> Baker Web/API/Gateway
```

TURN and SFU ports do not pass through this HTTPS listener. Keep their existing TCP/UDP mappings and media-region profiles.

DNS-01 changes only a temporary `_acme-challenge` TXT record during certificate issuance and renewal. The certificate authority does not need to connect to public port `80` or `443`.

## Requirements

- Baker all-in-one image `blockcat233/baker:1.1.3` or newer.
- A public hostname whose authoritative DNS zone is hosted by Aliyun DNS.
- A dedicated Aliyun RAM user and AccessKey for DNS automation.
- A persistent mount at `/var/lib/baker`.
- Docker host port `3443/tcp` published to container port `3443/tcp`.
- A TCP relay or port forward that preserves TLS bytes end to end.

Do not configure FRP HTTP mode for this path. Baker must receive the original TLS connection, so the web proxy must use raw TCP mode.

## Environment Variables

| Variable                   | Required      | Default                       | Purpose                                                                         |
| -------------------------- | ------------- | ----------------------------- | ------------------------------------------------------------------------------- |
| `BAKER_HTTPS_ENABLED`      | Yes when used | `false`                       | Enables the optional HTTPS listener.                                            |
| `BAKER_HTTPS_HOST`         | Yes           | none                          | Public DNS hostname on the certificate. Do not include a scheme, path, or port. |
| `BAKER_HTTPS_PORT`         | No            | `3443`                        | Container-side HTTPS listener port.                                             |
| `ALIYUN_ACCESS_KEY_ID`     | Yes           | none                          | AccessKey ID for the dedicated RAM identity.                                    |
| `ALIYUN_ACCESS_KEY_SECRET` | Yes           | none                          | AccessKey secret for the dedicated RAM identity.                                |
| `XDG_DATA_HOME`            | Image-managed | `/var/lib/baker/caddy/data`   | Persistent Caddy certificate and ACME data.                                     |
| `XDG_CONFIG_HOME`          | Image-managed | `/var/lib/baker/caddy/config` | Persistent Caddy runtime configuration data.                                    |

The generated Caddy configuration contains environment placeholders, not credential values. Docker can still expose container environment variables to Docker administrators, so treat Docker/Container Manager access as privileged.

## Aliyun RAM Policy

Create a dedicated RAM user for Baker. Do not create or use an AccessKey on the Alibaba Cloud root account.

The AliDNS provider currently uses these API actions:

- `alidns:DescribeDomains`
- `alidns:DescribeDomainRecords`
- `alidns:AddDomainRecord`
- `alidns:DeleteDomainRecord`
- `alidns:UpdateDomainRecord`

The following custom policy keeps list/read access account-wide where the AliDNS API requires it and scopes record writes to one DNS zone. Replace `<account-id>` and `<zone>` before creating the policy.

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["alidns:DescribeDomains", "alidns:DescribeDomainRecords"],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "alidns:AddDomainRecord",
        "alidns:DeleteDomainRecord",
        "alidns:UpdateDomainRecord"
      ],
      "Resource": "acs:alidns:*:<account-id>:domain/<zone>"
    }
  ]
}
```

Example zone values are `example.com` or `example.net`, not the full Baker hostname. If the custom policy is rejected by an older AliDNS account configuration, temporarily use the official `AliyunDNSFullAccess` system policy only to diagnose the authorization boundary, then return to a custom policy before production use.

## Docker CLI Example

This example shows only the web and HTTPS ports. Add the TURN/SFU ports required by your media deployment.

```bash
docker run -d \
  --name baker \
  --restart unless-stopped \
  -p 3000:80/tcp \
  -p 3001:8080/tcp \
  -p 3443:3443/tcp \
  -e BAKER_HTTPS_ENABLED=true \
  -e BAKER_HTTPS_HOST=baker-overseas.example.com \
  -e BAKER_HTTPS_PORT=3443 \
  -e ALIYUN_ACCESS_KEY_ID='<RAM AccessKey ID>' \
  -e ALIYUN_ACCESS_KEY_SECRET='<RAM AccessKey secret>' \
  -v baker-data:/var/lib/baker \
  -v /var/run/docker.sock:/var/run/docker.sock \
  blockcat233/baker:1.1.3
```

Keep the AccessKey values in the container manager's secret/environment configuration. Do not commit them to Compose files, shell scripts, issue reports, screenshots, or support bundles.

## Synology Container Manager

For an existing Baker container:

1. Back up the current container settings and the `/var/lib/baker` volume.
2. Pull `blockcat233/baker:1.1.3` or a newer pinned release.
3. Keep every existing data mount, Docker socket mount, TURN port, SFU port, and media environment variable.
4. Add host `3443/tcp` to container `3443/tcp`.
5. Add the five `BAKER_HTTPS_*` and `ALIYUN_*` settings from the table above.
6. Recreate the container with the same `/var/lib/baker` mount.
7. Confirm that PostgreSQL, Redis, API, Gateway, Media, Caddy, runtime watchdog, and optional TURN processes are running in `supervisorctl status`.

This mode does not require a Synology DSM certificate, DSM reverse proxy, or a change to DSM ports `443`/`5001`.

## FRP TCP Example

The public and local ports do not need to match for the HTTPS web entry because Caddy generates URLs from the browser request. This differs from SFU candidate ports, which must use same-number forwarding.

```toml
serverAddr = "relay.example.com"
serverPort = 7000

[[proxies]]
name = "baker-https"
type = "tcp"
localIP = "192.0.2.10"
localPort = 3443
remotePort = 23333
```

The resulting user URL is `https://baker-overseas.example.com:23333/`.

Do not add a second TLS terminator between FRP and Baker unless that proxy is deliberately configured to forward WebSocket upgrades and preserve `Host`, `X-Forwarded-Host`, and `Origin`.

## First-Start Verification

1. Start the container and inspect its logs. A successful configuration includes:

   ```text
   [HTTPS] Configured DNS-01 TLS for baker-overseas.example.com:3443.
   ```

2. Allow time for the first ACME order and DNS TXT propagation. Aliyun free DNS zones can have a longer minimum TTL.
3. Test the local listener from the Docker host or LAN:

   ```bash
   curl --resolve baker-overseas.example.com:3443:192.0.2.10 \
     https://baker-overseas.example.com:3443/health
   ```

4. Test the public FRP endpoint: `curl https://baker-overseas.example.com:23333/health`.
5. Open the public URL in a browser, sign in, and verify WebSocket chat plus microphone permission.
6. Verify TURN and SFU separately. A valid web certificate does not prove that media ports are reachable.

## Renewal and Persistence

Caddy renews certificates automatically before expiration. No scheduled task is required.

Renewal continues to require:

- the RAM AccessKey remains active;
- the RAM policy still permits TXT record changes;
- the container can reach Aliyun DNS and the ACME certificate authority; and
- `/var/lib/baker/caddy` remains writable and persistent.

Do not delete `/var/lib/baker/caddy` during routine upgrades. Deleting it discards the ACME account and certificate cache and can cause unnecessary reissuance or rate-limit pressure.

## Upgrade

1. Back up `/var/lib/baker` and export the existing container configuration.
2. Pull a pinned newer Baker image.
3. Recreate the container with the same mounts, HTTPS variables, port `3443`, TURN/SFU mappings, and media-region profiles.
4. Confirm `/health`, the public HTTPS endpoint, `supervisorctl status`, and one real browser voice session.

Baker's one-click updater preserves ordinary environment variables and port bindings. Before relying on it for the first upgrade from a pre-1.1.3 container, add the new HTTPS variables and `3443` binding through the container manager once.

## Rollback

To disable the feature without deleting data:

1. Set `BAKER_HTTPS_ENABLED=false` or remove the optional HTTPS variables.
2. Recreate the container.
3. Point the relay back to an existing trusted reverse proxy, or stop advertising the HTTPS URL.
4. Remove the `3443` host mapping only after the relay no longer targets it.

To roll back the image, recreate the container with the previous pinned Baker image and the same `/var/lib/baker` mount. Older images ignore the Caddy data directory. Keep it for a future return to 1.1.3 or newer.

## Troubleshooting

### Container exits before Supervisor starts

- `BAKER_HTTPS_HOST must be a valid DNS hostname`: remove `https://`, ports, paths, spaces, or trailing dots.
- `BAKER_HTTPS_PORT must be an integer`: use a value from `1` to `65535` and publish the same container port.
- `Aliyun DNS-01 requires ...`: both AccessKey variables must be present.

### ACME reports an AliDNS authorization error

- Confirm the AccessKey belongs to the intended RAM user.
- Confirm the RAM policy includes all five actions listed above.
- Confirm the policy's zone and Alibaba Cloud account ID are correct.
- Confirm the authoritative DNS provider for the zone is Aliyun.

### Local HTTPS works but the public endpoint fails

- Confirm FRP uses `type = "tcp"`.
- Confirm the relay public port is listening and allowed by its firewall/security group.
- Confirm frpc points to the Docker host port `3443`, not Baker HTTP port `3000`.
- Confirm SNI and the browser hostname match `BAKER_HTTPS_HOST`.

### Web works but voice fails

HTTPS and WebSocket termination are only the signaling path. Check the selected `MEDIA_REGION_PROFILES`, TURN credentials, TURN TCP/UDP ports, SFU announced IP, and same-number SFU RTC port forwarding.

## Other DNS Providers

The published 1.1.3 image includes the AliDNS Caddy module only. Operators using another DNS provider should either:

- terminate HTTPS in an external reverse proxy that supports that provider's DNS-01 API; or
- build a custom Caddy binary with the appropriate `caddy-dns` module and maintain that image themselves.

Do not pass a different provider's credentials into the AliDNS variables.
