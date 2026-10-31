# RaceOffice – Build & Deploy Guide

This guide focuses on build, production run, deployment folder creation, and Windows service setup.

---

## Prerequisites

- Node.js (recommended: current LTS) + npm
- For Windows Service installation: elevated (Administrator) shell

---

## Install dependencies

This repository uses npm workspaces (`apps/*`, `packages/*`): `frontend`, `livetracking-frontend`, `p3test-frontend`, `leaderboard-frontend`, `server`, `livetracking-worker`, `leaderboard-service`, `domain`, `p3parser`, `rmonitor`, `race-status-mock`, `test-utils`.

```sh doc/build-and-deploy.md
npm install   # or `npm ci` for an exact install from package-lock.json (what CI does)
```

The root `.npmrc` sets `legacy-peer-deps=true`. This works around an npm crash on vitest 5's optional self-referencing peer dependencies.

A fresh clone needs no C++ toolchain: `better-sqlite3` 12.x downloads a prebuilt binary through `prebuild-install`. (v13 would make `npm ci` run `node-gyp`; see the Dependabot note below.)

---

## Development build/run (reference)

Run backend + frontend in separate terminals.

Backend:

```sh doc/build-and-deploy.md
npm run dev:server
```

Frontend:

```sh doc/build-and-deploy.md
npm run dev
```

The Vite dev server proxies `/ws`, `/sse` and `/health` to `http://localhost:8787` (see `apps/frontend/vite.config.ts`).

---

## Production build (server serves the SPA)

The backend serves static files from `apps/server/public` (configured via `@fastify/static`).

Build everything. The root `build` first runs `build:packages` (`@raceoffice/domain`, then `@raceoffice/p3parser`), then builds the SPA. Both packages are consumed through their `dist/`, which is gitignored, so they must be built before the server or the frontends:

```sh doc/build-and-deploy.md
npm run build:all
```

Run server:

```sh doc/build-and-deploy.md
npm run start:server -- --host 0.0.0.0 --port 8787 --db "C:\\ProgramData\\RaceOffice\\data\\raceoffice.db"
```

Open:
- UI: `http://<server-host>:8787/`
- Health: `http://<server-host>:8787/health`

---

## Deploy folder (copy-only deployment)

Create a self-contained deployment folder under `./deploy/`:

```sh doc/build-and-deploy.md
npm run deploy
```

This creates (at least):
- `deploy/server/dist/` (compiled server)
- `deploy/server/public/` (built SPAs)
- `deploy/server/node_modules/` (production dependencies)
- `deploy/apps/livetracking-worker/` (compiled worker + its production dependencies)
- `deploy/apps/leaderboard-service/` (leaderboard service as one-file bundle + leaderboard UI, no `node_modules`; see [Leaderboard service](#leaderboard-service))
- `deploy/packages/{domain,p3parser}/` (`package.json` + `dist` of the local packages)
- `deploy/server/RaceOfficeServer.xml` (WinSW service config; auto-generated if missing)
- `deploy/DEPLOY-NEXT-STEPS.txt`

Local packages (`localPackages` in `scripts/deploy.mjs`): npm installs `file:` dependencies as links to the source folders, and the release ZIP does not preserve those links. The script therefore copies each local package as real files into `deploy/server/node_modules/@raceoffice/<name>`. A new local package that the server depends on must be added to that list.

Optional (recommended for copy-only installs):
- portable Node at `tools/node/node.exe` (copied to `deploy/server/node/node.exe`)
- WinSW at `tools/winsw/RaceOfficeServer.exe` (and optionally `RaceOfficeServer.xml`)

---

## Server configuration (CLI / ENV)

Backend configuration (read by `apps/server/src/index.ts`, passed to `buildApp()` in `apps/server/src/app.ts`) is resolved in this order:

1) CLI args:
- `--db <path>`: SQLite file path
- `--host <host>`: bind address (default `0.0.0.0`)
- `--port <port>`: listen port (default `8787`)

2) Environment variables:
- `RACEOFFICE_DB`, `HOST`, `PORT`

3) Defaults:
- DB defaults to `./data/raceoffice.db` relative to current working directory

Recommended DB locations:
- Development: `./data/raceoffice.db`
- Windows Service: `C:\\ProgramData\\RaceOffice\\data\\raceoffice.db`

---

## Windows Service installation (WinSW)

RaceOffice runs as a standard Node process; for Windows Services use **WinSW**.

From deployment folder (elevated shell):

```sh doc/build-and-deploy.md
cd deploy\server
RaceOfficeServer.exe install
RaceOfficeServer.exe start
```

Stop / uninstall:

```sh doc/build-and-deploy.md
RaceOfficeServer.exe stop
RaceOfficeServer.exe uninstall
```

Notes:
- Ensure `C:\\ProgramData\\RaceOffice\\data\\` exists.
- Ensure service account has read/write permissions.
- Default service XML binds to `0.0.0.0` on port `8787`.

---

## Leaderboard service

The leaderboard service replaces the Java app RMonitorLeaderboard (concept: [doc/leaderboard-integration](leaderboard-integration/README.md)). It is shipped as a single esbuild bundle in two ways:

**1. Inside the Windows installation (default).** `npm run deploy` runs `npm run bundle:leaderboard-service` and copies `apps/leaderboard-service/bundle/` to `deploy/apps/leaderboard-service/`. The RaceOffice server starts the service itself (mode `managed`) and proxies it:
- Leaderboard UI: `http://<server-host>:8787/leaderboard/ui/`
- Data (config, recordings): folder `leaderboard` next to the database, e.g. `C:\ProgramData\RaceOffice\data\leaderboard`
- Switch the mode at runtime in the scoring (Live source dialog) or with `--leaderboard-mode managed|external|off`.

**2. As Docker image** for a separate machine at the track (NAS, Raspberry Pi, Linux box). Drop-in for the Java app: port 8080, same REST paths, Java CLI flags accepted.

```sh doc/build-and-deploy.md
docker run -d --name leaderboard -p 8080:8080 -v leaderboard-data:/data \
  -e RMONITOR_HOST=192.168.1.20 -e AUTOCONNECT=true \
  ghcr.io/kaihoefler/raceoffice-leaderboard:latest
```

- Build locally: `docker build -f docker/leaderboard/Dockerfile -t raceoffice-leaderboard .` (context is the repo root; `.dockerignore` sends only the four workspaces needed).
- Compose example: `docker/leaderboard/docker-compose.yml`.
- Orbits on the Docker host itself: `RMONITOR_HOST=host.docker.internal`. The firewall on the Orbits PC must allow inbound port 50000, as for the Java app.
- RaceOffice then uses it as an external source: `--leaderboard-mode external --leaderboard-url http://<host>:8080` or the scoring's Live source dialog.

**Rebuild after changes:** like the livetracking worker, `apps/leaderboard-service/dist` takes precedence over `tsx` in development: `npm run build:leaderboard-service`.

**License:** `packages/rmonitor`, `apps/leaderboard-service` and `apps/leaderboard-frontend` are GPL-3.0-or-later (port of RMonitorLeaderboard). Their `LICENSE` is part of the bundle, the deploy folder and the image.

---

## Continuous Integration & Releases

### `ci.yml`: checks on every push and pull request

- Trigger: push to `main` and every pull request (Dependabot PRs included). A newer run on the same ref cancels the running one.
- Runner: `ubuntu-latest`, Node `22.21.1` (same version as the runtime bundled in releases), npm cache enabled.
- Steps: `npm ci` → `npm run typecheck` → `npm run lint` → `npm run test:all` → `npm run build:all` → bundle the leaderboard service and start it with `--version` (catches dependencies that break when bundled).
- `npm run verify` runs the same sequence locally (except `npm ci`).
- The AMMC integration test is skipped on CI because the AMMC binaries are not in the repository.

### `release.yml`: release on tag

- Trigger: pushing a tag `v*`.
- Runner: `windows-latest`, Node `22.21.1`. The build-time Node matches the bundled `node.exe`, so native modules (`better-sqlite3`) target the same ABI.
- Steps: `npm ci` → download WinSW, portable `node.exe` 22.21.1 and AMMC tools into `tools/` → `npm run deploy` → zip `deploy/*` → GitHub release with the ZIP as asset.
- Second job `docker-leaderboard` (`ubuntu-latest`): builds `docker/leaderboard/Dockerfile` for `linux/amd64` and `linux/arm64` and pushes `ghcr.io/<owner>/raceoffice-leaderboard` with the tags `<version>`, `<major>.<minor>` and `latest` (tag `v1.2.3` → `1.2.3`). It uses the workflow's `GITHUB_TOKEN` (`packages: write`). After the first push the package is private on GitHub; make it public once in the package settings if machines should pull it without login.
- The release workflow does not run the tests. Make sure `ci.yml` is green on the tagged commit.

### Dependabot

- `.github/dependabot.yml`: weekly npm updates (Monday 09:00 Europe/Berlin), at most 5 open PRs.
- Groups: `dev-tooling` (vitest, typescript, tsx, vite, eslint, …), `mui` (`@mui/*`, `@emotion/*`), `react`.
- Major updates of `better-sqlite3` / `@types/better-sqlite3` are ignored. v13 ships prebuilt binaries, but `npm ci` still runs `node-gyp`, which fails on machines without Python + C++ build tools. Revisit when that is fixed upstream; `apps/server/test/docStore.test.ts` covers the persistence layer for that upgrade.
- Major updates of `typescript` are ignored. typescript-eslint 8.x requires TypeScript `<6.1` and refuses to load with TS 7, so the lint step fails (seen in the dev-tooling PR #46). Remove the entry once typescript-eslint supports TS 7; typecheck and install already pass with TS 7.
