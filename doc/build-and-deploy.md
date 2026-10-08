# RaceOffice – Build & Deploy Guide

This guide focuses on build, production run, deployment folder creation, and Windows service setup.

---

## Prerequisites

- Node.js (recommended: current LTS) + npm
- For Windows Service installation: elevated (Administrator) shell

---

## Install dependencies

This repository uses npm workspaces (`apps/*`, `packages/*`): `frontend`, `livetracking-frontend`, `p3test-frontend`, `server`, `livetracking-worker`, `domain`, `p3parser`.

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

## Continuous Integration & Releases

### `ci.yml`: checks on every push and pull request

- Trigger: push to `main` and every pull request (Dependabot PRs included). A newer run on the same ref cancels the running one.
- Runner: `ubuntu-latest`, Node `22.21.1` (same version as the runtime bundled in releases), npm cache enabled.
- Steps: `npm ci` → `npm run typecheck` → `npm run lint` → `npm run test:all` → `npm run build:all`.
- `npm run verify` runs the same sequence locally (except `npm ci`).
- The AMMC integration test is skipped on CI because the AMMC binaries are not in the repository.

### `release.yml`: release on tag

- Trigger: pushing a tag `v*`.
- Runner: `windows-latest`, Node `22.21.1`. The build-time Node matches the bundled `node.exe`, so native modules (`better-sqlite3`) target the same ABI.
- Steps: `npm ci` → download WinSW, portable `node.exe` 22.21.1 and AMMC tools into `tools/` → `npm run deploy` → zip `deploy/*` → GitHub release with the ZIP as asset.
- The release workflow does not run the tests. Make sure `ci.yml` is green on the tagged commit.

### Dependabot

- `.github/dependabot.yml`: weekly npm updates (Monday 09:00 Europe/Berlin), at most 5 open PRs.
- Groups: `dev-tooling` (vitest, typescript, tsx, vite, eslint, …), `mui` (`@mui/*`, `@emotion/*`), `react`.
- Major updates of `better-sqlite3` / `@types/better-sqlite3` are ignored. v13 ships prebuilt binaries, but `npm ci` still runs `node-gyp`, which fails on machines without Python + C++ build tools. Revisit when that is fixed upstream; `apps/server/test/docStore.test.ts` covers the persistence layer for that upgrade.
