# LiveTracking: Decoder-Backend Architekturplan (AMMC + P3Parser)

## Ziel
LiveTracking soll zur Laufzeit umschaltbar unterstützen:
- `ammc` (pro Decoder eine Verbindung / WebSocket-Quelle)
- `p3parser` (eine aggregierende Verbindung für mehrere Decoder)

Dabei sollen bestehende Setup-/Start-/Stop-Abläufe erhalten bleiben und die Decoder-Anbindung sauber austauschbar sein.

---

## Randbedingungen
- **Kurzfristig**: Passings müssen noch **nicht** sofort persistent gespeichert werden.
- **Später optional**: Persistenz von Passings soll ohne großen Umbau nachziehbar sein.
- **Architekturregel**: Der Server bleibt die zentrale Instanz für Dokumentzustände (`session/runtime/results`).

---

## Architekturvorschlag

## 1) Decoder-Adapter-Schicht im Worker
Im Worker wird eine einheitliche Adapter-Schnittstelle eingeführt.

```ts
export type DecoderBackendKind = "ammc" | "p3parser";

export type NormalizedPassing = {
  passingId: string;
  timestamp: string;
  passingTimeSource?: "rtc" | "utc";  
  passingNumber: number;
  transponderId: string;
  decoderId: string;
  timingPointId: string;
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

Empfehlung:
- AMMC-ähnliche Felder beibehalten
- Erweiterung um `backend` + optional `raw`
- Stabil halten, damit spätere Persistenz/Replays darauf aufbauen können

---

## 3) Setup-/Session-Konfiguration erweitern
Im Setup (oder Session-spezifisch) wird hinterlegt, welches Backend aktiv ist.

Beispiel-Felder:
- `decoderBackend: "ammc" | "p3parser"`
- optional backend-spezifische Einstellungen:
  - `ammcConfig` (z. B. pro TimingPoint Host/Port)
  - `p3ParserConfig` (z. B. zentrale Endpoint-Config + Decoderliste)

Beim `prepare/start` wird danach der passende Adapter instanziiert.

---

## 4) Datenfluss ohne Persistenz (Phase 1)
Solange Persistenz optional ist:
1. Adapter liefert `NormalizedPassing`
2. Worker verarbeitet weiter wie heute (Runtime/Results-Update)
3. Passings werden live verteilt (über bestehende Dokumentmechanik / Realtime)

Wichtig:
- Das Format bereits so wählen, dass später 1:1 in DB geschrieben werden kann.
- Keine AMMC- oder P3-spezifische Speziallogik in der fachlichen Timing-Engine.

---

## 5) Persistenz später optional nachziehen (Phase 2)
Wenn Persistenz gewünscht ist:
- Server-seitig Ingest-Schnittstelle ergänzen (z. B. Endpoint/Eventkanal für passings)
- Tabelle `passings` einführen
- Optionaler Schalter in Config:
  - `passingsPersistenceEnabled: boolean`

Bei `false`:
- Verhalten wie Phase 1 (nur live)

Bei `true`:
- zusätzlich persistieren
- später Replay/Export/Recovery möglich

Beispiel Tabellenschema (SQLite, grob):
- `id` (PK)
- `session_id`
- `setup_id`
- `timestamp`
- `decoder_id`
- `timing_point_id`
- `transponder_id`
- `backend`
- `payload_json` (optional raw)
- `ingested_at`

Empfohlene Indexe:
- `(session_id, timestamp)`
- `(session_id, decoder_id, timestamp)`
- `(transponder_id, timestamp)`

---

## Umsetzungsreihenfolge (angepasst: Persistenz optional am Ende)

### Phase A – Entkopplung & Backend-Umschaltung
1. `NormalizedPassing` + Adapter-Interface definieren
2. Bestehende AMMC-Anbindung in `AmmcDecoderSourceAdapter` kapseln
3. Worker so umbauen, dass er nur das Adapter-Interface nutzt
4. Setup/Session um `decoderBackend` erweitern
5. `P3ParserDecoderSourceAdapter` implementieren
6. Ende-zu-Ende testen: Umschalten zwischen `ammc` und `p3parser`

### Phase B – Optional: Persistenz nachziehen
7. Server-Ingest-Pfad für passings ergänzen
8. Optionale Speicherung in `passings`-Tabelle einführen
9. Optional Replay-/Export-Funktionen auf `passings` aufbauen

---

## Nicht-Ziele (für diesen Umbau)
- Kein großer Refactor der gesamten Realtime-Infrastruktur
- Keine sofortige Migration aller bestehenden Dokumente
- Keine fachliche Änderung der Timing-Engine-Regeln

---

## Entscheidungsprinzipien
- **Interface first**: zuerst Adapter-Schnittstelle stabilisieren
- **Format first**: früh ein kanonisches Passing-Modell festlegen
- **Persistence last**: Persistenz als additive, optionale Schicht
- **No duplicated domain logic**: Fachlogik bleibt zentral, Backend-spezifische Logik bleibt im Adapter

---

## Ergebnisbild
Nach Phase A:
- LiveTracking kann zwischen AMMC und P3Parser umschalten
- gleiche Live-Ansichten, gleiche fachliche Berechnung
- keine harte Kopplung an Decoder-spezifisches Protokoll

Nach Phase B (optional):
- alle passings können dauerhaft gespeichert und später wiederverwendet werden
- Grundlage für Replay, Auditing, Export und robustere Recovery

---

## Konkreter Umsetzungsplan (Datei-/Modulgenau)

Dieser Abschnitt ist als direkte Arbeitsgrundlage gedacht (in kleinen PRs umsetzbar).

## PR 1 – Worker-Adapter-Vertrag einführen (ohne Verhaltensänderung)

### Ziel
Saubere Schnittstelle schaffen, noch ohne Umschaltung in der UI.

### Dateien anlegen
- `apps/livetracking-worker/src/decoder/adapters/decoderSourceAdapter.ts`
  - `DecoderBackendKind`
  - `NormalizedPassing`
  - `DecoderSourceAdapter` Interface
  - gemeinsame Callback-/Health-Typen

- `apps/livetracking-worker/src/decoder/adapters/normalizedPassing.ts`
  - Hilfsfunktionen: `createPassingId`, Normalisierung von Timestamps, optionale Raw-Payload-Anreicherung

### Dateien anpassen
- `apps/livetracking-worker/src/index.ts`
  - nur Imports/Types vorbereiten
  - keine funktionale Änderung am Runtime-Verhalten

### Abnahmekriterien
- Worker baut unverändert
- keine Laufzeitänderung
- neue Typen sind zentral verfügbar und dokumentiert

---

## PR 2 – AMMC in `AmmcDecoderSourceAdapter` kapseln

### Ziel
Bestehende AMMC-Anbindung aus dem Worker-Loop herauslösen, Verhalten 1:1 beibehalten.

### Dateien anlegen
- `apps/livetracking-worker/src/decoder/adapters/ammcDecoderSourceAdapter.ts`
  - übernimmt komplette AMMC-Verbindungs-/WS-Logik
  - liefert `NormalizedPassing`
  - mapped AMMC-spezifische Warnungen auf `onWarning`

### Dateien anpassen
- `apps/livetracking-worker/src/index.ts`
  - direkte AMMC-Logik entfernen
  - stattdessen Adapter instanziieren (`new AmmcDecoderSourceAdapter(...)`)
  - `onPassing` an bisherigen Verarbeitungsfluss anbinden

- vorhandene AMMC-Hilfsdateien (falls vorhanden im Worker)
  - ggf. nach `src/decoder/ammc/*` verschieben/importpfade anpassen

### Tests
- vorhandene Worker-Tests anpassen (Mock auf Adapterebene)
- neu: `apps/livetracking-worker/src/decoder/adapters/ammcDecoderSourceAdapter.test.ts`

### Abnahmekriterien
- funktional identisches Verhalten zu vorher (nur strukturell gekapselt)
- prepare/start/stop unverändert nutzbar

---

## PR 3 – Adapter-Factory + Backend-Auswahl im Worker

### Ziel
Backend zentral auswählbar machen (`ammc` als Default).

### Dateien anlegen
- `apps/livetracking-worker/src/decoder/adapters/createDecoderSourceAdapter.ts`
  - Factory: `(backendKind, config) => DecoderSourceAdapter`
  - defensiver Fallback + klare Fehlermeldung

### Dateien anpassen
- `apps/livetracking-worker/src/index.ts`
  - Adapter nur noch über Factory erzeugen
  - worker runtime state um `backendKind` ergänzen (für Debug/Runtime-Dokument)

### Abnahmekriterien
- Default bleibt `ammc`
- Worker kann mit explizitem Backend-Parameter starten (auch wenn erst nur `ammc` implementiert ist)

---

## PR 4 – Domain-Modell für Backend-Wahl erweitern

### Ziel
Setup/Session sollen fachlich ausdrücken können, welches Decoder-Backend gewünscht ist.

### Dateien anpassen (Domain)
- `packages/domain/src/livetracking/setup.ts`
  - Feld ergänzen: `decoderBackend?: "ammc" | "p3parser"`
  - optional: `decoderBackendConfig` (sauber typisiert)

- `packages/domain/src/livetracking/session.ts`
  - falls Session das Setup snapshoted: entsprechendes Feld übernehmen

- `packages/domain/src/livetracking/initializers/...` (je nach Struktur)
  - Defaults setzen: `decoderBackend: "ammc"`

- `packages/domain/src/livetracking/*.test.ts`
  - Initializer-/Guard-Tests aktualisieren

### Abnahmekriterien
- bestehende Dokumente bleiben kompatibel (Fallback auf `ammc`)
- Type Guards/Defaults greifen robust

---

## PR 5 – UI: Backend-Wahl im LiveTracking Setup

### Ziel
Im LiveTracking-Frontend auswählbar machen (ohne P3-Verbindung bereits aktiv zu nutzen).

### Dateien anpassen
- `apps/livetracking-frontend/src/pages/livetracking/LiveTrackingControlPage.tsx`
  - Select-Feld für `decoderBackend`
  - Save-Flow erweitert (Setup-Doc)
  - Anzeige im Debug-Block

- optional Parallelpflege im Haupt-Frontend (falls weiterhin relevant):
  - `apps/frontend/src/pages/livetracking/LiveTrackingControlPage.tsx`

### Abnahmekriterien
- Backend-Wahl wird gespeichert und nach Reload korrekt angezeigt
- bei fehlendem Wert wird `ammc` angezeigt/genutzt

---

## PR 6 – Worker zieht Backend-Wahl aus Setup/Session

### Ziel
Factory-Auswahl nicht mehr nur CLI/default, sondern aus LiveTracking-Dokumenten.

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
Zweites Backend vollständig lauffähig integrieren.

### Dateien anlegen
- `apps/livetracking-worker/src/decoder/adapters/p3ParserDecoderSourceAdapter.ts`
  - eine aggregierte Verbindung zum P3-Parser
  - Mapping auf `NormalizedPassing`
  - health/warning callbacks

### Dateien anpassen
- `apps/livetracking-worker/src/decoder/adapters/createDecoderSourceAdapter.ts`
  - Branch für `p3parser`

- ggf. neue Konfigurationsdatei/Typen:
  - `apps/livetracking-worker/src/decoder/adapters/p3ParserConfig.ts`

### Tests
- `.../p3ParserDecoderSourceAdapter.test.ts`
  - Parsing, Reconnect, Duplicate-Handling, Decoder-Mapping

### Abnahmekriterien
- `decoderBackend = p3parser` liefert live Passings in bestehende Pipeline
- UI/Results verhalten sich identisch zur AMMC-Variante

---

## PR 8 – Harmonisierung Runtime-Debug/Telemetry

### Ziel
Operations sollen klar sehen, welches Backend aktiv ist und wie stabil es läuft.

### Dateien anpassen
- `packages/domain/src/livetracking/runtime.ts` (oder entsprechendes Runtime-Dokument)
  - optionale Felder: `decoderBackend`, `decoderBackendHealth`, `decoderBackendWarnings`

- `apps/livetracking-worker/src/index.ts`
  - Health/Warnungen aus Adapter in Runtime-Dokument spiegeln

- `apps/livetracking-frontend/src/pages/livetracking/LiveTrackingControlPage.tsx`
  - Debug-Ansicht ergänzen

### Abnahmekriterien
- Backend + Health sichtbar
- Warnungen nachvollziehbar im UI

---

## PR 9 (optional, später) – Persistenz-Schicht für Passings

### Ziel
Passings optional dauerhaft speichern, ohne Phase-A-Architektur umzubauen.

### Dateien anpassen (Server)
- `apps/server/src/index.ts`
  - Ingest-Pfad für passings (vom Worker)
  - Feature-Flag/Config: `PASSINGS_PERSISTENCE_ENABLED`

- `apps/server/src/db/...` (neu, falls DB-Schicht extrahiert wird)
  - Migration/DDL für `passings`
  - Insert + Query helper

- `apps/server/src/services/...` (neu)
  - `liveTrackingPassingIngestService.ts`

### Dateien anpassen (Worker)
- `apps/livetracking-worker/src/index.ts`
  - zusätzlich zum bisherigen Live-Flow: passings an Server-Ingest senden

### Abnahmekriterien
- Flag `false`: Verhalten wie heute
- Flag `true`: Passings werden persistiert
- keine Änderung am Adapter-Interface notwendig

---

## PR-Schnitt und Reihenfolge (empfohlen)
1. PR1 + PR2 (technische Entkopplung, risikoarm)
2. PR3 + PR4 (Backend-Auswahl fachlich vorbereiten)
3. PR5 + PR6 (UI-Steuerung + wirksame Auswahl)
4. PR7 (P3Parser-Backend)
5. PR8 (Ops/Debug-Qualität)
6. PR9 optional (Persistenz)

---

## Checkliste für den finalen Abschluss
- [ ] `ammc` und `p3parser` jeweils über Setup umschaltbar
- [ ] gleiche `NormalizedPassing`-Struktur in beiden Backends
- [ ] keine Backend-spezifische Logik in Timing-Engine/UI
- [ ] Runtime zeigt aktives Backend + Health/Warnungen
- [ ] (optional) Persistenz per Flag aktivierbar, ohne Umbau der Adapter
- [ ] End-to-End getestet: prepare/start/stop/reset in beiden Backends
