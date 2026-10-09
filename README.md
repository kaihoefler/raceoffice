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
- [Tests & Qualitätssicherung](#tests--qualitätssicherung)
- [CI & Releases](#ci--releases)
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

- Node.js 22, empfohlen `22.21.1` (siehe [`.nvmrc`](.nvmrc)). Mit dieser Version laufen CI und das im Release gebündelte `node.exe`. Das `engines`-Minimum in [`package.json`](package.json) (`>=20.19.0`) wird nicht getestet.
- npm

### 2) Install dependencies

```sh
npm install      # bzw. `npm ci` für eine exakt reproduzierbare Installation aus der package-lock.json
```

Die Root-[`.npmrc`](.npmrc) setzt `legacy-peer-deps=true`. Das ist nötig, weil npm bei den optionalen Peer-Dependencies von vitest 5 sonst abstürzt. Kein zusätzliches Flag nötig.

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

## Tests & Qualitätssicherung

Vor und nach jedem Dependency-Update genügt ein Befehl:

```sh
npm run verify   # typecheck → lint → test:all → build:all
```

| Skript | Inhalt |
|---|---|
| `npm run typecheck` | baut `domain` + `p3parser`, dann `typecheck` in jedem Workspace (`tsc -b` bzw. `tsc --noEmit`) |
| `npm run lint` | ESLint für `apps/frontend` |
| `npm run test:all` | baut `domain` + `p3parser`, dann `test:run` in **jedem** Workspace, der das Skript hat |
| `npm run build:all` | alle Pakete, Server, Worker und alle drei Frontends |

Wo die Tests liegen:

| Workspace | Tests | Runner |
|---|---|---|
| `packages/domain` | `src/**/*.test.ts` (Ergebnisse, Activities, Livetracking-Engine) | vitest |
| `packages/p3parser` | `test/*.test.mjs` (Golden-Tests gegen `dist`) | `node --test` |
| `apps/server` | `test/*.test.ts` (Realtime-Protokoll über echte WebSocket-/SSE-Verbindungen, Static-Serving, DocStore/SQLite, Race-Result-Export, Worker-Manager) | vitest |
| `apps/livetracking-worker` | `src/**/*.test.ts` | vitest |
| `apps/frontend` | `src/**/*.test.ts(x)`: reine Logik (u.a. Live-Scoring-Regeln) und Komponententests echter Seiten (jsdom) | vitest |
| `apps/livetracking-frontend` | `src/**/*.test.ts(x)`: reine Logik und Komponententests (jsdom) | vitest |
| `packages/test-utils` | – (Hilfen für Komponententests: Fake-Realtime-Server, Live-Feed-Schritte, Setup) | – |
| `packages/race-status-mock` | `test/*.test.ts` (Mock des Zeitmess-Feeds) | vitest |

### Zeitmess-Feed ohne Zeitmessanlage

Das Scoring hängt stark am Live-Feed der Zeitmessung (`http://localhost:8080/races?filter=current`). Für Entwicklung und manuelle Tests:

```sh
npm run mock:race-status                                      # Port 8080, "kein aktives Rennen"
npm run mock:race-status -- --recording <datei.jsonl> --speed 4   # aufgezeichnetes Rennen abspielen
npm run record:race-status -- --url http://<zeitmessung>:8080/races?filter=current --out packages/race-status-mock/recordings/<name>.jsonl --anonymize
```

Einen Stand setzt man per `PUT http://127.0.0.1:8080/__mock/frame` mit `{"race": {...}}`. Details: [`doc/architecture.md`](doc/architecture.md) (Abschnitt 6) und [`packages/race-status-mock/recordings/README.md`](packages/race-status-mock/recordings/README.md).

Hinweise:
- Der Integrationstest `apps/livetracking-worker/src/ammcProcessManager.test.ts` braucht die AMMC-Programme unter `tools/ammc/` (nicht im Git). Fehlen sie, wird er übersprungen. Mit `RACEOFFICE_REQUIRE_AMMC=1` wird das Fehlen zum Fehler.
- In ESLint stehen Regeln mit Altlasten (z.B. `no-explicit-any`, einige `react-hooks`-Regeln) vorerst auf `warn`, siehe [`apps/frontend/eslint.config.js`](apps/frontend/eslint.config.js). Alle anderen Regeln brechen den Lauf ab.

---

## CI & Releases

| Workflow | Auslöser | Was passiert |
|---|---|---|
| [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | Push auf `main`, jeder Pull Request | Ubuntu, Node 22.21.1: `npm ci` → `typecheck` → `lint` → `test:all` → `build:all` |
| [`.github/workflows/release.yml`](.github/workflows/release.yml) | Tag `v*` | Windows: `npm ci`, lädt WinSW, portables `node.exe` (22.21.1) und AMMC-Tools, `npm run deploy`, ZIP als GitHub-Release |

[Dependabot](.github/dependabot.yml) öffnet wöchentlich (montags) Update-PRs. Gruppen: `dev-tooling`, `mui`, `react`. Major-Updates von `better-sqlite3` sind ausgenommen, weil v13 bei `npm ci` ohne C++-Toolchain scheitert. Jeder Dependabot-PR durchläuft `ci.yml`. Ein grüner Lauf heißt: Typecheck, Lint, Tests und Build sind mit der neuen Version in Ordnung.

Details: [`doc/build-and-deploy.md`](doc/build-and-deploy.md#continuous-integration--releases).

---

## Run in production mode

Alle Artefakte bauen (die Pakete `domain` und `p3parser` werden automatisch zuerst gebaut):

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
  race-status-mock/       Mock + Recorder für den Live-Feed der Zeitmessung (Tests, manuelles Testen)
  test-utils/             Hilfen für Komponententests der Frontends (Fake-Realtime-Server, Setup)

doc/                      Projektdokumentation
scripts/                  deploy.mjs (Deploy-Ordner für Windows-Service)
.github/                  CI-/Release-Workflows und Dependabot
```
