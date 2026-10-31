# 04 – Service-API (`apps/leaderboard-service`)

Die API hat drei Teile:
- REST, kompatibel zur Java-App
- WebSocket mit Diffs
- Control-API zur Steuerung

Alle Pfade sind relativ zur Service-Basis. Im Modus A liegt diese hinter dem Proxy unter `/leaderboard`.

---

## 1. REST (Drop-in-kompatibel)

| Methode | Pfad | Antwort |
|---|---|---|
| beliebig | `/race` | aktuelles Rennen, sonst das vorherige (`RaceStatusRace`) |
| beliebig | `/race/:id` | Rennen mit numerischer ID oder 404 |
| beliebig | `/races` | `RaceStatusRace[]` aller gehaltenen Rennen |
| beliebig | `/races?filter=current` | `[aktuelles Rennen]` |

- Header `Content-Type: application/json` und `Access-Control-Allow-Origin: *`, wie in Java.
- Die Java-App liefert für unbekannte Pfade das aktuelle Rennen. Der Port tut das **nicht** für `/api/*`, `/ws/*`, `/health` und die Frontend-Assets.
  - Für alle übrigen unbekannten Pfade wird das Java-Verhalten nachgebildet, solange `compat.catchAllRace=true` gesetzt ist (Default im Standalone-Modus).
  - So kollidieren Kompatibilität und SPA nicht: Das Frontend liegt unter `/ui/`, `/` leitet auf `/ui/` um, sobald der Request `Accept: text/html` hat.
- `RaceStatusProvider` (`apps/frontend/src/providers/RaceStatusProvider.tsx`) funktioniert damit ohne jede Änderung.

---

## 2. WebSocket: Rennstatus als Diffs

**Endpunkte**
- `GET /ws/race/current`: folgt automatisch dem aktuellen Rennen
- `GET /ws/race/:id`: ein festes Rennen

**Protokoll** (Server → Client, nur lesend):

```ts
type LeaderboardWsMessage =
  | { type: "snapshot"; raceId: number | null; rev: number; data: RaceStatusRace | null }
  | { type: "patch";    raceId: number;        rev: number; baseRev: number; patch: JsonPatchOperation[] }
  | { type: "status";   status: LeaderboardServiceStatus }   // optional, siehe /ws/status
  | { type: "error";    code: string; message: string };
```

**Ablauf**
1. Beim Connect sendet der Server einen `snapshot` des aktuellen Zustands.
2. Bei Änderungen bündelt der `SnapshotPublisher` alle 100 ms (konfigurierbar). Da Orbits jede Sekunde einen `$F`-Heartbeat sendet, entsteht mindestens ein Patch pro Sekunde. Das ist zugleich das Lebenszeichen für die Clients.: Er erzeugt `toRaceTO()`, berechnet `compare(prev, next)` mit `fast-json-patch` (wie in `apps/server/src/services/realtimeHub.ts`) und sendet einen `patch` mit `baseRev`/`rev`.
3. **Rennwechsel** (andere `raceID`, oder `null` ↔ Rennen): Der Server sendet einen neuen `snapshot`, keinen Patch.
4. **Client-Regel:** Passt `baseRev` nicht zur eigenen `rev`, verwirft der Client den Zustand und baut die Verbindung neu auf. Er bekommt dann wieder einen Snapshot. Optional kann er auch `{type:"resync"}` senden.
5. Heartbeat über WS-Ping alle 15 s. Der Client reconnectet mit Backoff (1 s → 10 s), nach dem Vorbild von `apps/livetracking-worker/src/realtimeDocClient.ts`.

**Warum Diffs auf `RaceTO`-Ebene?**
- Der Client bekommt exakt das REST-Format; es gibt nur ein Datenmodell.
- Die Patches bleiben klein: typischerweise `totalTime`, `lapsComplete` und `position` einzelner Fahrer, dazu `elapsedTime`.
- Positionswechsel lassen sich beim Array-Diff als Feldänderungen pro Index ausdrücken. Das ist bei ≤ 40 Fahrern unkritisch.

**`GET /ws/status`** pusht den Service-Status (siehe unten) bei jeder Änderung. Diesen Stream nutzt das Control Center.

Die WS-Typen kommen nach `packages/domain` (z. B. `src/leaderboardProtocol.ts`), damit Scoring-Frontend, Leaderboard-Frontend und Service dieselben Typen nutzen.

---

## 3. Control-API

```ts
type LeaderboardServiceStatus = {
  version: string;
  mode: "managed" | "standalone";
  source: "none" | "rmonitor" | "player";
  client: {
    state: "stopped" | "connecting" | "connected" | "retrying" | "error";
    host: string; port: number; encoding: string;
    lastMessageAt: number | null; messagesPerMinute: number;
    retry: { attempt: number; max: number; nextAttemptAt: number | null };
    lastError: string | null;
  };
  recorder: { active: boolean; file: string | null; lines: number; startedAt: number | null };
  player:   { state: "idle" | "playing" | "paused"; file: string | null; speedup: number; progress: number; positionMs: number; durationMs: number };
  server:   { port: number; wsClients: number; restRequestsPerMinute: number };
  race:     { currentId: number | null; currentName: string | null; flag: string | null };
};
```

| Methode | Pfad | Body | Wirkung |
|---|---|---|---|
| GET | `/api/status` | – | `LeaderboardServiceStatus` |
| GET | `/api/config` | – | aktuelle Konfiguration |
| PUT | `/api/config` | Teilobjekt | validieren (Fastify-JSON-Schema), speichern, ggf. reconnect |
| POST | `/api/client/connect` | optional `{host, port, encoding}` | Verbindung zu Orbits aufbauen (beendet einen laufenden Player) |
| POST | `/api/client/disconnect` | – | trennen |
| POST | `/api/recorder/start` | optional `{name}` | Aufzeichnung nach `/data/recordings/<datum>_<name>.txt` |
| POST | `/api/recorder/stop` | – | |
| GET | `/api/recordings` | – | Liste mit Größe, Dauer, Zeilen |
| GET | `/api/recordings/:file` | – | Download |
| POST | `/api/recordings` | multipart | Upload (z. B. Java-Recordings) |
| DELETE | `/api/recordings/:file` | – | löschen |
| POST | `/api/player/start` | `{file, speedup, startAtMs?, skipGaps?}` | Replay starten (trennt den Live-Client, setzt den Store zurück) |
| POST | `/api/player/pause` / `resume` / `stop` | – | |
| POST | `/api/player/seek` | `{positionMs}` | Store zurücksetzen und bis zur Position im Schnelllauf abspielen |
| POST | `/api/player/skip-gaps` | `{enabled}` | Pausen > 10 s in der Aufnahme als 1 s abspielen (auch während des Replays). Position und Dauer beziehen sich dann auf die verkürzte Zeitachse. |
| POST | `/api/state/reset` | – | Rennzustand verwerfen |
| GET | `/api/race/:id/passings` | – | Ringpuffer der letzten 500 `$J`-Passings (Finish Line Log); live per WS `/ws/race/current/passings`: zuerst `{type:"passings", raceId, passings}` (auch bei Rennwechsel, Reset und großen Schüben), danach `{type:"passing", raceId, passing}` für neue und ergänzte Einträge (gleiche `seq` = Aktualisierung: Position/Runde aus dem folgenden `$G`, `$COR`-Korrektur) |
| GET | `/health` | – | `{ok:true, version}` |

**Player:**
- Liest das Recording, speist die Zeilen mit `Δt / speedup` in den `LineBus` und damit in denselben Store.
- `seek` funktioniert, weil der Store deterministisch ist: zurücksetzen und bis zur Zielzeit ohne Wartezeit abspielen.

**Optionaler TCP-Replay-Server:**
- `player.tcpServer.enabled`, Port 50000.
- Gibt das Replay zusätzlich als RMonitor-TCP-Stream aus, wie der Java-Player.
- Damit lassen sich andere Orbits-Konsumenten (auch die Java-App) mit einem Replay testen. Für den Parallelbetrieb am Wettkampftag ist das nicht nötig, weil Orbits mehrere Clients gleichzeitig bedient.

---

## 4. Sicherheit

**Entschieden:** Ein optionaler Token reicht für die Steuerfunktionen.

- Lesende Endpunkte (`/race*`, `/races`, `/ws/race/*`) bleiben offen, wie heute.
- Schreibende Endpunkte (`/api/*` mit POST/PUT/DELETE) prüfen optional einen Token: `LEADERBOARD_CONTROL_TOKEN`, Header `Authorization: Bearer …`.
  - Im Modus A setzt der RaceOffice-Server den Token beim Start und fügt ihn im Proxy hinzu. Der Service bindet dann zusätzlich nur an `127.0.0.1`.
- Uploads: Dateinamen werden normalisiert (kein Path-Traversal), Größe ist begrenzt (Default 50 MB).

---

## 5. Konfiguration

`/data/leaderboard.config.json`. Vorrang: CLI > ENV > Datei > Default.

| Schlüssel | ENV | CLI (Java-kompatibel) | Default |
|---|---|---|---|
| `client.host` | `RMONITOR_HOST` | `--host` | `127.0.0.1` |
| `client.port` | `RMONITOR_PORT` | `--port` | `50000` |
| `client.encoding` | `RMONITOR_ENCODING` | `--client-stream-encoding` | `windows-1252` |
| `client.retry.max` | `RMONITOR_RETRY_MAX` | `--client-max-retries` | `-1` (unendlich, abweichend von Java) |
| `client.retry.timeoutMs` | `RMONITOR_RETRY_TIMEOUT_MS` | `--client-retry-timeout` | `5000` |
| `client.autoConnect` | `AUTOCONNECT` | `-c` | `false` (Docker: `true`) |
| `server.host` | `HOST` | `--server-host` | `0.0.0.0` |
| `server.port` | `PORT` | `--server-port` | `8080` |
| `recorder.autoStart` | `RECORDER_AUTOSTART` | `-r` / `--recorder-file` | `false` |
| `player.file` / `player.speedup` | – | `-p` / `--player-file` / `--player-speedup` | – / `1` |
| `player.skipGaps` | `PLAYER_SKIP_GAPS` | `--player-skip-gaps` | `true` |
| `publish.coalesceMs` | `PUBLISH_COALESCE_MS` | – | `100` |
| `dataDir` | `LEADERBOARD_DATA_DIR` | `--data-dir` | `./data` (Docker: `/data`) |

`--headless` und `--loglevel` werden aus Kompatibilitätsgründen akzeptiert. Der Service ist immer headless.
