# RaceOffice

RaceOffice besteht aus:

- **Frontend** (`apps/frontend/`) – Hauptanwendung: Eventmanagement, Scoring, Ergebnisse, Visualisierungen
- **Livetracking Frontend** (`apps/livetracking-frontend/`) – Zeitmessung (Control Center, Decoder, Simulation, Setups) und Livetracking (Messung, Live-Board, Visualisierung)
- **Leaderboard Frontend** (`apps/leaderboard-frontend/`) – Rangliste, Control Center, Start Signal, Lap Counter, Finish Line Log
- **P3 Test Client** (`apps/p3test-frontend/`) – Diagnose-UI für MYLAPS P3 Decoder
- **Backend** (`apps/server/`) – Fastify + WebSockets + SQLite, Passing-Store der Zeitmessung, startet Worker und Leaderboard-Service
- **Livetracking Worker** (`apps/livetracking-worker/`) – Hardware-Anbindung der Zeitmessung: verbindet P3- und AMMC-Decoder, betreibt den Decoder-Simulator, lädt Passings hoch
- **Leaderboard Service** (`apps/leaderboard-service/`) – Headless-Ersatz für die Java-App RMonitorLeaderboard: empfängt den RMonitor-Stream von Orbits, REST (Java-kompatibel) + WebSocket, Recorder, Player
- **Domain Package** (`packages/domain/`) – Gemeinsame Typen und Logik
- **P3 Parser Package** (`packages/p3parser/`) – MYLAPS P3 Protokoll-Parser und Client API
- **RMonitor Package** (`packages/rmonitor/`) – RMonitor-Parser und Rennzustand, portiert aus RMonitorLeaderboard

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
- [Leaderboard als Docker-Container](#leaderboard-als-docker-container)
- [Project structure](#project-structure)
- [Lizenz](#lizenz)

## Documentation

- Architecture details: [`doc/architecture.md`](doc/architecture.md)
- Zeitmess-Architektur (Decoder-Register, Passing-Store, Setups, Messung): [`doc/timing-architecture.md`](doc/timing-architecture.md)
- Leaderboard-Service (Ablösung von RMonitorLeaderboard): [`doc/leaderboard-integration/`](doc/leaderboard-integration/README.md)
- Build & deploy guide (including WinSW and Docker): [`doc/build-and-deploy.md`](doc/build-and-deploy.md)
- Server API/protocol and error handling: [`doc/server.md`](doc/server.md)
- Visualization skipped-row indicator: [`doc/visualization.md`](doc/visualization.md)
- P3 test client notes (decoder-id byte order, session/resend): [`doc/p3test-client-notes.md`](doc/p3test-client-notes.md)
- P3 Parser & Client API: [`packages/p3parser/README.md`](packages/p3parser/README.md)
- RMonitor-Parser: [`packages/rmonitor/README.md`](packages/rmonitor/README.md), Leaderboard-Service: [`apps/leaderboard-service/README.md`](apps/leaderboard-service/README.md)

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
| Leaderboard (über den Proxy des Frontends) | `http://localhost:5173/leaderboard/ui/` |

- **Leaderboard-Service:** Der Server startet ihn selbst (Modus `managed`, Autostart) und leitet ihn unter `/leaderboard/*` weiter. Abschalten mit `LEADERBOARD_AUTOSTART=false` oder `--leaderboard-mode off`.
- **Livetracking Worker:** Er wird im Timing Control Center (`/livetracking/timing/control`) gestartet und gestoppt; der Server startet den Prozess. Decoder verbinden sich nicht automatisch, sondern erst über „verbinden“ im Control Center.
- **Wichtig:** Server, Worker und Leaderboard-Service starten `dist/index.js`, wenn vorhanden, und nur sonst die Quellen mit `tsx`. Nach Änderungen an Worker oder Service deshalb neu bauen: `npm run build:livetracking-worker` bzw. `npm run build:leaderboard-service`.

#### Dienste einzeln starten

```sh
npm run dev:server                  # Backend auf Port 8787
npm run dev                         # Hauptfrontend auf Port 5173
npm run dev:livetracking-frontend   # Livetracking UI auf Port 5174
npm run dev:p3test-frontend         # P3 Test Client auf Port 5175
npm run dev:livetracking-worker     # Livetracking Worker direkt (zum Debuggen)
npm run dev:leaderboard-service     # Leaderboard-Service direkt auf Port 8080
npm run dev:leaderboard-frontend    # Leaderboard UI auf Port 5176 (gegen den Service auf :8080)
```

Vite proxiert `/ws`, `/sse`, `/health`, `/leaderboard` und `/leaderboard-service` an das Backend `http://localhost:8787`.

---

## Tests & Qualitätssicherung

Vor und nach jedem Dependency-Update genügt ein Befehl:

```sh
npm run verify   # typecheck → lint → test:all → build:all
```

| Skript | Inhalt |
|---|---|
| `npm run typecheck` | baut die Pakete (`build:packages`), dann `typecheck` in jedem Workspace (`tsc -b` bzw. `tsc --noEmit`) |
| `npm run lint` | ESLint für `apps/frontend` |
| `npm run test:all` | baut die Pakete, dann `test:run` in **jedem** Workspace, der das Skript hat |
| `npm run build:all` | alle Pakete, Server, Worker, Leaderboard-Service und alle vier Frontends |
| `npm run bundle:leaderboard-service` | Leaderboard-Service als Ein-Datei-Bundle nach `apps/leaderboard-service/bundle/` (für Release und Docker) |

Wo die Tests liegen:

| Workspace | Tests | Runner |
|---|---|---|
| `packages/domain` | `src/**/*.test.ts` (Ergebnisse, Activities, Livetracking-Engine, Zeitmess-Ebene) | vitest |
| `packages/p3parser` | `test/*.test.mjs` (Golden-Tests gegen `dist`) | `node --test` |
| `packages/rmonitor` | `test/*.test.ts` (Parser, Rennzustand, Golden-Tests gegen Referenz-Snapshots der Java-App) | vitest |
| `apps/server` | `test/*.test.ts` (Realtime-Protokoll über echte WebSocket-/SSE-Verbindungen, Static-Serving, DocStore/SQLite, Passing-Store, Race-Result-Export, Worker- und Leaderboard-Manager, Proxy) | vitest |
| `apps/livetracking-worker` | `src/**/*.test.ts` | vitest |
| `apps/leaderboard-service` | `test/*.test.ts` (REST/WS über echte TCP-Verbindungen zum Fake-Orbits-Feeder, Recorder, Player, Token) | vitest |
| `apps/frontend` | `src/**/*.test.ts(x)`: reine Logik (u.a. Live-Scoring-Regeln) und Komponententests echter Seiten (jsdom) | vitest |
| `apps/livetracking-frontend` | `src/**/*.test.ts(x)`: reine Logik und Komponententests (jsdom) | vitest |
| `apps/leaderboard-frontend` | `src/test/*.test.tsx`: Komponententests (jsdom) | vitest |
| `packages/test-utils` | – (Hilfen für Komponententests: Fake-Realtime-Server, Live-Feed-Schritte, Setup) | – |
| `packages/race-status-mock` | `test/*.test.ts` (Mock des Zeitmess-Feeds) | vitest |

### Zeitmess-Feed ohne Zeitmessanlage

Das Scoring hängt stark am Live-Feed der Zeitmessung. Die Quelle wählt man im Scoring (Dialog „Live-Quelle“): Standard ist „Automatisch“, also der Leaderboard-Service per WebSocket und ohne ihn die klassische URL `http://localhost:8080/races?filter=current` per Polling.

Ohne Orbits gibt es zwei Wege:

- **Recording im Leaderboard abspielen:** Im Leaderboard Control Center (`/leaderboard/ui/#/control`) eine RMonitor-Aufnahme hochladen und mit dem Player abspielen (Tempo, Seek, Lücken überspringen). Das Scoring sieht das als REPLAY.
- **Feed-Mock** (JSON-Frames, unabhängig vom Leaderboard):

```sh
npm run mock:race-status                                      # Port 8080, "kein aktives Rennen"
npm run mock:race-status -- --recording <datei.jsonl> --speed 4   # aufgezeichnetes Rennen abspielen
npm run record:race-status -- --url http://<zeitmessung>:8080/races?filter=current --out packages/race-status-mock/recordings/<name>.jsonl --anonymize
```

Einen Stand setzt man per `PUT http://127.0.0.1:8080/__mock/frame` mit `{"race": {...}}`. Details: [`doc/architecture.md`](doc/architecture.md) (Abschnitt 6) und [`packages/race-status-mock/recordings/README.md`](packages/race-status-mock/recordings/README.md).

Für die Zeitmessung (Livetracking) ersetzt der **Decoder-Simulator** die Hardware: Decoder-Seite, Tab „Simulation“. Er braucht `ammc-sim` unter `tools/ammc/`.

Hinweise:
- Der Integrationstest `apps/livetracking-worker/src/ammcProcessManager.test.ts` braucht die AMMC-Programme unter `tools/ammc/` (nicht im Git). Fehlen sie, wird er übersprungen. Mit `RACEOFFICE_REQUIRE_AMMC=1` wird das Fehlen zum Fehler.
- In ESLint stehen Regeln mit Altlasten (z.B. `no-explicit-any`, einige `react-hooks`-Regeln) vorerst auf `warn`, siehe [`apps/frontend/eslint.config.js`](apps/frontend/eslint.config.js). Alle anderen Regeln brechen den Lauf ab.

---

## CI & Releases

| Workflow | Auslöser | Was passiert |
|---|---|---|
| [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | Push auf `main`, jeder Pull Request | Ubuntu, Node 22.21.1: `npm ci` → `typecheck` → `lint` → `test:all` → `build:all` → Leaderboard-Bundle bauen und starten (Smoke-Test) |
| [`.github/workflows/release.yml`](.github/workflows/release.yml) | Tag `v*` | **Windows:** `npm ci`, lädt WinSW, portables `node.exe` (22.21.1) und AMMC-Tools, `npm run deploy`, ZIP als GitHub-Release. **Docker:** Leaderboard-Image `ghcr.io/kaihoefler/raceoffice-leaderboard` für amd64 und arm64. |

Der Release-Workflow führt keine Tests aus: Vor dem Tag muss `ci.yml` auf dem Commit grün sein.

[Dependabot](.github/dependabot.yml) öffnet wöchentlich (montags) Update-PRs. Gruppen: `dev-tooling`, `mui`, `react`. Ausgenommen sind Major-Updates von `better-sqlite3` (v13 scheitert bei `npm ci` ohne C++-Toolchain) und von `typescript` (typescript-eslint unterstützt TS 7 noch nicht, der Lint bricht ab). Jeder Dependabot-PR durchläuft `ci.yml`. Ein grüner Lauf heißt: Typecheck, Lint, Tests und Build sind mit der neuen Version in Ordnung.

Details: [`doc/build-and-deploy.md`](doc/build-and-deploy.md#continuous-integration--releases).

---

## Run in production mode

Alle Artefakte bauen (die Pakete werden automatisch zuerst gebaut):

```sh
npm run build:all
```

Backend starten (serviert API + alle SPAs, startet den Leaderboard-Service):

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
| `http://<host>:8787/livetracking/` | Livetracking Frontend (Zeitmessung + Livetracking) |
| `http://<host>:8787/leaderboard/ui/` | Leaderboard Frontend (Rangliste, Control Center, weitere Sichten) |
| `http://<host>:8787/leaderboard/races?filter=current` | Leaderboard REST, kompatibel zur Java-App |
| `http://<host>:8787/p3test/` | P3 Test Client |
| `http://<host>:8787/health` | Health Check |

Daten des Leaderboard-Service (Konfiguration, Recordings) liegen im Ordner `leaderboard` neben der Datenbank.

---

## Windows Service / deployment

`npm run deploy` erzeugt den Deploy-Ordner mit Server, Worker und Leaderboard-Service (als Ein-Datei-Bundle). Für WinSW-Service-Installation und erweiterte Konfiguration:

- [`doc/build-and-deploy.md`](doc/build-and-deploy.md)

---

## Leaderboard als Docker-Container

Für einen eigenen Rechner an der Strecke (NAS, Raspberry Pi, Linux) gibt es den Leaderboard-Service als Image. Er ersetzt die Java-App direkt: Port 8080, gleiche REST-Pfade, Java-Kommandozeilenoptionen funktionieren.

```sh
docker run -d --name leaderboard -p 8080:8080 -v leaderboard-data:/data \
  -e RMONITOR_HOST=192.168.1.20 -e AUTOCONNECT=true \
  ghcr.io/kaihoefler/raceoffice-leaderboard:latest
```

- Lokal bauen: `docker build -f docker/leaderboard/Dockerfile -t raceoffice-leaderboard .`
- Compose-Beispiel: [`docker/leaderboard/docker-compose.yml`](docker/leaderboard/docker-compose.yml)
- RaceOffice nutzt den Container als externe Quelle: `--leaderboard-mode external --leaderboard-url http://<host>:8080`.

Details: [`doc/leaderboard-integration/07-docker-und-deployment.md`](doc/leaderboard-integration/07-docker-und-deployment.md).

---

## Project structure

```
apps/
  frontend/               Hauptanwendung (Eventmanagement, Scoring, Ergebnisse)
  livetracking-frontend/  Zeitmessung (Control Center, Decoder, Setups) und Livetracking
  livetracking-worker/    Hardware-Anbindung der Zeitmessung (P3, AMMC, Simulator)
  leaderboard-frontend/   Leaderboard-Sichten und Control Center
  leaderboard-service/    Headless-Leaderboard (RMonitor → REST/WebSocket), Ersatz für RMonitorLeaderboard
  p3test-frontend/        Diagnose-UI für P3 Decoder
  server/                 Fastify Backend (API, WebSockets, SQLite, Passing-Store)

packages/
  domain/                 Gemeinsame Typen und Logik (Events, Races, Livetracking, Zeitmessung)
  p3parser/               MYLAPS P3 Protokoll-Parser und Client API
  rmonitor/               RMonitor-Parser und Rennzustand (Port von RMonitorLeaderboard)
  race-status-mock/       Mock + Recorder für den Live-Feed der Zeitmessung (Tests, manuelles Testen)
  test-utils/             Hilfen für Komponententests der Frontends (Fake-Realtime-Server, Setup)

docker/leaderboard/       Dockerfile und Compose-Beispiel für den Leaderboard-Service
doc/                      Projektdokumentation
scripts/                  deploy.mjs (Deploy-Ordner für Windows-Service)
.github/                  CI-/Release-Workflows und Dependabot
```

---

## Lizenz

`packages/rmonitor`, `apps/leaderboard-service` und `apps/leaderboard-frontend` sind eine Portierung bzw. Weiterentwicklung von [RMonitorLeaderboard](https://github.com/bastianpaetzold/RMonitorLeaderboard) und stehen wie das Original unter der **GPL-3.0-or-later** (siehe die `LICENSE` in den drei Paketen). Für den übrigen Code gibt es bisher keine Lizenzdatei.
