# 01 – Ist-Analyse RMonitorLeaderboard

Quelle: `bastianpaetzold/RMonitorLeaderboard`, Branch `main`, Version 1.3.0. Build mit Maven, Java 17 (JPMS).
Abhängigkeiten: picocli, Jetty 10, Gson, MigLayout (Swing), commons-text, logback, JUnit 5.

---

## 1. Paketstruktur

| Paket (`com.zacharyfox.rmonitor.*`) | Inhalt |
|---|---|
| `client` | `RMonitorClient`: TCP-Client (Singleton) |
| `message` | `MessageFactory`, `RMonitorMessage`, eine Klasse je Nachrichtentyp |
| `entities` | `Race`, `Competitor`, `Lap`, `RaceClass`, `RaceManager`; DTOs `RaceTO`, `CompetitorTO` |
| `utils` | `JsonServer`, `Player`, `Recorder`, `Estimator`, `DurationUtil`, `ExponentialMovingAverage` |
| `config` | `ConfigurationManager` (`LeaderBoard.properties`) |
| `leaderboard` | Swing-UI: `LeaderBoard` (main), Tabellen, Menü, `frames/*` |

Ein Container-Dockerfile gibt es bereits (`container/Dockerfile`). Es betreibt die Java-App mit `--headless`.

---

## 2. Empfang von Orbits

- `RMonitorClient` öffnet `Socket(host, port)` und liest zeilenweise mit `BufferedReader`.
  - Default: `127.0.0.1:50000`, Encoding = Plattform-Charset.
  - Retry: 3 Versuche (−1 = unendlich), 10 000 ms Pause.
  - Zustände: `STARTED`, `CONNECTING`, `CONNECTED`, `STOPPING`, `STOPPED`, an Listener gemeldet.
- Für jede Zeile:
  1. `RaceManager.processMessage(MessageFactory.createMessage(line))`
  2. `Recorder.push(line)`
  3. `Estimator.update()`
- `MessageFactory` tokenisiert per Komma, mit `"` als Quote-Zeichen; leere Tokens bleiben erhalten. `tokens[0]` wählt den Parser.

### Nachrichtentypen

| Prefix | Klasse | Wirkung im Modell |
|---|---|---|
| `$F` | Heartbeat | `lapsToGo`, `timeToGo`, `timeOfDay`, `elapsedTime` (raceTime), `flagStatus`. Daraus `scheduledLaps`/`scheduledTime` abgeleitet. |
| `$A`, `$COMP` | CompInfo | Competitor anlegen/aktualisieren (Nummer, Name, Nation, Klasse) |
| `$B` | RunInfo | Neue `uniqueId` → `startNewRace()`: altes Rennen auf FINISH, wird `previousRace` |
| `$C` | ClassInfo | statische Klassen-Map |
| `$E` | SettingInfo | `TRACKNAME`, `TRACKLENGTH` |
| `$G` | RaceInfo | `position`, `lapsComplete`, `totalTime`. Bei P1 zusätzlich `race.lapsComplete`. |
| `$H` | QualiInfo | `qualiPosition`, `bestLap` |
| `$I` | InitRecord | `startNewRace()` |
| `$J` | PassingInfo | `lastLap`, `totalTime`, `bestLap` (ohne Versions-Inkrement) |
| `$SP`, `$SR` | LapInfo | Lap-Liste, `bestLap` |
| sonst (z. B. `$RMS`) | – | geloggt, ignoriert |

`$F` im Detail: `[1]` lapsToGo, `[2]` timeToGo, `[3]` timeOfDay, `[4]` raceTime, `[5]` flagStatus.
Zeiten werden mit `LocalTime.parse` gelesen, also im Format `HH:mm:ss[.SSS]`.

---

## 3. Zustandsmodell

- `RaceManager` (Singleton) hält `Map<Integer, Race>`, `currentRace` und `previousRace`.
- `Race`:
  - `id`, `name`, `trackName`, `trackLength`, `flagStatus`, `lapsComplete`, `lapsToGo`, `scheduledLaps`, `timeOfDay`, `elapsedTime`, `timeToGo`, `scheduledTime`
  - `competitorMap`, `competitorsVersion`
- `FlagStatus`: `PURPLE`, `GREEN`, `YELLOW`, `RED`, `FINISH`, `NONE`. Ein unbekannter Wert wird zu `PURPLE`, bei leerem Rennen zu `NONE`.
- `Competitor`:
  - `regNumber`, `transNumber`, `number`, `firstName`, `lastName`, `nationality`, `addData`, `classId`
  - `totalTime`, `bestLap`, `lastLap`, `avgLap`, `lapsComplete`, `position`, `qualiPosition`, `laps[]`
- Änderungen werden per `PropertyChangeSupport` gemeldet. Die Swing-Tabelle aktualisiert sich bei jeder Änderung von `competitorsVersion`.

---

## 4. REST-API (`JsonServer`, Jetty)

- Bindet an `server.host` (`0.0.0.0`) und `server.port` (`8080`).
- **Jede HTTP-Methode** wird gleich behandelt.
- Content-Type `application/json`, Header `Access-Control-Allow-Origin: *`.

| Pfad | Antwort |
|---|---|
| `/race/{id}` | `RaceTO` des Rennens oder 404 |
| `/race`, `/`, alle anderen Pfade | aktuelles Rennen, sonst das vorherige |
| `/races` | Array aller Rennen |
| `/races?filter=current` | Array mit genau dem aktuellen Rennen (wird heute von RaceOffice genutzt) |

```json
{
  "raceName": "Elimination U17m", "raceID": 12, "flagStatus": "GREEN",
  "elapsedTime": "4:12", "timeOfDay": "14:03:22",
  "lapsComplete": 7, "lapsToGo": 13,
  "trackName": "Groß-Gerau", "trackLength": 0.2,
  "competitors": [
    { "number": "17", "position": 1, "lapsComplete": 7,
      "firstName": "Max", "lastName": "Muster (GER)",
      "totalTime": "4:11.532", "bestLap": "0:21.004", "lastLap": "0:21.310",
      "qualiPosition": 0 }
  ]
}
```

**Zeitformat (`DurationUtil.format`):**
- `m:ss` bei 0 Stunden, sonst `H:mm:ss`
- `.SSS` nur, wenn Millisekunden ≠ 0
- Stunden ohne führende Null

**Nicht in der API enthalten:** `timeToGo`, `scheduledLaps`, `classId`, `avgLap`, `regNumber`.

Die RaceOffice-Typen dazu stehen in `packages/domain/src/raceStatusFeed.ts` (`RaceStatusRace`, `RaceStatusCompetitor`, `pickCurrentRace`). Sie bilden bisher nur einen Teil der Felder ab.

---

## 5. Swing-Sichten

| Sicht | Inhalt |
|---|---|
| **MainFrame** | Rennname, Strecke, 2×2-Flaggenfeld (FINISH als Schachbrett), „Elapsed“, „To Go“ (Zeit oder Runden). Tabelle: Pos, PIC, #, Class, Name, Laps, Total Time, Last, Best, Avg. |
| **Full Screen** | Exklusiver Vollbildmodus, ohne Cursor und Menü, Esc beendet |
| **ConnectFrame** | Host, Port, Encoding, Connect/Disconnect |
| **ServerFrame** | Webserver Host/Port, Start/Stop |
| **Recorder** | Datei wählen, Start/Stop |
| **Player** | Datei, Speedup, Port, Start/Pause/Stop. Ist ein TCP-Server, mit dem sich der Client verbindet. |
| **Estimator** | Projektion von Endrunden und Endzeit. *Faktisch defekt, wird nicht übernommen.* |
| **Start Signal** | Vollbild: Rennname, Flaggenfarbe (bei PURPLE die Startnummern), Uhr |
| **Lap Counter** | Große Rundenzahl (weiß auf schwarz), Up/Down, Update-Verzögerung (Default 5 s), Flaggenstreifen |
| **Finish Line Log** | Liste der Zieldurchfahrten, Zeilenhöhe konfigurierbar |

---

## 6. CLI und Konfiguration

- picocli-Optionen:
  - `--headless`, `--loglevel`
  - Client: `-c`, `--host`, `--port`, `--client-stream-encoding`, `--client-max-retries`, `--client-retry-timeout`
  - Server: `-s`, `--server-host`, `--server-port`
  - Player: `-p`, `--player-file`, `--player-speedup`, `--player-port`, Encodings
  - Recorder: `-r`, `--recorder-file`
- Konfiguration: `LeaderBoard.properties` im Arbeitsverzeichnis, wird bei jedem `set` gespeichert. Schlüssel u. a.:
  - `client.host`, `client.port`, `client.encoding`
  - `server.host`, `server.port`
  - `player.*`, `recorder.*`
  - `finishLineLog.rowHeight`
- Recording-Format: `<ms seit erster Nachricht> <Rohzeile>`, nach jeder Zeile geflusht.
- Beispiel-Recordings unter `recordings/*.txt`, überwiegend Radsport/Bahn (Elimination, Punkte, 500 m, Stundenrekord).

---

## 6a. Beobachtungen aus echten Aufnahmen

Ausgewertet wurden `leaderboard-recording_Elimination_AGI_2018.txt` (10 672 Zeilen, ca. 17 min) und `leaderboard-recording_AGI_2022_pts_Sen_Men.txt`.

**Verteilung der Nachrichten (Elimination):**

| Typ | Anzahl |
|---|---|
| `$F` | 1 168 |
| `$G` | 1 998 |
| `$H` | 2 201 |
| `$J` | 1 030 |
| `$SP` | 2 194 |
| `$SR` | 1 998 |
| `$A` / `$COMP` | je 36 |
| `$E` | 4 |
| `$I` | 4 |
| `$B` | 2 |
| `$C` | 1 |

Das sind im Rennen etwa 10 Zeilen pro Sekunde, in Spitzen beim Zieldurchgang des Feldes deutlich mehr.

```
4      $F,50,"00:00:00","13:51:48","00:00:00","      "
4      $B,77,"Juniors ladies 10000 Elim-Final A"
5      $E,"TRACKLENGTH","0.200"
10     $A,"679","679",NK-04720,"Edda","Paluzzi (ITA)","ITA",1
11     $COMP,"679","679",1,"Edda","Paluzzi (ITA)","ITA",""
73     $G,1,"679",,"00:00:00"
94432  $F,49,"00:00:00","13:53:23","00:00:33","Green "
103697 $F,48,"00:00:00","13:53:32","00:00:42","Green "
371541 $J,"697","00:00:19.701","00:05:09.953"
527230 $G,4,"697",24,"00:07:45.382"
```

**Konsequenzen für den Port:**
- **Der Heartbeat `$F` kommt verlässlich jede Sekunde**, mit aktueller Tageszeit (`timeOfDay`) und Rennzeit (`raceTime`).
  - In der Elimination-Aufnahme gibt es keine Lücke über 1,1 s.
  - Zusätzlich sendet Orbits außer der Reihe ein `$F`, sobald sich `lapsToGo` ändert (Zeile 103697).
  - Auch ohne aktives Rennen läuft der Heartbeat weiter, mit leerer Flagge.
  - Damit ist `$F` ein **natürliches Lebenszeichen**: Bleibt er > 3 s aus, ist die Verbindung zu Orbits gestört (siehe [05-worker-und-steuerung.md](05-worker-und-steuerung.md)).
- **Flaggen werden auf 6 Zeichen aufgefüllt und kommen in gemischter Schreibweise**, z. B. `"Green "`. Sechs Leerzeichen bedeuten „keine Flagge“. Also: `trim()`, Großschreibung, leer → `NONE`.
  - In beiden Aufnahmen kommen nur `Green` und leer vor.
  - Die übrigen Werte (`Yellow`, `Red`, `Finish`, `Purple`) werden mit weiteren lokalen Aufnahmen verifiziert.
- **Leere Felder sind normal:** In `$G`/`$SR` ist `laps` vor der ersten Zieldurchfahrt leer (`,,`), 265-mal allein in der Elimination. Das muss zu `0` werden, nicht `NaN`.
- **Uneinheitliches Quoting:** In `$A` steht die Transponder-Nummer ohne Anführungszeichen (`NK-04720`), die übrigen Felder sind gequotet.
- **Zeitformat** `HH:MM:SS` bzw. `HH:MM:SS.mmm`. Nullwerte werden als `"00:00:00"` bzw. `"00:00:00.000"` gesendet.
- **`$I`/`$B` wiederholen sich** (dreimal `$I` direkt nacheinander, zweimal `$B` mit derselben ID). Ein neues Rennen darf nur bei einer **neuen** `uniqueId` entstehen; ein wiederholtes `$I` darf den gerade aufgebauten Zustand nicht unnötig verwerfen.

---

## 7. Tests

JUnit 5 für alle Parser (`message/*Test`), `CompetitorTest`, `RaceTest`, `RaceClassTest` und `ExponentialMovingAverageTest`.
**Keine** Tests für Server, UI, Player oder Recorder.

---

## 8. Auffälligkeiten / Bugs (im Port beheben)

| Befund | Umgang im Port |
|---|---|
| `setScheduledLaps` liest den alten Wert erst nach dem Überschreiben, das Event hat dadurch alt = neu | Port berechnet die Diffs ohnehin auf Snapshot-Ebene |
| Player speichert das Stream-Encoding unter dem Schlüssel des File-Encodings | Korrekte Schlüssel |
| Estimator nutzt `scheduledTime`, das nie gesetzt wird | Entfällt |
| Swing zeigt `regNumber`, die API `number` | API bleibt bei `number`; UI zeigt `number`, `regNumber` optional |
| Die Tabelle gilt laut README als sortierbar, das Modell sortiert aber nicht | Web-UI sortiert nach Position, weitere Spalten optional |
| Kein Schutz für Steuerfunktionen (in Swing ohnehin lokal) | Optionaler Control-Token, siehe [04-service-api.md](04-service-api.md) |
