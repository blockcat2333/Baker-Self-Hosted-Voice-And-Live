# Beginner Deployment Guide

This guide is for people who want the fastest path to a private, Discord-like server for friends, family, or a small team.

If you do not want to learn the full monorepo yet, start here instead of reading the architecture documents first.

## What Baker Gives You

- Text chat in the browser
- Voice rooms in the browser
- In-room livestream or screen sharing
- One self-hosted server that your own community controls

## What You Need Before You Start

- A machine that can run Docker Desktop or Docker Engine
- About 10 minutes for the first local test
- A modern browser such as Chrome, Edge, or Firefox

For a private local test on one machine, that is enough.

For a public internet deployment, you also need:

- HTTPS
- A public domain or public IP
- TURN enabled for voice and livestream reliability

## Fastest Local Test

1. Install Docker Desktop.
2. Open a terminal.
3. Run:

```bash
docker volume create baker-data

docker run -d \
  --name baker \
  -p 3000:80 \
  -p 3001:8080 \
  -v baker-data:/var/lib/baker \
  -v /var/run/docker.sock:/var/run/docker.sock \
  blockcat233/baker:1.1.4
```

4. Read the first admin password:

```bash
docker logs baker
```

5. Open:

- Web: `http://localhost:3000`
- Admin: `http://localhost:3001`

This guide assumes the official all-in-one image. The container includes the bundled services and `supervisorctl`, so the admin panel can restart Media/TURN after deployment-setting or public-IP changes. The repo's `docker-compose.yml` is for local development infrastructure, not the public deployment path.

## What To Do After The Container Starts

1. Open the admin page and sign in with the password from `docker logs baker`.
2. Review the server name, registration policy, and other instance settings.
3. Keep the Docker socket mount if you want the admin panel to perform one-click updates later.
4. Open the main web app and create the first user account.
5. Create a second test account or ask one friend to join before you test voice and livestream.

If your server needs a proxy to reach GitHub or Docker Hub metadata, open **Server Updates -> Update Proxy** in the admin panel and save an HTTP/HTTPS proxy URL before checking versions. This proxy is only for Baker update metadata requests; Public IP Automation still checks the server's real public IP directly. Docker image downloads are performed by the host Docker daemon, so failed image pulls still require a Docker daemon proxy or registry mirror on the Docker host.

## When You Must Use HTTPS

Use HTTPS when:

- users connect from phones
- users connect from another network
- you want voice, microphone, camera, or screen sharing to work reliably

Browser media APIs are stricter on mobile and remote deployments. HTTP is only reasonable for a quick local test.

## When You Must Enable TURN

TURN is strongly recommended when:

- users are in different cities or countries
- users are on campus, office, hotel, or mobile networks
- users connect through VPNs
- voice joins but nobody can hear each other
- livestream status opens but video does not play

Public deployment checklist:

- publish `3478/tcp` and `3478/udp`
- publish `49160-49200/tcp` and `49160-49200/udp`
- set `TURN_ENABLED=true`
- set `TURN_EXTERNAL_IP=<your public IP>` or explicit `TURN_URLS`
- set `TURN_USERNAME` and `TURN_PASSWORD`

After the container restarts, check the logs and make sure the media service reports `turnConfigured:true`.

If your public IP may change, enable **Runtime Status -> Public IP Automation** in the admin panel after TURN/SFU is configured. Baker will periodically detect the current public IP and refresh the managed media addresses.

Baker defaults to several public IP check endpoints, including `https://ip.3322.net`, `https://myip.ipip.net`, and `https://ifconfig.co/ip` for server networks that cannot reliably reach the older global endpoints. If your server still reports detection failures, set `BAKER_PUBLIC_IP_ENDPOINTS` to a comma-separated list that works from that server. The response may be a plain IP address, JSON with an `ip` field, or text that contains an IP address.

All-in-one Docker env values for `TURN_EXTERNAL_IP`, `TURN_URLS`, and `SFU_ANNOUNCED_IP` are first-run seeds only. After `runtime.env` exists, Baker uses the runtime file as the source of truth so Public IP Automation can replace stale media addresses without being overridden by old container env values.

## Optional SFU Mode

TURN keeps P2P media working through NAT. SFU mode is different: voice and livestream tracks go through Baker's media backend, which is useful when some users are on networks that block or degrade direct P2P paths.

To make SFU selectable in the admin panel, also publish the SFU RTC range and set the public IP:

```bash
docker run -d \
  --name baker \
  -p 3000:80 \
  -p 3001:8080 \
  -p 50000-50100:50000-50100/udp \
  -p 50000-50100:50000-50100/tcp \
  -e SFU_ANNOUNCED_IP=203.0.113.10 \
  -v baker-data:/var/lib/baker \
  -v /var/run/docker.sock:/var/run/docker.sock \
  blockcat233/baker:1.1.4
```

Then open the admin panel and change **Server settings -> Media mode** to `sfu`. Existing voice and livestream sessions reconnect immediately in the new mode, while text chat remains connected.

## Optional Mainland/Overseas Media Split

If your users are clearly split across network regions, such as mainland users opening `violet.evergarden.space` and overseas users opening `hkserver.evergarden.space`, configure `MEDIA_REGION_PROFILES`. Baker then uses the web host that the browser opened to choose the TURN/SFU addresses returned for voice, music share, and livestream media sessions.

Requirements:

- Both web hostnames must reach the same Baker web service.
- Each profile's `hosts` list must include the matching web hostname.
- Each profile's `turnUrls` and `sfuAnnouncedIp` must be reachable from users in that region.
- SFU RTC ports must use same-number forwarding. If the Hong Kong profile says `23335-23340`, frp should map `23335-23340 -> Baker:23335-23340`.

If `turnUrls` is omitted, the profile inherits the global TURN configuration. If it is set to an empty array, TURN is disabled for that profile and users have no relay fallback when direct SFU connectivity fails.

Do not use mappings such as `23335 -> 50000` for SFU. Browsers connect to the candidate port returned by Baker, so mismatched port numbers break media negotiation.

The regional web entry is independent from those media mappings. It must serve trusted HTTPS and proxy WebSocket upgrades. If the relay exposes only a nonstandard web port, use DNS-01 for automatic certificate renewal; HTTP-01 and TLS-ALPN-01 still require public `80/443` challenge reachability.

For an Aliyun-hosted DNS zone, the all-in-one image includes an optional DNS-01 HTTPS listener. Publish `3443:3443/tcp` and set `BAKER_HTTPS_ENABLED=true`, `BAKER_HTTPS_HOST=<public hostname>`, `BAKER_HTTPS_PORT=3443`, `ALIYUN_ACCESS_KEY_ID`, and `ALIYUN_ACCESS_KEY_SECRET`. Point the FRP TCP proxy at the Docker host's port `3443`; for example, public `23333 -> 192.168.233.2:3443`. Keep the `/var/lib/baker` volume because Caddy stores its renewable certificate state under `/var/lib/baker/caddy`. Use a dedicated, least-privilege RAM access key rather than a root-account key.

The container must also be able to reach each recursive DNS resolver that Caddy uses for propagation checks. If the ACME log reports `connection refused` or a timeout for an inherited resolver after the TXT record is created, recreate only the Baker container with a reachable Docker `--dns <resolver-ip>` (or Compose `dns:`) setting. Do not change host-wide DNS for this repair. Verify that the selected resolver answers public TXT queries so the same path remains valid for renewal.

You can edit the profile JSON from **Deployment Settings -> Media Region Profiles JSON** in the admin panel. Save the settings, then click **Apply And Restart Container** so the all-in-one container publishes the new ports.

## Public Internet Example

```bash
docker run -d \
  --name baker \
  -p 3000:80 \
  -p 3001:8080 \
  -p 3478:3478/tcp \
  -p 3478:3478/udp \
  -p 49160-49200:49160-49200/tcp \
  -p 49160-49200:49160-49200/udp \
  -e TURN_ENABLED=true \
  -e TURN_EXTERNAL_IP=203.0.113.10 \
  -e TURN_USERNAME=baker \
  -e TURN_PASSWORD=change-this \
  -e BAKER_PUBLIC_IP_ENDPOINTS='https://ip.3322.net,https://myip.ipip.net,https://ifconfig.co/ip,https://api.ipify.org?format=json' \
  -v baker-data:/var/lib/baker \
  -v /var/run/docker.sock:/var/run/docker.sock \
  blockcat233/baker:1.1.4
```

You still need to place HTTPS in front of the web app for real users.

## Common Problems

### The page will not open

Check:

- Docker container is running
- host port `3000` maps to container `80`
- host port `3001` maps to container `8080`

### Chat works, but voice or screen sharing is blocked

Check:

- the site is served over HTTPS
- the browser was allowed to use the microphone or screen
- you are testing in a modern browser

### Users can join voice, but only the speaking light works

That almost always means direct peer-to-peer connection succeeded only partially and the audio relay path did not.

Check:

- TURN is enabled
- relay ports are open
- `TURN_EXTERNAL_IP` or `TURN_URLS` is correct
- logs show `turnConfigured:true`

### Livestream opens, but the video never plays

Treat it the same way as the voice issue above. Livestream watching also needs a working TURN path in public or hard-NAT networks.

## Upgrading Later

If you keep the same Docker volume, you can recreate the container without losing your data. Newer Baker versions can also update from the admin panel when `/var/run/docker.sock` is mounted.

Typical upgrade flow:

```bash
docker pull blockcat233/baker:1.1.4
docker rm -f baker
```

Then rerun your original `docker run` command with the same `baker-data` volume.
