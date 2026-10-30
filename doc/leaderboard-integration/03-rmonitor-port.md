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

- **Zeiten intern als Millisekunden.** Formatiert wird erst in `toRaceTO`.
- `parseLine(raw)` wirft nie, damit ein kaputtes Paket nicht den Stream abbricht.
  - Ein unbekanntes Prefix ergibt `unknown`.
  - Ein bekanntes Prefix, das sich nicht parsen lässt, ergibt `invalid`.
- Die Feldindizes werden aus den Java-Parsern übernommen. Die JUnit-Tests werden 1:1 nach vitest portiert, das ist die Referenz.

> **Umgesetzt** (`packages/rmonitor`). Gegenüber diesem Entwurf weicht die Umsetzung zugunsten der Java-Kompatibilität ab:
> - **Zeiten sind `number` statt `number | null`.** Java parst jede Nachricht vollständig im Konstruktor. Ein leeres oder ungültiges Zeitfeld wirft dort eine Exception, und die ganze Zeile wird ohne Zustandsänderung verworfen. Der Port bildet das mit `invalid` nach.
> - **Zusätzliche Felder:** `source` in `compInfo` und `lapInfo`, `position` in `lapInfo`.
>
> Details stehen in [packages/rmonitor/README.md](../../packages/rmonitor/README.md).

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

**Regeln, unverändert aus `RaceManager` übernommen** (die Golden-Tests haben sie bestätigt):
- **Neues Rennen:**
  - `$B` mit einer anderen `uniqueId` als das aktuelle Rennen und **jedes** `$I` (ohne ID-Prüfung) starten ein neues Rennen.
  - Das alte Rennen wird `FINISH`. Es wird nur dann `previous`, wenn es eine ID hat.
- **Rennen ohne ID:** Nach `$I` hat das neue Rennen die ID −1. Bis zum nächsten `$B` liefert die REST-Sicht das vorherige Rennen.
  - Competitors, die zwischen `$I` und einem `$B` mit neuer ID kommen, gehen verloren. So verhält sich auch Java.
- Ein wiederholtes `$B` mit derselben `uniqueId` aktualisiert nur Name und Flagge.
- `$G` mit Position 1 setzt `race.lapsComplete`.
- **Flag-Mapping:**
  - Orbits füllt auf 6 Zeichen auf und schreibt gemischt (`"Green "`). Deshalb erst `trim`, dann Großschreibung.
  - `GREEN`/`YELLOW`/`RED`/`FINISH` werden direkt übernommen.
  - **Alles andere wird `PURPLE`, auch die leere Flagge.** Nur ein Rennen mit ID 0 und leerem Namen wird `NONE`.
  - `$B` setzt die Flagge ebenfalls auf `PURPLE`.
  - Folge: Java liefert praktisch nie einen leeren `flagStatus`. `pickCurrentRace` behandelt ein Rennen ohne Flagge deshalb als aktiv, und der Port verhält sich genauso.
- Leere numerische Felder in `$G`/`$H`/`$SP`/`$SR` (Runden vor der ersten Zieldurchfahrt) werden `0`. Leere Zeitfelder machen die Zeile ungültig (siehe oben).
- `bestLap` = Minimum aus `$H`, `$SP`/`$SR` und `$J`.
- Lap-Zuordnung über die Rundennummer bzw. `totalTime`, wie in `Competitor.update`.

**Bewusste Abweichungen:**
- Kein `PropertyChangeSupport`. Stattdessen gibt `apply()` eine `StoreChange` zurück, und die Diffs entstehen auf Snapshot-Ebene ([04-service-api.md](04-service-api.md)). Das behebt den `scheduledLaps`-Bug nebenbei.
- Keine Singletons. Der Store ist eine Instanz, das erleichtert Tests und Replay parallel zum Live-Betrieb.
- Die Klassen-Map gehört zum Store, nicht statisch zu `RaceClass`.
- Die Race-Map wird begrenzt: höchstens N Rennen (Default 200) im Speicher, damit mehrtägige Veranstaltungen nicht unbegrenzt wachsen. Echte Wettkampftage haben bis zu ca. 100 Rennen pro Aufnahme, 50 wären zu knapp.
- **`$COR` wird verarbeitet** (Java ignoriert es). Orbits sendet damit Zeitkorrekturen, praktisch nur bei 500-m-Sprints, also Zielfoto-Korrekturen der Schlussrunde:
  - Format: `$COR,"193","193",3,"00:00:46.517","-0:00:00.048"` = Reg.-Nr., Startnummer, Runde, korrigierte Gesamtzeit, Korrektur.
  - Orbits schickt direkt danach ein `$G` mit der korrigierten Gesamtzeit. Java übernimmt deshalb die Gesamtzeit, lässt aber `lastLap` unkorrigiert und legt eine doppelte Runde an.
  - Der Port korrigiert Gesamtzeit, Rundenzeit (= korrigierte Gesamtzeit − Gesamtzeit der Vorrunde), `lastLap` und ggf. `bestLap`.
  - Mit der Store-Option `corrections: "ignore"` verhält er sich wie Java. Die Golden-Tests nutzen diese Einstellung.

---

## 4. Ausgabeformat `toRaceTO()`

- Feldnamen und Reihenfolge exakt wie `RaceTO`/`CompetitorTO`, siehe [01-ist-analyse.md](01-ist-analyse.md#4-rest-api-jsonserver-jetty).
- `formatDuration(ms)` entspricht `DurationUtil.format`:

| Eingabe | Ausgabe |
|---|---|
| 15 000 | `0:15` |
| 15 032 | `0:15.032` |
| 3 723 004 | `1:02:03.004` |
| 0 (nicht gesetzt) | `0:00` (Java `Duration.ZERO`, durch Golden-Tests bestätigt) |

- Competitors werden nach `position` sortiert ausgegeben. Position 0 kommt ans Ende, wie in Swing (dort als 9999 angezeigt).
  - Java selbst liefert sie in HashMap-Reihenfolge. Die Golden-Tests vergleichen deshalb nach Normalisierung der Reihenfolge.
- Typ: `RaceStatusRace` aus `packages/domain/src/raceStatusFeed.ts`, erweitert um die optionalen Zusatzfelder. Bestehende Konsumenten (`pickCurrentRace`, `parseTimeToSeconds` in `apps/frontend/src/domain/liveTime.ts`) bleiben kompatibel.

---

## 5. Encoding

- Die Java-App liest mit dem Plattform-Charset. Unter Windows ist das meist `windows-1252`, und so sind die Umlaute in den Orbits-Namen kodiert.
- Der Port dekodiert Bytes über `TextDecoder(encoding)`. Konfigurierbar sind `utf-8`, `windows-1252` (Default) und `latin1`.
- Zeilenende: `\r\n` oder `\n`; ein unvollständiger Rest bleibt im Puffer.
- **Datei-Encoding ≠ Netzwerk-Encoding:** Die Java-Recordings schreibt der Recorder mit seinem eigenen Datei-Encoding, nachdem der Client den Stream dekodiert hat.
  - Die Tagesprotokolle von 2025 sind windows-1252, die von 2026 UTF-8. Orbits selbst sendet nach bisherigem Wissen windows-1252.
  - Der Java-Player hat deshalb getrennte Einstellungen für Datei und Stream und kodiert um. Das übernimmt der Player des Service (P2), zusätzlich mit einer UTF-8-Erkennung für importierte Dateien.
  - Der eigene Recorder schreibt die empfangenen Bytes unverändert, damit ein Replay byte-genau ist.

---

## 6. Teststrategie

1. **Parser-Unit-Tests:** Port der JUnit-Klassen (`*InfoTest`, `MessageFactoryTest`, `CompetitorTest`, `RaceTest`).
2. **Golden-Tests (Kompatibilitätsnachweis):**
   - **Referenz-Erzeugung mit steuerbarem Feeder statt Java-Player.** Ein kleiner Node-TCP-Server (Fake-Orbits-Feeder, siehe unten) sendet ein Recording **bis zu einer definierten Zeilennummer N** und hält dann an. Die Java-App ist als Client verbunden (`--headless -c --host <feeder-host> --port <feeder> -s`) und läuft im veröffentlichten Image `ghcr.io/bastianpaetzold/rmonitorleaderboard:1.3.0`, eine lokale Java-Installation ist also nicht nötig. Danach wird der Snapshot als JSON-Fixture gespeichert, und es geht bis zum nächsten Haltepunkt weiter.
   - **Synchronisation ohne Timing:** Die Java-App läuft mit `--loglevel=DEBUG` und loggt jede empfangene Zeile als `Message: …`. Das Skript wartet, bis die Zahl dieser Logzeilen der Zahl der gesendeten Zeilen entspricht, und liest erst dann `/races`. Zwei Läufe erzeugen identische Fixtures.
   - **Warum nicht der Java-Player:** Er spielt nach Wanduhrzeit ab (`Thread.sleep(Δt / speedup)`), lässt sich headless weder anhalten noch an eine Position setzen, und von außen ist nicht erkennbar, welche Zeile er zuletzt gesendet hat. Ein Snapshot „nach Zeile N“ ist damit nicht reproduzierbar.
   - Der Feeder prüft Java-Client, Java-Parser und JSON-Serialisierung des `JsonServer` gemeinsam, also genau die Referenz, gegen die das Scoring heute läuft. Er ist derselbe Fake-Orbits-Server, den die Service-Integrationstests in P2 brauchen, und entsteht nur einmal (`@raceoffice/rmonitor/testing`, `FakeOrbitsFeeder`).
   - **Haltepunkte:** Sie werden nach einer festen Regel bestimmt, statt sie je Recording von Hand zu pflegen (`selectCheckpoints`): nach jedem `$B` und `$I`, bei jedem Flaggenwechsel im `$F`, alle 1000 Zeilen und am Ende.
     - Die Fixture `test/fixtures/golden/<name>.golden.json` enthält je Haltepunkt das aktuelle Rennen.
     - Bei Rennwechseln und am Ende enthält sie zusätzlich `/races`.
   - Dieselben Recordings laufen im TS-Port **zeitfrei** durch `RaceStateStore`, ohne Player-Timing. Verglichen wird an denselben Zeilennummern.
   - Abweichungen werden je Feld dokumentiert und entweder behoben oder als bewusste Abweichung festgehalten.
   - **Alternative**, falls der Feeder-Weg hakt: ein Java-Harness (jshell/JUnit gegen das JAR), das Zeilen direkt in den Java-Parser schiebt und nach Zeile N das `RaceTO` als JSON ausgibt. Das ist noch deterministischer, umgeht aber `JsonServer` und hängt an Java-Interna.
   - **Java-Aufruf für die Referenz:** Encoding immer explizit setzen (`--client-stream-encoding windows-1252`), sonst nimmt die JVM unter Linux/Docker UTF-8. Für einen robusten Start `--client-max-retries -1 --client-retry-timeout 500` setzen. Die App läuft mit eigenem Arbeitsverzeichnis, damit keine persistierte Konfiguration hineinspielt.
   - **Recordings:** Die Aufnahmen aus dem Java-Repo dürfen verwendet werden. Weitere lokale Aufnahmen kommen hinzu, besonders solche mit `Yellow`/`Red`/`Finish`/`Purple` und mit Rennwechseln.
     - Ablage unter `packages/rmonitor/test/fixtures/recordings/`
     - Derzeit sind sechs Aufnahmen aus dem Java-Repo enthalten (ca. 1,2 MB): Elimination, Punkterennen, 500 m, Stundenrekord, Dobbin. Sie liegen ungekürzt vor, damit die Haltepunkte den echten Ablauf abbilden.
     - Die Dateien liegen in **windows-1252 mit CRLF** vor und werden byte-genau übernommen (`.gitattributes`: `*.txt -text` im Fixture-Ordner).
3. **Property-/Robustheitstests:**
   - Zufällig zerschnittene TCP-Chunks ergeben denselben Zustand; kaputte Zeilen brechen nichts.
   - **Encoding:** `leaderboard-recording_AGI_2022_pts_Sen_Men.txt` enthält Umlaute als windows-1252-Bytes (z. B. „Bühnemann“, `0xFC`). Ein fester Test prüft die korrekte Dekodierung, ein zweiter zeigt, dass mit `utf-8` Ersatzzeichen entstehen.
   - **Recording-Format:** Zeitstempel mit führenden Nullen (`0995`) und Recordings, die ohne `$I` direkt mit `$F` beginnen (`1h_Record_test.txt`), werden korrekt verarbeitet.
   - **Zeilenenden:** `\r\n`, `\n` und gemischte Zeilenenden ergeben denselben Zustand. Der Java-Player sendet zum Beispiel das Zeilenende des Systems.
4. **Scoring-Kompatibilität:** `examples/race_status*.json` und `packages/race-status-mock` bleiben als JSON-Fixtures für die Frontend-Tests bestehen.
