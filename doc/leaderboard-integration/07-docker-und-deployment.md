# 07 – Docker und Deployment

Stand: umgesetzt in P6. Beide Wege liefern dasselbe **Single-File-Bundle** aus.

## 0. Bundle

`npm run bundle:leaderboard-service` baut Frontend und Service. Danach erzeugt `apps/leaderboard-service/scripts/bundle.mjs` mit esbuild den Ordner `apps/leaderboard-service/bundle/`:

| Datei | Inhalt |
|---|---|
| `dist/index.js` | Service, `@raceoffice/domain`, `@raceoffice/rmonitor`, fastify & Co. in einer ESM-Datei (~2,6 MB, nicht minifiziert, damit Stacktraces lesbar bleiben) |
| `public/` | Leaderboard-Frontend (`/ui/`) |
| `package.json` | Name, Version, `"type": "module"` |
| `LICENSE` | GPL-3.0-or-later |

Entscheidungen:
- **Keine `node_modules` zur Laufzeit.** Alle Abhängigkeiten sind reines JavaScript. Die optionalen nativen Beschleuniger von `ws` (`bufferutil`, `utf-8-validate`) bleiben außen vor, `ws` arbeitet ohne sie.
- **Gleiches Layout wie der tsc-Build** (`dist/` neben `public/`). Deshalb findet der `LeaderboardServiceManager` den Service im Deploy-Ordner ohne Codeänderung.
- Die Version wird beim Bündeln eingesetzt (`__LEADERBOARD_VERSION__`).
- CI startet das Bundle einmal mit `--version`. So fallen Abhängigkeiten auf, die gebündelt nicht mehr laden.

## 1. Docker-Image (Modus B, headless)

Das Image ist ein vollständiger Ersatz für die Java-App: gleicher Port (8080), gleiche REST-Pfade, Java-CLI-Flags als Argumente, Verbindung zu Orbits per ENV.

**Dateien:**
- `docker/leaderboard/Dockerfile`, Build-Kontext ist das Repo-Root (npm-Workspaces).
- `.dockerignore` als Allowlist: Manifeste aller Workspaces (die braucht `npm ci`) und die Quellen von `domain`, `rmonitor`, `leaderboard-service` und `leaderboard-frontend`. Das Repo ist mit `tools/` und `deploy/` mehrere GB groß.
- `docker/leaderboard/docker-compose.yml` als Beispiel.

**Aufbau:**
- **Build-Stage** (`node:22-bookworm-slim`, `--platform=$BUILDPLATFORM`):
  - `npm ci` nur für die vier Workspaces
  - `domain` und `rmonitor` bauen
  - `npm run bundle:leaderboard-service`

  Sie läuft nur einmal auf der Plattform des Build-Rechners. Das Bundle ist plattformunabhängig, deshalb braucht der Multi-Arch-Build kein emuliertes `npm ci`.
- **Runtime-Stage** (`node:22-alpine`):
  - kopiert nur `bundle/` nach `/app`
  - `LEADERBOARD_HOST=0.0.0.0`, `LEADERBOARD_PORT=8080`, `LEADERBOARD_DATA_DIR=/data` (Volume, gehört `node`)
  - läuft als `USER node`
  - `HEALTHCHECK` auf `/health`, `ENTRYPOINT ["node", "dist/index.js"]`
  - Image etwa 240 MB, fast alles davon ist das Node-Basisimage.

**Start:**

```bash
docker run -d --name leaderboard -p 8080:8080 -v leaderboard-data:/data \
  -e RMONITOR_HOST=192.168.1.20 -e RMONITOR_PORT=50000 -e AUTOCONNECT=true \
  ghcr.io/kaihoefler/raceoffice-leaderboard:latest
# oder mit CLI-Flags wie bei der Java-App:
docker run … ghcr.io/kaihoefler/raceoffice-leaderboard -c --host 192.168.1.20 --port 50000
```

Lokal getestet:
- Healthcheck „healthy“
- UI unter `/ui/`
- Upload eines Recordings ins Volume und Wiedergabe mit Umlauten
- Java-Flags
- arm64-Image unter Emulation (`--version`)

**Netzwerkhinweise**
- Orbits läuft unter Windows. Der Container verbindet sich **von innen nach außen** zu `RMONITOR_HOST:50000`; dafür ist kein Port-Mapping nötig.
- Läuft Orbits auf dem Docker-Host selbst, z. B. bei Docker Desktop unter Windows: `RMONITOR_HOST=host.docker.internal`.
- Die Windows-Firewall auf dem Orbits-Rechner muss eingehende Verbindungen auf Port 50000 erlauben, wie bisher bei der Java-App.
- RaceOffice nutzt den Container als externe Quelle: `--leaderboard-mode external --leaderboard-url http://<host>:8080` oder im Scoring über den Dialog „Live-Quelle“.

---

## 2. Modus A im bestehenden Windows-Deployment

`scripts/deploy.mjs`:
- führt nach `npm run build:all` das Bündeln aus
- kopiert `bundle/` nach `deploy/apps/leaderboard-service/`, analog zu `deploy/apps/livetracking-worker`, aber ohne `npm ci`
- `DEPLOY-NEXT-STEPS.txt` prüft, ob Service und UI vorhanden sind, und nennt die URL `/leaderboard/ui/`.

Weitere Punkte:
- Der Server ermittelt das Deploy-Root wie beim Livetracking-Worker und startet `apps/leaderboard-service/dist/index.js` im Modus `managed` (Default, Autostart).
- An den WinSW-Argumenten ändert sich nichts.
- Datenverzeichnis: Ordner `leaderboard` neben der Datenbank, also `C:\ProgramData\RaceOffice\data\leaderboard` (Konfiguration und Recordings).

Beschrieben in `doc/build-and-deploy.md`, Abschnitt „Leaderboard service“.

**Merke:** Wie beim Livetracking-Worker hat `dist` Vorrang vor `tsx`. Nach Änderungen am Service muss er also neu gebaut werden: `npm run build:leaderboard-service`.

---

## 3. CI / Release

- `.github/workflows/ci.yml`: Typecheck, Tests (inkl. Golden-Tests und Service-Integrationstests), `build:all`, dazu der Bundle-Smoke-Test.
- `.github/workflows/release.yml` beim Tag `v*`:
  - Job `build-release` (Windows): Das Release-ZIP enthält den Service für Modus A.
  - Job `docker-leaderboard` (Ubuntu):
    - Buildx für `linux/amd64` und `linux/arm64`
    - Push nach `ghcr.io/<owner>/raceoffice-leaderboard` mit den Tags `<version>`, `<major>.<minor>` und `latest`
    - Anmeldung über `GITHUB_TOKEN` (`packages: write`)
    - Nach dem ersten Push ist das Paket auf GitHub privat. Es muss einmalig in den Paket-Einstellungen öffentlich geschaltet werden, wenn Geräte ohne Login ziehen sollen.

## Lizenz

`packages/rmonitor`, `apps/leaderboard-service` und `apps/leaderboard-frontend` stehen unter **GPL-3.0-or-later**, wie das Original RMonitorLeaderboard. Jedes der drei Pakete hat eine eigene `LICENSE`, und das Bundle trägt sie mit. Der übrige Teil von RaceOffice ist davon nicht berührt: Der Server startet den Service als eigenen Prozess und spricht nur über HTTP/WS mit ihm.

Bundle und Frontend enthalten allerdings `@raceoffice/domain`. Wer sie weitergibt, gibt diesen Code damit unter der GPL weiter.

---

## 4. Ablösung der Java-App

| Schritt | Beschreibung |
|---|---|
| 1. Parallelbetrieb | Java-App und TS-Service hängen gleichzeitig an Orbits. Orbits bedient mehrere Clients gleichzeitig (bestätigt). |
| 2. Vergleich | Ein Skript pollt beide `/races?filter=current` und loggt Abweichungen (Diff pro Feld) über eine komplette Veranstaltung. *Noch nicht gebaut; die Golden-Tests über 15 Wettkampftage decken den Vergleich offline ab.* |
| 3. Umschalten Scoring | `RaceStatusProvider` zeigt auf `/leaderboard/races?filter=current` bzw. auf den Container; WS-Transport aktiv. |
| 4. Abschalten | Java-App wird nicht mehr gestartet. Recordings der Java-App lassen sich per Upload im Control Center weiterverwenden. |
| 5. Aufräumen | Hinweise auf `localhost:8080`/RMonitorLeaderboard in Doku und Defaults ersetzen. |
