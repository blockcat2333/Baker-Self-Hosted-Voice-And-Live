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
  blockcat233/baker:1.0.0
```

4. Read the first admin password:

```bash
docker logs baker
```

5. Open:

- Web: `http://localhost:3000`
- Admin: `http://localhost:3001`

## What To Do After The Container Starts

1. Open the admin page and sign in with the password from `docker logs baker`.
2. Review the server name, registration policy, and other instance settings.
3. Open the main web app and create the first user account.
4. Create a second test account or ask one friend to join before you test voice and livestream.

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
  -v baker-data:/var/lib/baker \
  blockcat233/baker:1.0.0
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

If you keep the same Docker volume, you can recreate the container without losing your data.

Typical upgrade flow:

```bash
docker pull blockcat233/baker:1.0.0
docker rm -f baker
```

Then rerun your original `docker run` command with the same `baker-data` volume.
