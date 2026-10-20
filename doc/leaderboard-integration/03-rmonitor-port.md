# 03 – Port von Protokoll und Zustandsmodell (`packages/rmonitor`)

## 1. Paketaufbau

```
packages/rmonitor/
  src/
    tokenize.ts          // CSV-Tokenizer mit "-Quotes, leere Tokens bleiben erhalten
    duration.ts          // parseDuration / formatDuration (kompatibel zu DurationUtil)
    messages/
      types.ts           // getypte Nachrichten (discriminated union über `kind`)
      parseLine.ts       // Prefix → Parser, unbekannt → { kind: "unknown", raw }
      heartbeat.ts       // $F
      compInfo.ts        // $A, $COMP
      runInfo.ts         // $B
      classInfo.ts       // $C
      settingInfo.ts     // $E
      raceInfo.ts        // $G
      qualiInfo.ts       // $H
      initRecord.ts      // $I
      passingInfo.ts     // $J
      lapInfo.ts         // $SP, $SR
    state/
      model.ts           // RaceState, CompetitorState, FlagStatus
      raceStateStore.ts  // apply(msg) → ChangeSet; current/previous/all
      toRaceTO.ts        // Zustand → RaceStatusRace (REST-/WS-Format)
    recording/
      format.ts          // parseRecordingLine / formatRecordingLine ("<ms> <raw>")
    index.ts
  test/
    messages/*.test.ts   // Port der JUnit-Parser-Tests
    golden/*.test.ts     // Recordings → Snapshots gegen Java-Referenz
    fixtures/            // Recordings + erwartete JSON-Snapshots
```

Das Paket hat keine Laufzeitabhängigkeiten außer `@raceoffice/domain` (für die Typen).

---

## 2. Nachrichtenmodell

```ts
export type RMonitorMessage =
  | { kind: "heartbeat"; lapsToGo: number; timeToGoMs: number | null; timeOfDayMs: number | null; raceTimeMs: number | null; flag: string }
  | { kind: "compInfo"; regNumber: string; number: string; transNumber?: string; firstName: string; lastName: string; nationality: string; classId: number | null; addData?: string }
  | { kind: "runInfo"; uniqueId: number; description: string }
  | { kind: "classInfo"; classId: number; description: string }
  | { kind: "settingInfo"; description: string; value: string }
  | { kind: "raceInfo"; position: number; regNumber: string; laps: number; totalTimeMs: number | null }
  | { kind: "qualiInfo"; position: number; regNumber: string; bestLap: number; bestLapTimeMs: number | null }
  | { kind: "initRecord"; timeOfDayMs: number | null; date: string }
  | { kind: "passingInfo"; regNumber: string; lapTimeMs: number | null; totalTimeMs: number | null }
  | { kind: "lapInfo"; regNumber: string; lapNumber: number; lapTimeMs: number | null }
  | { kind: "unknown"; prefix: string; raw: string };
```

- **Zeiten intern als Millisekunden** (`number | null`). Formatiert wird erst in `toRaceTO`.
- `parseLine(raw)` wirft nie. Fehlerhafte Zeilen ergeben `unknown` mit Warnung, damit ein kaputtes Paket nicht den Stream abbricht.
- Die Feldindizes werden aus den Java-Parsern übernommen. Die JUnit-Tests werden 1:1 nach vitest portiert, das ist die Referenz.

---

## 3. Zustandsmodell

```ts
export type FlagStatus = "PURPLE" | "GREEN" | "YELLOW" | "RED" | "FINISH" | "NONE";

export type RaceState = {
  id: number | null;
  name: string;
  trackName: string;
  trackLength: number | null;
  flagStatus: FlagStatus;
  lapsComplete: number;
  lapsToGo: number;
  timeOfDayMs: number | null;
  elapsedMs: number | null;
  timeToGoMs: number | null;
  competitors: Map<string, CompetitorState>; // Schlüssel: regNumber
  rev: number;                               // steigt bei jeder fachlichen Änderung
};

export class RaceStateStore {
  apply(msg: RMonitorMessage): StoreChange;   // { raceChanged, newRace, competitorsChanged }
  get current(): RaceState | null;
  get previous(): RaceState | null;
  get all(): RaceState[];
  getById(id: number): RaceState | null;
  reset(): void;
}
```

**Regeln, unverändert aus `RaceManager` übernommen:**
- `$B` mit neuer `uniqueId` oder `$I`:
  - aktuelles Rennen → `FINISH`, wird `previous`
  - neues Rennen anlegen
- `$G` mit Position 1 setzt `race.lapsComplete`.
- Flag-Mapping:
  - Orbits sendet auf 6 Zeichen aufgefüllt und in gemischter Schreibweise (`"Green "`), daher erst `trim`, dann Großschreibung
  - leer → `NONE`
  - unbekannte Werte → `PURPLE`, bei leerem Rennen → `NONE`
  - wie Java leere Flaggen genau in `flagStatus` des JSON überträgt, klären die Golden-Tests. Das ist wichtig, weil `pickCurrentRace` ein Rennen mit leerem `flagStatus` als „kein aktives Rennen“ behandelt.
- Leere numerische Felder (z. B. `laps` in `$G` vor der ersten Zieldurchfahrt) → `0`; leere Zeitfelder → `null`.
- Ein wiederholtes `$I`/`$B` mit derselben `uniqueId` legt kein neues Rennen an.
- `bestLap` = Minimum aus `$H`, `$SP`/`$SR` und `$J`.
- Lap-Zuordnung über die Rundennummer bzw. `totalTime`, wie in `Competitor.update`.

**Bewusste Abweichungen:**
- Kein `PropertyChangeSupport`. Stattdessen gibt `apply()` eine `StoreChange` zurück, und die Diffs entstehen auf Snapshot-Ebene ([04-service-api.md](04-service-api.md)). Das behebt den `scheduledLaps`-Bug nebenbei.
- Keine Singletons. Der Store ist eine Instanz, das erleichtert Tests und Replay parallel zum Live-Betrieb.
- Die Klassen-Map gehört zum Store, nicht statisch zu `RaceClass`.
- Die Race-Map wird begrenzt: höchstens N Rennen (Default 50) im Speicher, damit lange Veranstaltungstage nicht unbegrenzt wachsen.

---

## 4. Ausgabeformat `toRaceTO()`

- Feldnamen und Reihenfolge exakt wie `RaceTO`/`CompetitorTO`, siehe [01-ist-analyse.md](01-ist-analyse.md#4-rest-api-jsonserver-jetty).
- `formatDuration(ms)` entspricht `DurationUtil.format`:

| Eingabe | Ausgabe |
|---|---|
| 15 000 | `0:15` |
| 15 032 | `0:15.032` |
| 3 723 004 | `1:02:03.004` |
| `null` | `""` (wie Java bei `Duration.ZERO`; in den Golden-Tests prüfen) |

- Competitors werden nach `position` sortiert ausgegeben. Position 0 kommt ans Ende, wie in Swing (dort als 9999 angezeigt).
- Typ: `RaceStatusRace` aus `packages/domain/src/raceStatusFeed.ts`, erweitert um die optionalen Zusatzfelder. Bestehende Konsumenten (`pickCurrentRace`, `parseTimeToSeconds` in `apps/frontend/src/domain/liveTime.ts`) bleiben kompatibel.

---

## 5. Encoding

- Die Java-App liest mit dem Plattform-Charset. Unter Windows ist das meist `windows-1252`, und so sind die Umlaute in den Orbits-Namen kodiert.
- Der Port dekodiert Bytes über `TextDecoder(encoding)`. Konfigurierbar sind `utf-8`, `windows-1252` (Default) und `latin1`.
- Zeilenende: `\r\n` oder `\n`; ein unvollständiger Rest bleibt im Puffer.

---

## 6. Teststrategie

1. **Parser-Unit-Tests:** Port der JUnit-Klassen (`*InfoTest`, `MessageFactoryTest`, `CompetitorTest`, `RaceTest`).
2. **Golden-Tests (Kompatibilitätsnachweis):**
   - Recordings aus `recordings/*.txt` werden durch die **Java-App** abgespielt (`-p --player-file … -c --host 127.0.0.1 -s`). Ein kleines Skript zieht zu definierten Zeitpunkten `/races` als JSON-Fixture.
   - Dieselben Recordings laufen im TS-Port **zeitfrei** durch `RaceStateStore`, ohne Player-Timing. Verglichen wird nach denselben Zeilennummern, nicht nach Wanduhrzeit.
   - Abweichungen werden je Feld dokumentiert und entweder behoben oder als bewusste Abweichung festgehalten.
   - **Recordings:** Die Aufnahmen aus dem Java-Repo dürfen verwendet werden. Weitere lokale Aufnahmen kommen hinzu, besonders solche mit `Yellow`/`Red`/`Finish`/`Purple` und mit Rennwechseln.
     - Ablage unter `packages/rmonitor/test/fixtures/recordings/`
     - große Dateien gekürzt bzw. nur ausgewählte Rennen
3. **Property-/Robustheitstests:** zufällig zerschnittene TCP-Chunks ergeben denselben Zustand; kaputte Zeilen brechen nichts.
4. **Scoring-Kompatibilität:** `examples/race_status*.json` und `packages/race-status-mock` bleiben als JSON-Fixtures für die Frontend-Tests bestehen.
