# 05 – Worker-Betrieb und Steuerung aus Scoring und Leaderboard

## 1. Managed-Modus im RaceOffice-Server

### 1.1 Prozessmanagement
Vorbild ist `apps/server/src/services/liveTrackingWorkerManager.ts`:
- spawn von `dist/index.js`, Fallback auf `tsx src/index.ts`
- Log-Weiterleitung
- SIGTERM, nach 5 s SIGKILL

**Empfehlung:** Den gemeinsamen Teil als `ManagedProcess` herausziehen (`apps/server/src/services/managedProcess.ts`). Darauf bauen dann zwei schlanke Manager auf:

```ts
class ManagedProcess {
  constructor(opts: { name: string; entry: { dist: string; src: string }; args: () => string[]; env?: () => NodeJS.ProcessEnv; healthUrl?: () => string });
  start(): Promise<void>;          // idempotent, wartet optional auf /health
  stop(): Promise<void>;           // SIGTERM → SIGKILL
  status(): { state: "stopped" | "starting" | "running" | "stopping" | "crashed"; pid: number | null; startedAt: number | null; exitCode: number | null };
  onExit(cb): void;
}

// bestehend, auf ManagedProcess umgestellt
class LiveTrackingWorkerManager { … }

// neu
class LeaderboardServiceManager {
  // args: --server-host 127.0.0.1 --server-port <LEADERBOARD_INTERNAL_PORT> --data-dir <RACEOFFICE_DATA>/leaderboard --mode managed
  // env:  LEADERBOARD_CONTROL_TOKEN = zufällig pro Serverstart
  // optional: autoStart beim Serverstart (LEADERBOARD_AUTOSTART=true)
  // optional: Restart-Policy bei Crash (max 3 in 60 s)
}
```

Der Refactor von `LiveTrackingWorkerManager` ist optional. Er kann auch nach P3 erfolgen; dann wird der Manager zunächst kopiert und angepasst.

### 1.2 Routen im RaceOffice-Server
Neues Modul `apps/server/src/services/leaderboardRoutes.ts`, nach dem Muster von `liveTrackingWorkerRoutes.ts`:

| Methode | Pfad | Wirkung |
|---|---|---|
| GET | `/leaderboard-service/status` | Prozessstatus + `mode` + (falls erreichbar) `/api/status` des Service |
| POST | `/leaderboard-service/start` | nur `managed` |
| POST | `/leaderboard-service/stop` | nur `managed` |
| * | `/leaderboard/*` | Proxy (HTTP + WS) auf den Service, `Authorization` wird ergänzt |

- **Proxy:** `@fastify/http-proxy` mit `websocket: true` (neue Abhängigkeit) und `prefix: "/leaderboard"`.
  - Im Modus `external` zeigt der Proxy auf `LEADERBOARD_URL`.
  - Ist der Service nicht erreichbar, kommt 503 mit `{error:"leaderboard_unavailable"}`.
- Die Routen werden in `apps/server/src/app.ts` (`buildApp`) registriert. `/leaderboard/race*` gehört zu den `PUBLIC_SERVICE_ENDPOINTS`.
- Die Vite-Dev-Proxies in `apps/frontend/vite.config.ts` bekommen `/leaderboard` und `/leaderboard-service`.

### 1.3 Server-Konfiguration

| ENV / CLI | Werte | Default |
|---|---|---|
| `LEADERBOARD_MODE` / `--leaderboard-mode` | `managed` \| `external` \| `off` | `managed` |
| `LEADERBOARD_URL` / `--leaderboard-url` | URL für `external` | – |
| `LEADERBOARD_INTERNAL_PORT` | Port für `managed` | `8790` |
| `LEADERBOARD_AUTOSTART` | `true`/`false` | `false` |

Auslieferung im Modus A: Das Leaderboard-Frontend wird vom Service selbst ausgeliefert und ist damit unter `/leaderboard/ui/` erreichbar. Der RaceOffice-Server muss dafür keine eigenen statischen Dateien bereitstellen.

---

## 2. Steuerung aus dem Scoring

### 2.1 Datenquelle: `RaceStatusProvider`
- **Neuer Transport `ws`** zusätzlich zu `poll`:
  - URL-Schema `ws(s)://…/ws/race/current` oder automatische Ableitung aus der REST-URL
  - Er verarbeitet `snapshot`/`patch` mit `applyPatch` aus `fast-json-patch` (im Frontend bereits für Realtime-Docs genutzt).
  - Bricht der WS ab, fällt er auf Polling zurück und versucht im Hintergrund weiter, sich neu zu verbinden.
- **Context-Schnittstelle bleibt gleich:** `status`, `currentRace`, `updatedAt`, `paused`, `errorCount` …
  - `pollIntervalMs` wirkt nur im Poll-Modus.
  - `paused` schließt den WS.
- **Default-URL:**
  - Modus A: `/leaderboard/races?filter=current` (gleicher Origin, kein CORS, kein `localhost:8080` mehr)
  - weiterhin überschreibbar per `VITE_RACE_STATUS_URL` und im Settings-Dialog
- **„Stale“-Logik (entschieden):** In `LiveRaceStatus` gilt eine Verbindung als stale, wenn das letzte Update > 3 s alt ist. Das bleibt **unverändert**, denn Orbits sendet jede Sekunde einen `$F`-Heartbeat (siehe [01-ist-analyse.md](01-ist-analyse.md#6a-beobachtungen-aus-echten-aufnahmen)).
  - Der Heartbeat ändert `timeOfDay`, im Rennen zusätzlich `elapsedTime`. Dadurch entsteht mindestens ein Patch pro Sekunde, auch ohne aktives Rennen.
  - Der Provider setzt `updatedAt` bei jedem `snapshot`/`patch`.
  - Bleiben Patches > 3 s aus, ist entweder die WS-Verbindung oder die Verbindung zu Orbits gestört. Beides soll das Scoring als „no response“ zeigen.
  - Ein künstlicher Keepalive ist nicht nötig. Den genaueren Grund (WS weg oder Orbits weg) liefert `/ws/status` (`client.lastMessageAt`).
  - **Fallstrick:** Der Service darf das Timing nicht „glätten“, etwa indem er unveränderte Snapshots unterdrückt, nur weil das Coalescing-Fenster leer war. Jeder Heartbeat muss als Patch durchkommen.

### 2.2 UI im Scoring (`LiveRaceStatus`)
Der Settings-Dialog „Race status connection“ wird zum Dialog **„Live-Quelle“** mit zwei Bereichen:

1. **Leaderboard-Service** (nur wenn der Server `managed`/`external` meldet):
   - Status-Chips: Service (running/stopped), Orbits (connected/retrying/…), Quelle (live/replay), Recorder aktiv
   - Buttons: Service starten/stoppen (nur managed), Orbits verbinden/trennen
   - Host/Port von Orbits inline editierbar
   - Link „Leaderboard öffnen“ (neuer Tab) und „Control Center“
2. **Verbindung (Fortgeschritten):** Transport (WS/Polling), URL, Intervall, Pause, also das, was heute im Dialog steht.

**Hinweise im Header:**
- Läuft ein Replay, zeigt der Header einen deutlichen Hinweis **„REPLAY“**, damit niemand versehentlich ein Replay wertet.
- Ist der Recorder aus, erscheint während GREEN ein dezenter Hinweis „nicht aufgezeichnet“.

Die Steuerlogik wird gekapselt in `apps/frontend/src/services/leaderboardServiceClient.ts`: Fetch-Wrapper für `/leaderboard-service/*` und `/leaderboard/api/*`, plus `useLeaderboardServiceStatus()` auf Basis von `/leaderboard/ws/status`.

### 2.3 Unverändert
`ScoringLiveColumns.tsx`, `ScoringViewModel.tsx`, `liveScoring.ts` und die Sync-Regeln (Sync nur bei GREEN/PURPLE, Reset bei Rennwechsel) bleiben, wie sie sind. Sie hängen nur am `RaceStatusProvider`-Context.

---

## 3. Steuerung aus dem Leaderboard

- Das Control Center ([06-frontend.md](06-frontend.md)) arbeitet direkt gegen `/api/*` des Service, relativ zur eigenen Basis. Es funktioniert also gleich, ob unter `/leaderboard/ui/` oder `/ui/`.
- Prozess-Start/Stop gibt es dort nicht. Ein Service, der nicht läuft, liefert auch kein Frontend aus.
- Im Modus A erkennt das Control Center über `status.mode === "managed"`, dass es hinter RaceOffice läuft, und zeigt einen Link zurück ins Scoring.

---

## 4. Zustände und Fehlerfälle

| Situation | Verhalten |
|---|---|
| Service-Prozess stürzt ab (managed) | Restart-Policy; Scoring zeigt „Leaderboard-Service nicht verfügbar“, der Provider fällt auf „no response“ |
| Orbits nicht erreichbar | Client `retrying` mit Countdown; REST/WS liefern den letzten bekannten Zustand bzw. `null` |
| RaceOffice-Server-Neustart | managed-Service wird mit beendet; mit `LEADERBOARD_AUTOSTART=true` startet er neu und verbindet automatisch, wenn `client.autoConnect` gesetzt ist |
| Zwei Bediener steuern gleichzeitig | Alle Clients sehen den Status-Stream (`/ws/status`); der letzte Befehl gewinnt, Befehle sind idempotent |
| Replay während eines Live-Rennens | Player-Start beendet den Live-Client nur nach Bestätigung im UI („Live-Verbindung wird getrennt“) |
