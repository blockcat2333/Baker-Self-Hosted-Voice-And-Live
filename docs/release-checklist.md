# Release Checklist

Use this checklist before creating any GitHub Release tag. The goal is to keep README guidance, package metadata, Docker tags, and GitHub Release tags on the same release line.

Run this first:

```bash
pnpm release:check
```

## Server Release

Use this path for a new server image line such as `X.Y.Z`.

- [ ] Pick the numeric server version `X.Y.Z`.
- [ ] Reset the desktop client label to `X.Y.Za` unless a different desktop label is intentionally shipping with the same server line.
- [ ] Set the root `package.json` version to `X.Y.Z`.
- [ ] Set every non-desktop `apps/*/package.json` and `packages/*/package.json` version to `X.Y.Z`.
- [ ] Set `packages/shared/src/version.ts` to `X.Y.Z`.
- [ ] Set `apps/desktop/package.json` version to semver form `X.Y.Z-a`, and set installer `artifactName` to the public desktop label `X.Y.Za`.
- [ ] Update `README.md` and `README.zh-CN.md` release lines and Docker examples.
- [ ] Update `docs/beginner-deployment.md` and `docs/beginner-deployment.zh-CN.md` pinned Docker examples.
- [ ] Run `pnpm release:check`, `pnpm typecheck`, `pnpm lint`, and `pnpm test`.
- [ ] Create the server GitHub Release tag as `vX.Y.Z`.
- [ ] Confirm the Docker workflow publishes `blockcat233/baker:X.Y.Z` and `blockcat233/baker:latest`.
- [ ] If desktop assets are also shipping, create the desktop GitHub Release tag as `vX.Y.Za`.

## Server Beta Release

Use this path for a server beta image line such as `X.Y.Zbeta`.

- [ ] Pick the public beta label `X.Y.Zbeta`.
- [ ] Set the root `package.json`, every non-desktop workspace package, and `packages/shared/package.json` to semver form `X.Y.Z-beta`.
- [ ] Set `packages/shared/src/version.ts` to the public label `X.Y.Zbeta`.
- [ ] Keep the existing desktop package version unless desktop assets are intentionally shipping with the beta.
- [ ] Update `README.md`, `README.zh-CN.md`, `docs/beginner-deployment.md`, and `docs/beginner-deployment.zh-CN.md` to pin `blockcat233/baker:X.Y.Zbeta`.
- [ ] Run `pnpm release:check`, typecheck, lint, tests, production builds, and Docker all-in-one smoke tests.
- [ ] Create the server beta GitHub Release tag as `vX.Y.Zbeta` and mark it as a prerelease.
- [ ] Confirm Docker Hub publishes `blockcat233/baker:X.Y.Zbeta`; update `latest` only when this beta is intended to be the rolling image.

## Desktop-Only Release

Use this path for a desktop/client-only label such as `X.Y.Zb`.

- [ ] Keep the root package, non-desktop workspace packages, and `packages/shared/src/version.ts` on the current numeric server version `X.Y.Z`.
- [ ] Increment only `apps/desktop/package.json` to semver form `X.Y.Z-b`, and installer `artifactName` to the next public client label `X.Y.Zb`.
- [ ] Update README release lines if the public desktop label changes.
- [ ] Run `pnpm release:check`, `pnpm --filter @baker/desktop typecheck`, and `pnpm --filter @baker/desktop test`.
- [ ] Create the desktop GitHub Release tag as `vX.Y.Zb`.
- [ ] Confirm the Docker workflow skips the desktop tag and does not publish `blockcat233/baker:X.Y.Zb`.

## Tag Rules

- Numeric tags such as `vX.Y.Z` are server releases and may publish Docker images.
- Compact beta tags such as `vX.Y.Zbeta` are server prereleases and may publish Docker images.
- Lettered tags such as `vX.Y.Za` are desktop/client releases and may publish desktop assets.
- Server beta package metadata must use semver prerelease form such as `X.Y.Z-beta`; the public GitHub/Docker label keeps compact form `X.Y.Zbeta`.
- Electron package versions must use semver prerelease form such as `X.Y.Z-a`; public GitHub tags and installer names keep the compact label such as `X.Y.Za`.
- Do not overwrite a published bad desktop tag with different assets. Advance the trailing letter, document the incident, and tell affected users to install the fixed installer manually if the broken app cannot start its updater.
- Do not reuse one GitHub Release tag for both the Docker image line and a desktop-only client label.
