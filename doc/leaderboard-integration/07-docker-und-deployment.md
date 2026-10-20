# 07 – Docker und Deployment

## 1. Docker-Image (Modus B, headless)

Das Image ist ein vollständiger Ersatz für die Java-App: gleicher Port (8080), gleiche REST-Pfade, Verbindung zu Orbits per ENV.

**Dockerfile:** `docker/leaderboard/Dockerfile`, Build-Kontext ist das Repo-Root, weil es npm-Workspaces nutzt.

```dockerfile
# ---- build ----
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/
COPY packages/rmonitor/package.json packages/rmonitor/
COPY apps/leaderboard-service/package.json apps/leaderboard-service/
COPY apps/leaderboard-frontend/package.json apps/leaderboard-frontend/
RUN npm ci --workspaces --include-workspace-root \
      -w packages/domain -w packages/rmonitor \
      -w apps/leaderboard-service -w apps/leaderboard-frontend
COPY packages/domain packages/domain
COPY packages/rmonitor packages/rmonitor
COPY apps/leaderboard-service apps/leaderboard-service
COPY apps/leaderboard-frontend apps/leaderboard-frontend
RUN npm run build -w packages/domain -w packages/rmonitor \
 && npm run build -w apps/leaderboard-frontend \
 && npm run build -w apps/leaderboard-service \
 && npm prune --omit=dev

# ---- runtime ----
FROM node:22-alpine
ENV NODE_ENV=production PORT=8080 LEADERBOARD_DATA_DIR=/data AUTOCONNECT=true
WORKDIR /app
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/domain/dist ./node_modules/@raceoffice/domain/dist
COPY --from=build /repo/packages/rmonitor/dist ./node_modules/@raceoffice/rmonitor/dist
COPY --from=build /repo/apps/leaderboard-service/dist ./dist
COPY --from=build /repo/apps/leaderboard-service/public ./public
VOLUME /data
EXPOSE 8080
USER node
HEALTHCHECK --interval=10s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/health || exit 1
ENTRYPOINT ["node", "dist/index.js"]
```

*Das Kopieren der Workspace-Pakete wird beim Implementieren präzisiert.* Alternativ wird der Service mit **esbuild/tsup zu einer Datei gebündelt** (keine nativen Abhängigkeiten nötig). Das vereinfacht Image und `deploy.mjs` erheblich und ist die Empfehlung.

**Start, Java-kompatibel:**

```bash
docker run -d --name leaderboard -p 8080:8080 -v leaderboard-data:/data \
  -e RMONITOR_HOST=192.168.1.20 -e RMONITOR_PORT=50000 \
  ghcr.io/<org>/raceoffice-leaderboard:1.0.0
# oder mit CLI-Flags wie bei der Java-App:
docker run … raceoffice-leaderboard --host 192.168.1.20 --port 50000 --server-port 8080
```

**`docker-compose.leaderboard.yml` (Beispiel):**

```yaml
services:
  leaderboard:
    image: raceoffice-leaderboard:latest
    build: { context: ., dockerfile: docker/leaderboard/Dockerfile }
    ports: ["8080:8080"]
    environment:
      RMONITOR_HOST: 192.168.1.20      # Orbits-Rechner
      RMONITOR_PORT: "50000"
      RMONITOR_ENCODING: windows-1252
      RECORDER_AUTOSTART: "true"
      # LEADERBOARD_CONTROL_TOKEN: change-me
    volumes: ["leaderboard-data:/data"]
    restart: unless-stopped
volumes:
  leaderboard-data:
```

**Netzwerkhinweise**
- Orbits läuft unter Windows. Der Container verbindet sich **von innen nach außen** zu `RMONITOR_HOST:50000`; dafür ist kein Port-Mapping nötig.
- Läuft Orbits auf dem Docker-Host selbst, z. B. bei Docker Desktop unter Windows: `RMONITOR_HOST=host.docker.internal`.
- Die Windows-Firewall auf dem Orbits-Rechner muss eingehende Verbindungen auf Port 50000 erlauben, wie bisher bei der Java-App.
- **Multi-Arch-Build** (`linux/amd64`, `linux/arm64`), damit das Image auch auf einem Raspberry Pi oder NAS an der Strecke läuft.

---

## 2. Modus A im bestehenden Windows-Deployment

`scripts/deploy.mjs` wird erweitert:
- Es baut `packages/rmonitor`, `apps/leaderboard-frontend` und `apps/leaderboard-service`.
- Es kopiert `apps/leaderboard-service/dist` (bzw. das Bundle) und `public` nach `deploy/apps/leaderboard-service`, analog zu `deploy/apps/livetracking-worker`.
- Der `LeaderboardServiceManager` findet den Service relativ zum Repo-/Deploy-Root, wie heute der Livetracking-Worker (`RACEOFFICE_REPO_ROOT`).
- Die WinSW-Service-Argumente werden optional um `--leaderboard-mode managed` ergänzt; das ist ohnehin der Default.
- Datenverzeichnis: `C:\ProgramData\RaceOffice\data\leaderboard` (Konfiguration und Recordings).

`doc/build-and-deploy.md` bekommt einen Abschnitt „Leaderboard-Service“ mit Verweis auf dieses Dokument.

**Merke:** Wie beim Livetracking-Worker hat `dist` Vorrang vor `tsx`. Nach Änderungen am Service muss er also neu gebaut werden: `npm run build --workspace=apps/leaderboard-service`.

---

## 3. CI / Release

- `.github/workflows/ci.yml`: Typecheck, Tests (`packages/rmonitor` inkl. Golden-Tests, Service-Integrationstests), Build des Frontends.
- `.github/workflows/release.yml`:
  - zusätzlicher Job `docker-leaderboard`: `docker buildx build --platform linux/amd64,linux/arm64`, Push nach `ghcr.io` mit Tag = Release-Version
  - das Windows-Release-Paket enthält den Service für Modus A

---

## 4. Ablösung der Java-App

| Schritt | Beschreibung |
|---|---|
| 1. Parallelbetrieb | Java-App und TS-Service hängen gleichzeitig an Orbits. Orbits bedient mehrere Clients gleichzeitig (bestätigt). |
| 2. Vergleich | Ein Skript pollt beide `/races?filter=current` und loggt Abweichungen (Diff pro Feld) über eine komplette Veranstaltung. |
| 3. Umschalten Scoring | `RaceStatusProvider` zeigt auf `/leaderboard/races?filter=current` bzw. auf den Container; WS-Transport aktiv. |
| 4. Abschalten | Java-App wird nicht mehr gestartet. Recordings der Java-App lassen sich per Upload im Control Center weiterverwenden. |
| 5. Aufräumen | Hinweise auf `localhost:8080`/RMonitorLeaderboard in Doku und Defaults ersetzen. |
