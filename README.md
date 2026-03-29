# RaceOffice

RaceOffice consists of:

- **Frontend SPA**: React + TypeScript + Vite
- **Backend**: Fastify + WebSockets + SQLite (`server_own/`)

## Table of contents

- [Documentation](#documentation)
  - [Server protocol details](#server-protocol-details)
- [Quick start (Windows & macOS)](#quick-start-windows--macos)
  - [1) Prerequisites](#1-prerequisites)
  - [2) Install dependencies](#2-install-dependencies)
  - [3) Run in development](#3-run-in-development)
- [Run in production mode (local/server)](#run-in-production-mode-localserver)
  - [Windows (PowerShell)](#windows-powershell)
  - [macOS (zsh/bash)](#macos-zshbash)
- [Windows Service / deployment](#windows-service--deployment)
- [Project structure (short)](#project-structure-short)

## Documentation

- Architecture details: [`doc/architecture.md`](doc/architecture.md)
- Build & deploy guide (including WinSW): [`doc/build-and-deploy.md`](doc/build-and-deploy.md)
- Visualization skipped-row indicator: [`doc/visualization.md`](doc/visualization.md)
- Server API/protocol and error handling: [`doc/server.md`](doc/server.md)

---

## Server protocol details

For realtime message formats, revision handling, and unified server error responses, see:

- [`doc/server.md`](doc/server.md)

---

## Quick start (Windows & macOS)

### 1) Prerequisites

- Node.js (current LTS recommended)
- npm

### 2) Install dependencies

> Repository contains two npm projects (root + `server_own/`).

```sh
npm install
npm --prefix server_own install
```

### 3) Run in development

Use two terminals.

**Terminal A (backend):**

```sh
npm --prefix server_own run dev
```

**Terminal B (frontend):**

```sh
npm run dev
```

Open the frontend URL shown by Vite (usually `http://localhost:5173`).

Notes:
- Vite proxies `/ws`, `/sse` and `/health` to backend `http://localhost:8787`.

---

## Run in production mode (local/server)

Build all artifacts:

```sh
npm run build:all
```

Start backend (serves API + SPA):

### Windows (PowerShell)

```powershell
npm --prefix server_own run start -- --host 0.0.0.0 --port 8787 --db "C:\ProgramData\RaceOffice\data\raceoffice.db"
```

### macOS (zsh/bash)

```sh
npm --prefix server_own run start -- --host 0.0.0.0 --port 8787 --db "./data/raceoffice.db"
```

Open:
- UI: `http://<server-host>:8787/`
- Health: `http://<server-host>:8787/health`

---

## Windows Service / deployment

For deployment folder generation, WinSW service installation, and advanced config options, see:

- [`doc/build-and-deploy.md`](doc/build-and-deploy.md)

---

## Project structure (short)

- `src/` – frontend SPA
- `server_own/` – backend server
- `doc/` – project documentation
- `examples/` – sample data/assets

