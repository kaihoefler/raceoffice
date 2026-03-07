# RaceOffice – Build & Deploy Guide

This guide focuses on build, production run, deployment folder creation, and Windows service setup.

---

## Prerequisites

- Node.js (recommended: current LTS) + npm
- For Windows Service installation: elevated (Administrator) shell

---

## Install dependencies

This repository contains **two** npm projects: the root SPA and the backend in `server_own/`.

```sh doc/build-and-deploy.md
npm install
npm --prefix server_own install
```

---

## Development build/run (reference)

Run backend + frontend in separate terminals.

Backend:

```sh doc/build-and-deploy.md
npm --prefix server_own run dev
```

Frontend:

```sh doc/build-and-deploy.md
npm run dev
```

The Vite dev server proxies `/ws`, `/sse` and `/health` to `http://localhost:8787` (see `vite.config.ts`).

---

## Production build (server serves the SPA)

The backend serves static files from `server_own/public` (configured via `@fastify/static`).

Build everything:

```sh doc/build-and-deploy.md
npm run build:all
```

Run server:

```sh doc/build-and-deploy.md
npm --prefix server_own run start -- --host 0.0.0.0 --port 8787 --db "C:\\ProgramData\\RaceOffice\\data\\raceoffice.db"
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
- `deploy/server/public/` (built SPA)
- `deploy/server/node_modules/` (production dependencies)
- `deploy/server/RaceOfficeServer.xml` (WinSW service config; auto-generated if missing)
- `deploy/DEPLOY-NEXT-STEPS.txt`

Optional (recommended for copy-only installs):
- portable Node at `tools/node/node.exe` (copied to `deploy/server/node/node.exe`)
- WinSW at `tools/winsw/RaceOfficeServer.exe` (and optionally `RaceOfficeServer.xml`)

---

## Server configuration (CLI / ENV)

Backend configuration (`server_own/src/index.ts`) is read in this order:

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
