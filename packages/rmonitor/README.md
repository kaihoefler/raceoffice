# @raceoffice/rmonitor

RMonitor-Protokoll (MYLAPS Orbits) und Rennzustand, portiert aus der Java-Anwendung
[RMonitorLeaderboard](https://github.com/bastianpaetzold/RMonitorLeaderboard) (Version 1.3.0).
Das Paket ist reine Logik ohne I/O. TCP-Client, Recorder und Player gehören in den Leaderboard-Service.
Konzept: [doc/leaderboard-integration/03-rmonitor-port.md](../../doc/leaderboard-integration/03-rmonitor-port.md).

```ts
import { LineDecoder, parseLine, RaceStateStore, toRaceTO } from "@raceoffice/rmonitor";

const decoder = new LineDecoder("windows-1252");
const store = new RaceStateStore();
socket.on("data", (chunk) => {
  for (const line of decoder.push(chunk)) store.apply(parseLine(line));
});
// REST-kompatibel zu Java:
//   /races?filter=current → [toRaceTO(store.displayRace)]
//   /races                → store.all.map(toRaceTO)
//   /race/:id             → store.getById(id)
```

## Inhalt

| Modul | Aufgabe |
|---|---|
| `tokenize` | CSV-Tokenizer wie commons-text `StringTokenizer` |
| `duration` | `parseDuration`/`formatDuration` wie `DurationUtil`, Java-kompatibles Int-/Float-Parsing |
| `messages/parseLine` | Zeile → getypte Nachricht. Wirft nie, liefert stattdessen `unknown`/`invalid`. |
| `state/*` | `RaceStateStore` (`RaceManager`), `RaceState`/`CompetitorState` (`Race`/`Competitor`), `toRaceTO` |
| `recording/*` | Recording-Format `<ms> <zeile>` (Text und byte-genau), `LineDecoder` für TCP-Chunks |
| `@raceoffice/rmonitor/testing` | `FakeOrbitsFeeder` (steuerbarer RMonitor-TCP-Server), Golden-Test-Helfer. Nur für Node. |

## Java-Verhalten, das bewusst übernommen wurde

Die Golden-Tests haben diese Punkte bestätigt:

- **Leere Flagge wird `PURPLE`.** Ausnahme: Rennen mit ID 0 und leerem Namen, dort wird sie `NONE`. `$B` setzt die Flagge ebenfalls auf PURPLE. Ein Rennen ohne Flagge gilt damit für `pickCurrentRace` als aktiv, wie heute mit der Java-App.
- **`$I` startet immer ein neues Rennen**, ohne ID-Prüfung. Bis zum nächsten `$B` liefert die REST-Sicht (`displayRace`) das vorherige Rennen.
- **Eine Zeile, die nicht geparst werden kann, wird komplett verworfen.** Dazu gehören leere Zeitfelder, einstellige Stunden und fehlende Felder. Leere Rundenfelder in `$G`, `$H`, `$SP` und `$SR` gelten dagegen als `0`.
- **Nullzeiten werden als `"0:00"` ausgegeben**, Millisekunden nur, wenn sie ungleich 0 sind.

## Abweichungen von Java

| Thema | Java | Port |
|---|---|---|
| **`$COR` (Zeitkorrektur, Zielfoto)** | ignoriert, die Gesamtzeit kommt über das folgende `$G`, die Runde bleibt unkorrigiert | korrigiert Gesamtzeit, Rundenzeit, `lastLap` und ggf. `bestLap` (`corrections: "apply"`, Default). `"ignore"` verhält sich wie Java. |
| Reihenfolge der Competitors in `RaceTO` | HashMap-Reihenfolge | nach Position, Position 0 am Ende |
| Anzahl gehaltener Rennen | unbegrenzt | `maxRaces` (Default 200, ein voller Wettkampftag hat bis ca. 100), das älteste fällt zuerst heraus |
| Klassen (`$C`) | statische Map | gehört zur Store-Instanz |
| Änderungsmeldung | `PropertyChangeSupport` | `apply()` liefert `{ changed, newRace }`, dazu `store.rev` |
| Zeilenende `\r` allein | gilt als Zeilenende (`readLine`) | nur `\n` und `\r\n` (Orbits sendet `\r\n`) |

## Tests

```sh
npm run test:run --workspace=@raceoffice/rmonitor
```

- `messages`, `state`: Port der JUnit-Tests, dazu die `RaceManager`-Regeln
- `recording`: Format, Zeilenenden, windows-1252 (`AGI_2022_pts_Sen_Men`: „Bühnemann“), zufälliges Chunking
- `feeder`: Feeder über echtes TCP
- `correction`: `$COR` mit einer echten Sprint-Sequenz
- `golden`: Der Port muss an denselben Zeilen exakt dasselbe JSON liefern wie die Java-App. Die Golden-Tests laufen mit `corrections: "ignore"` und ohne Rennlimit.

### Golden-Referenz neu erzeugen

```sh
npm run golden:rmonitor            # alle Recordings in test/fixtures/recordings
npm run golden:rmonitor -- <datei> # einzelne Datei
```

Voraussetzung ist Docker. Java muss nicht installiert sein. Das Skript [scripts/generate-golden.mjs](scripts/generate-golden.mjs) arbeitet so:

1. Es startet das veröffentlichte Image `ghcr.io/bastianpaetzold/rmonitorleaderboard:1.3.0` headless als Client und JSON-Server.
2. Statt des Java-Players speist es das Recording über den `FakeOrbitsFeeder` ein.
3. An jedem Haltepunkt (`selectCheckpoints`: `$B`, `$I`, Flaggenwechsel, alle 1000 Zeilen, Ende) wartet es, bis die Java-App alle gesendeten Zeilen verarbeitet hat. Dazu zählt es ihre DEBUG-Logzeilen `Message: …`. Danach liest es `/races?filter=current` und bei Rennwechseln auch `/races`.

Die Erzeugung hängt also nicht vom Timing ab und ist reproduzierbar. Ein anderes Image lässt sich über `RMONITOR_JAVA_IMAGE` wählen.

Neue Aufnahmen (z. B. mit Yellow/Red oder Rennwechseln) legt man nach `test/fixtures/recordings/` und erzeugt danach die Referenz neu. Die Dateien bleiben byte-genau, siehe `.gitattributes`.

### Tagesprotokolle (lokal)

Komplette Wettkampftage gehören nicht ins öffentliche Repo, wegen ihrer Größe und weil sie Athletennamen enthalten. Sie liegen in `test/fixtures/recordings-local/`, das Git ignoriert.

```sh
npm run golden:generate:local --workspace=@raceoffice/rmonitor   # Referenz → test/fixtures/golden-local/
```

Die Golden-Tests laufen dann lokal automatisch mit, in CI werden sie übersprungen. Auffällige Stellen kommen als **anonymisierte Ausschnitte** ins Repo:

```sh
node scripts/make-excerpt.mjs <quelle.txt> test/fixtures/recordings/<name>.txt <von>-<bis> [<von>-<bis> ...]
npm run golden:rmonitor -- test/fixtures/recordings/<name>.txt
```

`make-excerpt` ersetzt Vor- und Nachnamen durch `Rider<nr>`/`Name<nr>`. Nationenkürzel und die Sonderzeichen-Bytes der Originalnamen bleiben erhalten, damit Encoding-Tests weiter funktionieren.

## Herkunft und Lizenz

Parser und Zustandsregeln sind eine Portierung von RMonitorLeaderboard (© 2013 Zachary Fox, © 2023 Bastian Pätzold). Das Projekt steht unter der **GNU GPL v3**. Die Recordings unter `test/fixtures/recordings/` stammen aus demselben Repository. Ausgenommen sind die Dateien `excerpt_*.txt`: Das sind anonymisierte Ausschnitte eigener Aufnahmen.
