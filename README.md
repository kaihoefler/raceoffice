# RaceOffice

RaceOffice besteht aus:

- **Frontend** (`apps/frontend/`) – Hauptanwendung: Eventmanagement, Ergebnisse, Visualisierungen
- **Livetracking Frontend** (`apps/livetracking-frontend/`) – Eigenständige UI für Livetracking-Steuerung und Visualisierung
- **P3 Test Client** (`apps/p3test-frontend/`) – Diagnose-UI für MYLAPS P3 Decoder
- **Backend** (`apps/server/`) – Fastify + WebSockets + SQLite
- **Livetracking Worker** (`apps/livetracking-worker/`) – Zeitmess-Engine, verbindet sich mit P3 Decodern
- **Domain Package** (`packages/domain/`) – Gemeinsame Typen und Logik
- **P3 Parser Package** (`packages/p3parser/`) – MYLAPS P3 Protokoll-Parser und Client API

## Table of contents

- [Documentation](#documentation)
- [Quick start (Windows & macOS)](#quick-start-windows--macos)
  - [1) Prerequisites](#1-prerequisites)
  - [2) Install dependencies](#2-install-dependencies)
  - [3) Run in development](#3-run-in-development)
- [Run in production mode](#run-in-production-mode)
- [Windows Service / deployment](#windows-service--deployment)
- [Project structure](#project-structure)

## Documentation

- Architecture details: [`doc/architecture.md`](doc/architecture.md)
- Build & deploy guide (including WinSW): [`doc/build-and-deploy.md`](doc/build-and-deploy.md)
- Server API/protocol and error handling: [`doc/server.md`](doc/server.md)
- Visualization skipped-row indicator: [`doc/visualization.md`](doc/visualization.md)
- P3 test client notes (decoder-id byte order, session/resend): [`doc/p3test-client-notes.md`](doc/p3test-client-notes.md)
- P3 Parser & Client API: [`packages/p3parser/README.md`](packages/p3parser/README.md)

---

## Quick start (Windows & macOS)

### 1) Prerequisites

- Node.js `20.19.0` oder neuer (siehe [`.nvmrc`](.nvmrc) und [`package.json`](package.json) `engines`)
- npm

### 2) Install dependencies

```sh
npm install
```

### 3) Run in development

#### Alles auf einmal starten (empfohlen)

```sh
npm run dev:all
```

Startet parallel:

| Dienst | URL |
|---|---|
| Backend (Server + API) | `http://localhost:8787` |
| Frontend (Hauptanwendung) | `http://localhost:5173` |
| Livetracking Frontend | `http://localhost:5174/livetracking/` |
| P3 Test Client | `http://localhost:5175` |

> Der Livetracking Worker muss bei Bedarf separat gestartet werden (siehe unten).

#### Dienste einzeln starten

```sh
npm run dev:server                  # Backend auf Port 8787
npm run dev                         # Hauptfrontend auf Port 5173
npm run dev:livetracking-frontend   # Livetracking UI auf Port 5174
npm run dev:p3test-frontend         # P3 Test Client auf Port 5175
npm run dev:livetracking-worker     # Livetracking Worker (Zeitmess-Engine)
```

Vite proxiert `/ws`, `/sse` und `/health` an das Backend `http://localhost:8787`.

---

## Run in production mode

Alle Artefakte bauen (Domain-Package wird automatisch zuerst gebaut):

```sh
npm run build:all
```

Backend starten (serviert API + alle SPAs):

### Windows (PowerShell)

```powershell
npm run start:server -- --host 0.0.0.0 --port 8787 --db "C:\ProgramData\RaceOffice\data\raceoffice.db"
```

### macOS (zsh/bash)

```sh
npm run start:server -- --host 0.0.0.0 --port 8787 --db "./data/raceoffice.db"
```

Der Server serviert alle Frontends unter ihren jeweiligen Pfaden:

| URL | Inhalt |
|---|---|
| `http://<host>:8787/` | Hauptfrontend |
| `http://<host>:8787/livetracking/` | Livetracking Frontend |
| `http://<host>:8787/p3test/` | P3 Test Client |
| `http://<host>:8787/health` | Health Check |

---

## Windows Service / deployment

Für Deployment-Ordner-Generierung, WinSW-Service-Installation und erweiterte Konfiguration:

- [`doc/build-and-deploy.md`](doc/build-and-deploy.md)

---

## Project structure

```
apps/
  frontend/               Hauptanwendung (Eventmanagement, Ergebnisse)
  livetracking-frontend/  Eigenständige Livetracking UI
  livetracking-worker/    Zeitmess-Engine (P3 Decoder Anbindung)
  p3test-frontend/        Diagnose-UI für P3 Decoder
  server/                 Fastify Backend (API, WebSockets, SQLite)

packages/
  domain/                 Gemeinsame Typen und Logik (Events, Races, Livetracking)
  p3parser/               MYLAPS P3 Protokoll-Parser und Client API

doc/                      Projektdokumentation
```
