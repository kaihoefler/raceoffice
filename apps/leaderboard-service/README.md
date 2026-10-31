# @raceoffice/leaderboard-service

Headless-Ersatz für die Java-Anwendung RMonitorLeaderboard. Der Service empfängt den RMonitor-Stream von Orbits und stellt ihn als **REST** bereit, kompatibel zur Java-App (Port 8080, gleiche Pfade, gleiches JSON). Zusätzlich liefert er den Stand als **WebSocket** mit Snapshot und JSON-Patch. Dazu kommen Recorder, Player und eine Control-API.
Konzept: [doc/leaderboard-integration](../../doc/leaderboard-integration/README.md).

```sh
npm run build --workspace=@raceoffice/leaderboard-service
node apps/leaderboard-service/dist/index.js -c --host 192.168.1.20 --port 50000   # wie die Java-App
node apps/leaderboard-service/dist/index.js --help
```

> Wie beim Livetracking-Worker gilt: Nach Änderungen neu bauen, `dist` wird gestartet.

## Endpunkte

| Bereich | Pfade |
|---|---|
| REST (Java-kompatibel, jede Methode) | `/race`, `/race/:id`, `/races`, `/races?filter=current`, unbekannte Pfade → aktuelles Rennen |
| Durchfahrten (Finish Line Log) | `GET /api/race/:id/passings`, WS `/ws/race/current/passings` |
| WebSocket | `/ws/race/current`, `/ws/race/:id` (Snapshot + Patch), `/ws/status` |
| Control-API | `GET /api/status`, `GET/PUT /api/config`, `POST /api/client/connect\|disconnect`, `POST /api/recorder/start\|stop`, `GET /api/recordings`, `GET\|PUT\|DELETE /api/recordings/:datei`, `POST /api/player/start\|pause\|resume\|stop\|seek\|speed\|skip-gaps`, `POST /api/state/reset` |
| Sonstiges | `/health`, `/ui/` (Leaderboard-Frontend, sobald unter `public/` gebaut) |

Protokoll und Typen: `LeaderboardWsMessage` und `LeaderboardServiceStatus` in `@raceoffice/domain`.

## Verhalten

- **Eine Quelle:** Orbits verbinden beendet ein Replay, ein Replay trennt Orbits. Beim Wechsel zwischen Live und Replay wird der Rennzustand zurückgesetzt.
- **Reconnect:** Nach einem Abbruch wird alle `retryTimeoutMs` neu verbunden (Default unbegrenzt). Kommt 10 s lang nichts, gilt die Verbindung als tot und wird neu aufgebaut (Orbits sendet jede Sekunde `$F`).
- **WebSocket:** Änderungen werden 100 ms lang gebündelt. Bei einem Rennwechsel kommt ein neuer Snapshot. **Jeder `$F`-Heartbeat erzeugt eine Nachricht**, notfalls einen leeren Patch. Clients können damit „stale“ erkennen, auch wenn sich das angezeigte Rennen nicht ändert, etwa nach `$I`.
- **Recorder:** zeichnet nur Live-Daten auf, byte-genau im Java-Format (`<ms> <zeile>`, CRLF), nach `<dataDir>/recordings/<datum>_<name>.txt`.
- **Player:** Tempo frei wählbar, Pause, Seek (Zustand neu aufbauen und vorspulen). Das Encoding der Datei wird erkannt (`auto`), denn Java-Recordings sind je nach Recorder windows-1252 oder UTF-8.
- **Upload:** `PUT /api/recordings/<name>.txt` mit der Datei als Body (`application/octet-stream` oder `text/plain`), höchstens 50 MB.
- **`$COR`:** Korrekturen werden angewendet und als `timeCorrection` markiert (`state.corrections`).
- **Token:** Ist `LEADERBOARD_CONTROL_TOKEN` gesetzt, brauchen schreibende `/api`-Aufrufe `Authorization: Bearer <token>`. Lesen bleibt offen.

## Konfiguration

Vorrang: CLI > ENV > `<dataDir>/leaderboard.config.json` > Default. Die Java-Flags (`-c`, `--host`, `--port`, `--client-stream-encoding`, `--server-port`, `--player-file`, `-r`, …) werden akzeptiert, siehe `--help`. Über `PUT /api/config` lassen sich `client`, `recorder`, `player`, `publish`, `state` und `compat` ändern. Diese Werte werden in der Datei gespeichert, beim nächsten Start überschreiben CLI und ENV sie aber.

## Tests

```sh
npm run test:run --workspace=@raceoffice/leaderboard-service
```

Die Integrationstests nutzen echte TCP-Verbindungen über den `FakeOrbitsFeeder` von `@raceoffice/rmonitor/testing`. Unter anderem prüfen sie die REST-Ausgabe an jedem Haltepunkt gegen die Java-Referenz, den Weg über WebSocket (Snapshot plus Patches ergibt den REST-Stand), Reconnect, Idle-Timeout, Recorder, Player und Token.

## Auslieferung

Ausgeliefert wird ein **Single-File-Bundle** (esbuild): Service, `@raceoffice/domain`, `@raceoffice/rmonitor` und fastify in einer Datei, ohne `node_modules` und ohne native Abhängigkeiten.

```sh
npm run bundle:leaderboard-service        # baut Frontend + Service, dann apps/leaderboard-service/bundle/
node apps/leaderboard-service/bundle/dist/index.js --version
```

`bundle/` hat dasselbe Layout wie der tsc-Build (`dist/index.js`, `public/`, dazu `package.json` und `LICENSE`):

- **Windows-Release:** `npm run deploy` kopiert den Ordner nach `deploy/apps/leaderboard-service/`. Der RaceOffice-Server startet ihn dort wie im Repo.
- **Docker:** `docker/leaderboard/Dockerfile` (Kontext = Repo-Root) kopiert den Ordner ins Image. Beispiel-Compose: `docker/leaderboard/docker-compose.yml`. Der Release-Workflow veröffentlicht `ghcr.io/kaihoefler/raceoffice-leaderboard` für `linux/amd64` und `linux/arm64`.

```sh
docker build -f docker/leaderboard/Dockerfile -t raceoffice-leaderboard .
docker run -d -p 8080:8080 -v leaderboard-data:/data \
  -e RMONITOR_HOST=192.168.1.20 -e AUTOCONNECT=true raceoffice-leaderboard
```

Details: [07-docker-und-deployment.md](../../doc/leaderboard-integration/07-docker-und-deployment.md).

## Lizenz

GPL-3.0-or-later, siehe [LICENSE](LICENSE). Der Service baut auf der Portierung von RMonitorLeaderboard (`@raceoffice/rmonitor`) auf. Das Bundle enthält auch `@raceoffice/domain`; wer Bundle oder Image weitergibt, gibt diesen Code damit ebenfalls unter der GPL weiter.
