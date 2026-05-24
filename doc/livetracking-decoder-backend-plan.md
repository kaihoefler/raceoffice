# LiveTracking: Decoder-Backend Architekturplan (AMMC + P3Parser)

## Ziel
LiveTracking soll zur Laufzeit umschaltbar unterstützen:
- `ammc` (pro Decoder eine WebSocket-Verbindung via AMMC-Prozess)
- `p3parser` (direkte TCP-Verbindung über `P3DecoderPool` aus `@raceoffice/p3parser`)

Dabei sollen bestehende Setup-/Start-/Stop-Abläufe erhalten bleiben und die Decoder-Anbindung sauber austauschbar sein.

---

## Randbedingungen
- **Architekturregel**: Der Server bleibt die zentrale Instanz für Dokumentzustände (`session/runtime/results`).
- **Persistenz von Passings**: Kein Ziel dieses Umbaus. Passings werden ausschließlich live verteilt (wie heute).

---

## Implementierungsstatus

| Komponente | Status |
|---|---|
| `P3DecoderConnection` | **fertig** – in `packages/p3parser` |
| `P3DecoderPool` | **fertig** – in `packages/p3parser` |
| `P3DecoderDiscovery` | **fertig** – in `packages/p3parser` |
| Adapter-Schicht im Worker | offen |
| Backend-Wahl im Setup | offen |
| UI für Backend-Wahl | offen |
| P3ParserDecoderSourceAdapter | offen |
| P3 Session Recovery / Resend | offen |
| Server-Endpunkt für P3 Discovery Scan | offen |

---

## Namenskonventionen – Klarstellung

Im aktuellen Domain-Modell gibt es eine Namenskollision, die vor der P3-Integration aufgelöst werden muss:

| Begriff | Bedeutung |
|---|---|
| `LiveTrackingTimingPoint.decoderLabel` | Konfigurierbarer, menschenlesbarer Name des Decoders (z.B. "Start", "Ziel", "Sektor 1"). Wird in UI und Logs angezeigt. |
| `PassingEvent.decoderId` | Hardware-zugewiesene Decoder-ID ("40-24-04-00"), kommt vom Decoder beim Verbindungsaufbau (VERSION_DECODER). Nicht konfigurierbar. |
| `LiveTrackingTimingPoint.decoderIp` | IP-Adresse des physischen Decoders. Kanonischer Routing-Schlüssel für beide Backends. |
| `LiveTrackingTimingPoint.id` | Stabile fachliche ID des Timing-Punkts. Wird als `timingPointId` in `NormalizedPassing` verwendet. |

**Das bisherige Feld `decoderId` in `LiveTrackingTimingPoint` wird in `decoderLabel` umbenannt** (PR4), um die Kollision mit der hardware-seitigen Decoder-ID aus dem P3-Protokoll zu beseitigen.

---

## Architekturvorschlag

## 1) Decoder-Adapter-Schicht im Worker

Im Worker wird eine einheitliche Adapter-Schnittstelle eingeführt.

```ts
export type DecoderBackendKind = "ammc" | "p3parser";

export type NormalizedPassing = {
  passingId: string;
  /** ISO-Timestamp des Passings. */
  timestamp: string;
  /** Zeitquelle des Passing-Timestamps ("rtc" | "utc"). */
  passingTimeSource?: "rtc" | "utc";
  passingNumber: number;
  transponderId: string;
  transponderType: "tranx" | "prochip";
  /** Hardware-zugewiesene Decoder-ID (aus Protokoll, z.B. "40-24-04-00"). */
  decoderId: string;
  /** Fachliche Timing-Punkt-ID aus LiveTrackingTimingPoint.id. */
  timingPointId: string;
  signalStrength: number;
  hits: number;
  lowBattery: boolean;
  backend: DecoderBackendKind;
  raw?: unknown;
};

export interface DecoderSourceAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  onPassing(cb: (passing: NormalizedPassing) => void): void;
  onWarning(cb: (message: string) => void): void;
  onHealth?(cb: (state: unknown) => void): void;
}
```

Implementierungen:
- `AmmcDecoderSourceAdapter`
- `P3ParserDecoderSourceAdapter`

Nutzen:
- Worker-Loop kennt nur noch *ein* Interface
- Backend-Wechsel betrifft keine Timing-/UI-Logik

---

## 2) Kanonisches Passing-Format

Unabhängig von Quelle (`ammc` / `p3parser`) erzeugen Adapter ein gemeinsames `NormalizedPassing`.

Mapping `PassingEvent` (P3) → `NormalizedPassing`:

| `PassingEvent` (p3parser) | `NormalizedPassing` |
|---|---|
| `passingNumber` | `passingNumber` |
| `transponderId` | `transponderId` |
| `transponderType` | `transponderType` |
| `decoderId` | `decoderId` |
| `time` | `timestamp` (ISO-String) |
| `timeSource` | `passingTimeSource` |
| `signalStrength` | `signalStrength` |
| `hits` | `hits` |
| `lowBattery` | `lowBattery` |
| – | `timingPointId` (aus Adapter-internem Lookup, s.u.) |
| – | `backend: "p3parser"` |

### timingPointId-Auflösung im P3-Adapter

Die Hardware-Decoder-ID ist nicht konfigurierbar und erst nach Verbindungsaufbau bekannt. Der Adapter baut daher eine interne Map in zwei Schritten auf:

```
Konfigurationszeit:   decoderIp → timingPoint.id    (aus Setup-Config)

Verbindungszeit:      onDecoderConnected(info, source)
                      info.decoderId (hardware) → timingPoint.id
                      [source.ip → timingPoint.id → Map aufbauen]

Passing-Zeit:         onPassing(event)
                      event.decoderId → timingPoint.id (aus Map)
```

```ts
const decoderToTimingPoint = new Map<string, string>(); // hardwareDecoderId → timingPoint.id

const pool = new P3DecoderPool(
  timingPoints.map(tp => ({ ip: tp.decoderIp, label: tp.decoderLabel })),
  {
    onDecoderConnected: (info, source) => {
      const tp = timingPoints.find(tp => tp.decoderIp === source.ip);
      if (tp) decoderToTimingPoint.set(info.decoderId, tp.id);
    },
    onPassing: (event) => {
      const timingPointId = decoderToTimingPoint.get(event.decoderId) ?? "unknown";
      passingCallback({ ...mapToNormalized(event), timingPointId, backend: "p3parser" });
    },
  }
);
```

---

## 3) Setup-/Session-Konfiguration erweitern

Im Setup wird hinterlegt, welches Backend aktiv ist.

Beispiel-Felder:
- `decoderBackend: "ammc" | "p3parser"`
- optional backend-spezifische Einstellungen:
  - AMMC nutzt `decoderIp + websocketPortAMM` pro Timing-Point (bereits vorhanden)
  - P3 nutzt `decoderIp` pro Timing-Point (Port 5403 ist Standard, konfigurierbar)

Beim `prepare/start` wird danach der passende Adapter instanziiert.

---

## 4) Datenfluss

1. Adapter liefert `NormalizedPassing`
2. Worker konvertiert `NormalizedPassing → LiveTrackingRuntimePassingEvent` und schreibt es in `runtime.recentPassings`
3. Timing-Engine liest aus `recentPassings` und berechnet Ergebnisse
4. Passings werden live verteilt (über bestehende Dokumentmechanik / Realtime)

`LiveTrackingRuntimePassingEvent` wird um die neuen Felder erweitert (Option A), damit `transponderType`, `signalStrength`, `hits` und `lowBattery` bis zur Timing-Engine und zum Frontend durchfließen. Keine Backend- oder P3-spezifische Speziallogik in der fachlichen Timing-Engine.

---

## Umsetzungsreihenfolge

### Phase A – Entkopplung & Backend-Umschaltung
1. `NormalizedPassing` + Adapter-Interface + `LiveTrackingRuntimePassingEvent`-Erweiterung definieren
2. Bestehende AMMC-Anbindung in `AmmcDecoderSourceAdapter` kapseln, `SessionLoop` entkoppeln
3. Worker-Loop (`sessionLoop.ts`) auf Adapter-Lifecycle umstellen
4. Setup/Session um `decoderBackend` + Umbenennung `decoderId → decoderLabel` + Datenmigration erweitern
5. UI: Backend-Wahl + angepasste Feldbezeichnungen + P3-Discovery-Scan
6. Worker zieht Backend-Wahl aus Setup/Session
7. `P3ParserDecoderSourceAdapter` implementieren
8. P3 Session Recovery / Resend nach Reconnect
9. Ende-zu-Ende testen: Umschalten zwischen `ammc` und `p3parser`

---

## Nicht-Ziele (für diesen Umbau)
- Kein großer Refactor der gesamten Realtime-Infrastruktur
- Keine fachliche Änderung der Timing-Engine-Regeln
- Keine Persistenz von Passings

---

## Entscheidungsprinzipien
- **Interface first**: zuerst Adapter-Schnittstelle stabilisieren
- **Format first**: früh ein kanonisches Passing-Modell festlegen
- **No duplicated domain logic**: Fachlogik bleibt zentral, Backend-spezifische Logik bleibt im Adapter
- **Decoder identified by IP**: `decoderIp` ist der kanonische Routing-Schlüssel für beide Backends

---

## Ergebnisbild
Nach Phase A:
- LiveTracking kann zwischen AMMC und P3Parser umschalten
- gleiche Live-Ansichten, gleiche fachliche Berechnung
- keine harte Kopplung an Decoder-spezifisches Protokoll
- Naming ist konsistent zwischen Domain-Modell und P3 Client API

---

## Konkreter Umsetzungsplan (Datei-/Modulgenau)

Dieser Abschnitt ist als direkte Arbeitsgrundlage gedacht (in kleinen PRs umsetzbar).

---

## PR 1 – Worker-Adapter-Vertrag + Domain-Typen einführen (ohne Verhaltensänderung)

### Ziel
Saubere Schnittstelle schaffen und Domain-Typen um die neuen Felder erweitern, noch ohne Umschaltung in der UI.

### Dateien anlegen
- `apps/livetracking-worker/src/decoder/adapters/decoderSourceAdapter.ts`
  - `DecoderBackendKind`
  - `NormalizedPassing` (mit `decoderId` = hardware-ID, `timingPointId` = fachliche Timing-Punkt-ID, `transponderType`, `signalStrength`, `hits`, `lowBattery`)
  - `DecoderSourceAdapter` Interface
  - gemeinsame Callback-/Health-Typen

- `apps/livetracking-worker/src/decoder/adapters/normalizedPassing.ts`
  - Hilfsfunktionen: `createPassingId`, Normalisierung von Timestamps
  - `normalizedToRuntimePassing(n: NormalizedPassing): LiveTrackingRuntimePassingEvent` – Konvertierung für den Worker-Loop

### Dateien anpassen (Domain)
- `packages/domain/src/livetracking/runtime.ts`
  - `LiveTrackingRuntimePassingEvent` um neue Felder erweitern (Option A):
    - `transponderType?: "tranx" | "prochip"`
    - `signalStrength?: number`
    - `hits?: number`
    - `lowBattery?: boolean`
    - `passingTimeSource?: "rtc" | "utc"`
    - `backend?: "ammc" | "p3parser"`
  - alle neuen Felder optional (Rückwärtskompatibilität mit gespeicherten Dokumenten)
  - `isLiveTrackingRuntimePassingEvent` Type Guard anpassen

- `apps/livetracking-worker/src/index.ts`
  - nur Imports/Types vorbereiten
  - keine funktionale Änderung am Runtime-Verhalten

### Abnahmekriterien
- Worker baut unverändert
- keine Laufzeitänderung
- neue Typen sind zentral verfügbar und dokumentiert
- bestehende gespeicherte Runtime-Dokumente bleiben kompatibel (alle neuen Felder optional)

---

## PR 2 – AMMC in `AmmcDecoderSourceAdapter` kapseln

### Ziel
Bestehende AMMC-Anbindung aus dem Worker-Loop herauslösen, Verhalten 1:1 beibehalten.

### Dateien anlegen
- `apps/livetracking-worker/src/decoder/adapters/ammcDecoderSourceAdapter.ts`
  - übernimmt vollständig: `AmmcProcessManager`-Nutzung, WebSocket-Verbindungen, `handleAmmMessage`-Logik
  - liefert `NormalizedPassing` via `onPassing`-Callback
  - AMMC-spezifische Felder ohne P3-Äquivalent (`transponderType`, `signalStrength`, `hits`, `lowBattery`) mit sinnvollen Defaults befüllen (z.B. `transponderType: "tranx"`, `signalStrength: 0`)
  - mapped AMMC-spezifische Warnungen auf `onWarning`

- `apps/livetracking-worker/src/decoder/ammc/` (Unterordner)
  - `ammParser.ts` und `ammcProcessManager.ts` hierher verschieben

### Dateien anpassen
- `apps/livetracking-worker/src/sessionLoop.ts` (**größte Änderung in PR2**)
  - Methoden `syncAmmConnections`, `connectAmm`, `disconnectAmm`, `scheduleConnectAmm`, `clearPendingAmmConnect`, `handleAmmMessage` vollständig entfernen
  - `AmmcProcessManager`-Feld entfernen
  - `ammConnections`-Map entfernen
  - stattdessen: Adapter-Instanz verwalten + `adapter.start()` / `adapter.stop()` aufrufen
  - `onPassing`-Callback des Adapters an bisherigen Runtime-Update-Fluss anbinden (Aufruf von `commitRuntimeUpdate` mit konvertiertem Passing)
  - `upsertRuntimeDecoder` bleibt, wird jetzt aber vom Adapter via `onHealth`-Callback befüttert

- `apps/livetracking-worker/src/ammParser.ts` (vor Verschieben nach `decoder/ammc/`)
  - Fallback `args.timingPoint.decoderId` in Zeile ~99 entfernen: Hardware-Decoder-ID nur aus `payload.decoder_id` lesen; Fallback auf `""` wenn fehlend (nicht auf `decoderLabel`)
  - `Pick`-Typ des `timingPoint`-Arguments von `"decoderId"` auf `"decoderLabel"` umstellen

### Tests
- vorhandene Worker-Tests anpassen (Mock auf Adapterebene statt direktem AMMC-Mock)
- neu: `apps/livetracking-worker/src/decoder/adapters/ammcDecoderSourceAdapter.test.ts`

### Abnahmekriterien
- funktional identisches Verhalten zu vorher (nur strukturell gekapselt)
- `sessionLoop.ts` enthält keine AMMC-spezifischen Imports mehr
- prepare/start/stop unverändert nutzbar

---

## PR 3 – Adapter-Factory + Backend-Auswahl im Worker

### Ziel
Backend zentral auswählbar machen (`ammc` als Default). `sessionLoop.ts` kennt nur noch ein generisches Adapter-Interface.

### Dateien anlegen
- `apps/livetracking-worker/src/decoder/adapters/createDecoderSourceAdapter.ts`
  - Factory: `(backendKind, timingPoints, config?) => DecoderSourceAdapter`
  - defensiver Fallback + klare Fehlermeldung bei unbekanntem `backendKind`

### Dateien anpassen
- `apps/livetracking-worker/src/sessionLoop.ts`
  - bisherige `syncAmmConnections`-artige Methode wird zu `syncAdapterLifecycle()`:
    - session `running` → `adapter.start()`
    - session nicht `running` → `adapter.stop()`
  - Adapter-Instanz als privates Feld halten: `private adapter: DecoderSourceAdapter | null`
  - Adapter wird in PR6 durch Setup-Konfiguration gesteuert; hier vorerst hardcoded `ammc` als Default

### Abnahmekriterien
- Default bleibt `ammc`, Verhalten identisch zu PR2
- `sessionLoop.ts` importiert weder `AmmcProcessManager` noch WebSocket direkt
- Worker kann mit explizitem Backend-Parameter starten

---

## PR 4 – Domain-Modell für Backend-Wahl erweitern + Naming bereinigen

### Ziel
Setup/Session sollen fachlich ausdrücken können, welches Decoder-Backend gewünscht ist.
Gleichzeitig: Namenskollision `decoderId` auflösen.

### Dateien anpassen (Domain)
- `packages/domain/src/livetracking/setup.ts`
  - Feld ergänzen: `decoderBackend?: "ammc" | "p3parser"`
  - **`LiveTrackingTimingPoint.decoderId` umbenennen in `decoderLabel`**
    - `decoderLabel` ist der konfigurierbare, menschenlesbare Name ("Start", "Ziel")
    - trennt sauber von der hardware-zugewiesenen Decoder-ID aus dem P3-Protokoll
  - `isLiveTrackingTimingPoint` Type Guard: **beide Feldnamen lesen** für Übergangskompatibilität:
    ```ts
    decoderLabel: typeof value.decoderLabel === "string"
      ? value.decoderLabel
      : typeof (value as any).decoderId === "string"
        ? (value as any).decoderId   // Migration alter Dokumente
        : ""
    ```
  - Validierungsregel ergänzen: `decoderIp` muss über alle Timing-Points eindeutig sein
    - neuer Fehlercode: `timing_point_duplicate_decoder_ip`
    - bisherige `timing_point_duplicate_decoder_endpoint` Regel (ip:port) kann entfallen
  - `normalizeTimingPoints` anpassen (Feld `decoderLabel` statt `decoderId`)
  - `createLiveTrackingSetupDocument` Defaults anpassen

- `packages/domain/src/livetracking/session.ts`
  - falls Session das Setup snapshoted: entsprechende Felder übernehmen

- `packages/domain/src/livetracking/*.test.ts`
  - Initializer-/Guard-Tests aktualisieren

### Datenmigration bestehender Setup-Dokumente
Bestehende Dokumente in der SQLite-Datenbank haben noch `decoderId` statt `decoderLabel`. Strategie: **lazy migration** – kein einmaliges DB-Script, sondern der Type Guard liest beide Feldnamen (s.o.). Beim nächsten Speichern eines Setups über die UI wird automatisch `decoderLabel` geschrieben und der alte `decoderId`-Eintrag verschwindet.

Keine explizite DB-Migration erforderlich, solange das Backend beim Lesen tolerant ist.

### Dateien anpassen (Worker)
- `apps/livetracking-worker/src/decoder/ammc/ammParser.ts`
  - Note: Diese Änderung ist bereits in PR2 enthalten (Fallback-Fix + `decoderLabel` im Pick-Typ).
  - Sicherstellen dass kein Verweis auf `decoderId` in Timing-Point-Feldern mehr vorhanden ist.

- `apps/livetracking-worker/src/sessionLoop.ts`
  - alle verbleibenden `point.decoderId`-Referenzen auf `point.decoderLabel` umstellen
  - `upsertRuntimeDecoder` und `recentRawPayloads`-Einträge nutzen `point.decoderLabel` als Anzeigename

### Abnahmekriterien
- alte Dokumente mit `decoderId` werden transparent auf `decoderLabel` migriert
- neue Dokumente schreiben ausschließlich `decoderLabel`
- `decoderLabel` klar von Hardware-Decoder-ID unterscheidbar
- alle bestehenden Validierungen greifen weiterhin

---

## PR 5 – UI: Backend-Wahl + Naming im LiveTracking-Frontend

### Ziel
Backend-Wahl im Livetracking-Frontend auswählbar machen und Feldbezeichnungen vereinheitlichen.

### Dateien anpassen
- `apps/livetracking-frontend/src/pages/livetracking/LiveTrackingControlPage.tsx`
  - Select-Feld für `decoderBackend` ("AMMC" / "P3 Parser")
  - Timing-Point-Formular anpassen:
    - Feld `decoderId` → `decoderLabel`, UI-Label: "Decoder Name"
    - Feld "IP" bleibt, Tooltip/Subtext je nach Backend:
      - AMMC: "WebSocket-IP des AMM-Prozesses"
      - P3: "TCP-IP des P3-Decoders (Port 5403)"
    - Feld `websocketPortAMM` nur anzeigen wenn `decoderBackend === "ammc"`
  - **P3 Discovery Scan** (nur sichtbar wenn `decoderBackend === "p3parser"`):
    - "Netz scannen"-Button oberhalb der Timing-Point-Liste
    - Ruft Backend-Endpunkt auf, der `P3DecoderDiscovery.scan(3000)` ausführt (Node-seitig, da UDP)
    - Gefundene Decoder werden als Auswahl angeboten: IP + decoderType + decoderId
    - Nutzer kann einen gefundenen Decoder einem Timing-Point zuweisen (IP wird übernommen)
    - Hinweis: Discovery läuft serverseitig (Browser hat keinen UDP-Zugriff); neuer API-Endpunkt nötig
  - Anzeige des aktiven Backends im Debug-Block
  - Save-Flow erweitert (Setup-Doc)

### Neue Dateien (Server)
- `apps/server/src/routes/p3Discovery.ts` (oder äquivalent)
  - `GET /api/p3/scan` – führt `P3DecoderDiscovery.scan(3000)` aus, gibt `DiscoveredDecoder[]` zurück
  - Timeout-Parameter optional konfigurierbar

### Abnahmekriterien
- Backend-Wahl wird gespeichert und nach Reload korrekt angezeigt
- bei fehlendem Wert wird `ammc` angezeigt/genutzt
- Feldbezeichnungen sind konsistent mit Domain-Naming (`decoderLabel`, `decoderIp`)
- P3 Scan-Button findet Decoder im lokalen Netz und schlägt IPs vor

---

## PR 6 – Worker zieht Backend-Wahl aus Setup/Session

### Ziel
Factory-Auswahl nicht mehr nur CLI/Default, sondern aus LiveTracking-Dokumenten.

### Dateien anpassen
- `apps/livetracking-worker/src/index.ts`
  - beim `prepare`/`start` aus Setup/Session lesen
  - an Factory übergeben
  - bei ungültiger Konfiguration klare Runtime-Warnung + Fehlerstatus

### Abnahmekriterien
- Umschalten im Setup beeinflusst tatsächlich die Adapterwahl
- bei invalid config bricht Worker kontrolliert mit guter Meldung ab

---

## PR 7 – `P3ParserDecoderSourceAdapter` implementieren

### Ziel
Zweites Backend vollständig lauffähig integrieren. Setzt auf `P3DecoderPool` aus `@raceoffice/p3parser` auf (bereits implementiert).

### Dateien anlegen
- `apps/livetracking-worker/src/decoder/adapters/p3ParserDecoderSourceAdapter.ts`
  - `P3DecoderPool` mit Timing-Point-Konfiguration instanziieren:
    - `DecoderConfig` je Timing-Point: `{ ip: tp.decoderIp, label: tp.decoderLabel }`
  - interne Map `hardwareDecoderId → timingPointId` aufbauen:
    - befüllen in `onDecoderConnected(info, source)` via `source.ip → tp.id`
    - nutzen in `onPassing(event)` via `event.decoderId → timingPointId`
  - Warnung loggen wenn `event.decoderId` noch nicht in Map (VERSION_DECODER noch ausstehend)
  - `PassingEvent` → `NormalizedPassing` mappen (s. Feldtabelle oben)
  - health/warning callbacks aus Pool-Events ableiten

- `apps/livetracking-worker/src/decoder/adapters/p3ParserConfig.ts` (ggf.)
  - Typen für P3-spezifische Konfiguration (Port-Override, Reconnect-Delay)

### Dateien anpassen
- `apps/livetracking-worker/src/decoder/adapters/createDecoderSourceAdapter.ts`
  - Branch für `p3parser` ergänzen

### Tests
- `apps/livetracking-worker/src/decoder/adapters/p3ParserDecoderSourceAdapter.test.ts`
  - Mapping `PassingEvent → NormalizedPassing`
  - `timingPointId`-Auflösung über zwei Verbindungsschritte
  - Verhalten bei unbekanntem `decoderId`
  - Reconnect-Verhalten (Pool-gesteuert)

### Abnahmekriterien
- `decoderBackend = p3parser` liefert live Passings in bestehende Pipeline
- `timingPointId` korrekt gesetzt für alle verbundenen Decoder
- UI/Results verhalten sich identisch zur AMMC-Variante

---

## PR 8 – P3 Session Recovery / Resend nach Reconnect

### Ziel
Nach einem kurzen Verbindungsunterbruch eines P3-Decoders die verlorenen Passings automatisch nachanfordern.

### Hintergrund
`P3DecoderPool` bietet `requestSession(ip)` (gibt letzten Passing-Index zurück) und `requestPassings(ip, from, to)` (fordert Passings in einem Nummernbereich nach). Das ermöglicht lückenlosen Empfang auch bei kurzzeitigen TCP-Unterbrechungen. AMMC bietet diese Funktion nicht.

### Implementierungsdetail im P3ParserDecoderSourceAdapter
1. Worker merkt sich den letzten empfangenen `passingNumber` pro Decoder (in der `decoderToTimingPoint`-Map oder einer separaten Map)
2. Bei `onDecoderConnected` nach einem Reconnect (d.h. wenn Map bereits einen Eintrag für diese IP hat):
   - `pool.requestSession(ip)` aufrufen
   - aus der Session-Antwort (`P3SessionRecord.lastPassingIndex`) und dem lokalen letzten Index den fehlenden Bereich berechnen
   - `pool.requestPassings(ip, lastKnown + 1, sessionLastIndex)` aufrufen
3. Resend-Passings kommen als normale `onPassing`-Events – Duplikate über `passingId` deduplizieren

### Dateien anpassen
- `apps/livetracking-worker/src/decoder/adapters/p3ParserDecoderSourceAdapter.ts`
  - `lastPassingNumber: Map<string, number>` – pro hardware-decoderId letzten Index merken
  - `onDecoderConnected`: Reconnect-Erkennung + `requestSession` + `requestPassings`-Aufruf
  - Deduplizierung: bereits gesehene `passingId`s nicht erneut durchleiten (kleines Set mit Sliding Window)

### Tests
- `p3ParserDecoderSourceAdapter.test.ts`
  - Reconnect-Szenario: Passings 1-10, Disconnect, Reconnect, Resend 11-15
  - Deduplizierung: doppelt gemeldetes Passing nur einmal weitergeleitet

### Abnahmekriterien
- nach Reconnect werden fehlende Passings automatisch nachgefordert
- keine Duplikate in der Passing-Pipeline
- AMMC-Adapter unverändert (kein Resend für AMMC)

---

## PR 9 – Harmonisierung Runtime-Debug/Telemetry

### Ziel
Operations sollen klar sehen, welches Backend aktiv ist und wie stabil es läuft.

### Dateien anpassen
- `packages/domain/src/livetracking/runtime.ts` (oder entsprechendes Runtime-Dokument)
  - optionale Felder: `decoderBackend`, `decoderBackendHealth`, `decoderBackendWarnings`

- `apps/livetracking-worker/src/index.ts`
  - Health/Warnungen aus Adapter in Runtime-Dokument spiegeln

- `apps/livetracking-frontend/src/pages/livetracking/LiveTrackingControlPage.tsx`
  - Debug-Ansicht ergänzen: aktives Backend + Decoder-Status per Timing-Point (verbunden/getrennt, `decoderLabel`)

### Abnahmekriterien
- Backend + Health sichtbar im UI
- Warnungen nachvollziehbar pro Timing-Point (identifiziert über `decoderLabel`)

---

## PR-Schnitt und Reihenfolge (empfohlen)
1. PR1 (Datenverträge + `LiveTrackingRuntimePassingEvent` erweitern – Fundament)
2. PR2 (AMMC kapseln, `sessionLoop.ts` entkoppeln – größtes Risiko, früh adressieren)
3. PR3 (Factory + Adapter-Lifecycle in `sessionLoop.ts`)
4. PR4 (Domain-Modell, Naming, Datenmigration)
5. PR5 + PR6 (UI-Steuerung + wirksame Auswahl + Discovery-Scan)
6. PR7 (P3Parser-Backend, baut auf fertigem `P3DecoderPool` auf)
7. PR8 (P3 Session Recovery / Resend)
8. PR9 (Ops/Debug-Qualität)

---

## Checkliste für den finalen Abschluss
- [ ] `ammc` und `p3parser` jeweils über Setup umschaltbar
- [ ] `decoderLabel` konsistent in Domain, Worker und UI (keine Verwechslung mit hardware `decoderId`)
- [ ] alte Dokumente mit `decoderId` werden transparent via lazy migration auf `decoderLabel` umgestellt
- [ ] `LiveTrackingRuntimePassingEvent` um `transponderType`, `signalStrength`, `hits`, `lowBattery`, `passingTimeSource`, `backend` erweitert (alle optional)
- [ ] `decoderIp`-Eindeutigkeit als Validierungsregel
- [ ] gleiche `NormalizedPassing`-Struktur in beiden Backends
- [ ] `timingPointId` korrekt aufgelöst im P3-Adapter (via hardware-decoderId Map)
- [ ] `sessionLoop.ts` kennt keine AMMC- oder P3-spezifischen Imports mehr
- [ ] P3 Session Recovery: fehlende Passings nach Reconnect automatisch nachgefordert
- [ ] P3 Discovery Scan-Button im Setup-UI (nur bei `decoderBackend = p3parser`)
- [ ] keine Backend-spezifische Logik in Timing-Engine/UI
- [ ] Runtime zeigt aktives Backend + Health/Warnungen per Timing-Point
- [ ] End-to-End getestet: prepare/start/stop/reset in beiden Backends
