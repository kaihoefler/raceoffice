# 06 – Leaderboard-Frontend (`apps/leaderboard-frontend`)

## 1. Technischer Rahmen

- React 19, Vite, MUI 9, react-router 7, wie `apps/frontend` und `apps/livetracking-frontend`.
- Dev-Port **5176**. Der Vite-Proxy leitet `/api`, `/ws`, `/race`, `/races` und `/health` auf den Service (`localhost:8080`).
- Build mit `base: "./"`, Ausgabe nach `apps/leaderboard-service/public`.
  - Der Service liefert das Frontend unter `/ui/` aus; im Modus A ist es damit unter `/leaderboard/ui/` erreichbar.
  - Alle API- und WS-URLs werden **relativ zur Seiten-Basis** gebildet, ohne fest verdrahtetes Präfix.
- Routing per `HashRouter`, damit Deep-Links hinter dem Proxy ohne Server-Rewrite funktionieren, z. B. `/leaderboard/ui/#/lap-counter`.
- **Datenzugriff**
  - `useLeaderboardStream(raceId = "current")`: WS-Snapshot + Patch, Reconnect mit Backoff, liefert `{race, rev, connected, lastUpdateAt}`
  - `useServiceStatus()`: Stream von `/ws/status`
  - `api.ts`: getypte Aufrufe der Control-API
  - Die Typen kommen aus `@raceoffice/domain` (`raceStatusFeed.ts`, `leaderboardProtocol.ts`).
- Darstellungslogik, die schon existiert, wird **wiederverwendet bzw. nach `packages/domain` verschoben**:
  - Namensformatierung (IOC-Suffix entfernen), heute in `apps/frontend/src/components/LiveRaceStatus.tsx`
  - Delta- und Rundenrückstand, heute in `apps/frontend/src/domain/liveTime.ts`

---

## 2. Sichten

| Route | Ersetzt (Swing) | Zweck |
|---|---|---|
| `#/` Leaderboard | MainFrame (+ Full Screen) | Hauptansicht für Rennleitung, Sprecher, Beamer |
| `#/control` Control Center | ConnectFrame, ServerFrame, Recorder, Player | Bedienung des Service |
| `#/start-signal` | StartSignalFrame | Startbereich (Vollbild) |
| `#/lap-counter` | LapCounterFrame | Rundenanzeige für Fahrer:innen (Vollbild) |
| `#/finish-line-log` | FinishLineLogFrame | Protokoll der Zieldurchfahrten |

Eine schmale App-Leiste (ausblendbar) verbindet die Sichten und zeigt Verbindungsstatus, Flagge und gegebenenfalls „REPLAY“.

---

## 3. Leaderboard (verbessertes Design)

```
┌───────────────────────────────────────────────────────────────────────────┐
│ ▌GREEN▐  Elimination U17m · Groß-Gerau 200 m          ● live   ⛶  ⚙       │
├──────────────┬──────────────┬──────────────┬──────────────┬───────────────┤
│ Elapsed      │ Runde        │ To Go        │ Zeit Tag     │ Fahrer:innen  │
│ 4:12         │ 7            │ 13 Laps      │ 14:03:22     │ 24            │
├────┬─────┬──────────────────────────┬──────┬──────────┬────────┬─────────┤
│Pos │  #  │ Name                     │ Laps │ Gap      │ Last   │ Best    │
├────┼─────┼──────────────────────────┼──────┼──────────┼────────┼─────────┤
│ 1  │ 17  │ Muster, Max        GER   │  7   │ 4:11.532 │ 21.310 │ 21.004● │
│ 2 ▲│ 23  │ Beispiel, Tim      GER   │  7   │ +0.032   │ 21.120 │ 21.120  │
│ 3 ▼│  5  │ …                        │  6   │ +1 Lap   │ …      │ …       │
└────┴─────┴──────────────────────────┴──────┴──────────┴────────┴─────────┘
```

**Verbesserungen gegenüber Swing**
- **Flaggen-Banner** in voller Breite statt 2×2-Kästchen: Farbe plus Text, FINISH als Schachbrettmuster, YELLOW/RED blinken dezent.
- **Header-Kacheln** für Elapsed, Runde, To Go (Zeit oder Runden, eindeutig beschriftet), Tageszeit und Anzahl Fahrer:innen.
- **Gap-Spalte:** Leader mit absoluter Zeit, dann `+Δ` bzw. `+n Laps`, nach derselben Regel wie im Scoring. Optional eine **Interval**-Spalte (Abstand zum Vordermann).
- **Spaltenauswahl:**
  - Pos, PIC, #, Class, Name, Nation, Laps, Total, Gap, Interval, Last, Best, Avg, Quali
  - pro Gerät gespeichert (`localStorage`)
  - Presets „Rennleitung“, „Sprecher“, „Beamer“
- **Hervorhebungen:**
  - Positionswechsel kurz animiert (▲/▼, Hintergrund-Fade)
  - persönliche Bestrunde mit Punkt, schnellste Runde des Rennens farbig
- **Nation** als eigene Spalte (aus dem `(GER)`-Suffix bzw. `nationality`). Der Name selbst wird ohne Suffix angezeigt.
- **PURPLE:** Zeiten werden ausgeblendet und Startnummern/Startaufstellung betont, wie im Scoring.
- **Lesbarkeit:**
  - Schriftgröße per Schieberegler bzw. `?scale=1.4`
  - Hell- und Dunkelmodus, hoher Kontrast für Beamer
  - Zeilenhöhe kompakt/normal/groß
- **Fullscreen** über die Fullscreen-API (Taste `F`, Esc beendet). Im Kiosk-Modus `?kiosk=1` ohne App-Leiste und Cursor.
- **Leere und Fehlerzustände:**
  - „Kein aktives Rennen“, „Verbindung zu Orbits getrennt seit …“
  - Der letzte Stand bleibt sichtbar und wird ausgegraut.
- **Responsiv:** Auf dem Smartphone zeigt die Tabelle nur Pos, #, Name und Gap; der Rest kommt per Aufklappen.
- **Optional:** vorheriges Rennen per Umschalter anzeigen (`/race` liefert es nach FINISH ohnehin).

---

## 4. Control Center (Connection + Server + Recorder + Player)

Eine Seite mit vier Karten statt vier Fenstern. Status kommt live über `/ws/status`, Aktionen geben sofort Feedback.

```
┌─ Quelle ────────────────────────────────┐ ┌─ Service ─────────────────────────┐
│ (●) Orbits live   ( ) Replay            │ │ v1.0.0 · managed · Port 8790      │
│ Host [192.168.1.20]  Port [50000]       │ │ REST  /races?filter=current  ⧉    │
│ Encoding [windows-1252 ▾]  ☑ Autoconnect│ │ WS    /ws/race/current       ⧉    │
│ ● connected · 312 msg/min · vor 0,4 s   │ │ 3 WS-Clients · 58 REST/min        │
│ [Trennen]                               │ │ Aktuelles Rennen: #12 Elim U17m   │
│ Verlauf: 13:58 connected · 13:57 retry 2│ │ [Zustand zurücksetzen]            │
└─────────────────────────────────────────┘ └───────────────────────────────────┘
┌─ Recorder ──────────────────────────────┐ ┌─ Player ──────────────────────────┐
│ ● REC 00:12:31 · 4 210 Zeilen           │ │ Datei [2026-10-20_elim.txt ▾] ⤒  │
│ Name [elim-u17]   [Stop]                │ │ Speed [1× 2× 5× 10×]              │
│ Aufnahmen:                              │ │ ▶ ❚❚ ■   ━━━━━━●──────  04:12/12:30│
│  2026-10-20_elim-u17.txt  12:30  ⤓ 🗑   │ │ Hinweis: Live-Verbindung wird     │
│  2026-10-19_points.txt    31:02  ⤓ 🗑   │ │ während Replay getrennt.          │
└─────────────────────────────────────────┘ └───────────────────────────────────┘
```

**Usability-Regeln**
- **Quelle als exklusive Wahl (live/replay).** Das verhindert das Java-Szenario „Player läuft, Client zeigt auf 127.0.0.1“, das sich nur über Umwege einrichten ließ.
- **Eingaben werden validiert**, bevor sie übernommen werden (Host/IP, Port 1–65535). „Übernehmen“ verbindet neu.
- **Verbindungsverlauf** (letzte 20 Ereignisse) für die Fehlersuche am Wettkampftag.
- Der Recorder zeigt Dauer und Zeilen live. Ein **Auto-Record-Schalter** startet die Aufnahme bei jeder Live-Verbindung.
- Der Player bietet Seek per Schieberegler, Speed-Presets und **Upload** von Java-Recordings (gleiches Format).
- **Kopierbare Endpunkt-URLs** für externe Konsumenten (Sprecher-Tool, Stream-Overlay).
- Schreibende Aktionen sind deaktiviert, solange ein Token verlangt und nicht gesetzt ist. Der Token kann einmalig eingegeben werden und wird in `sessionStorage` gehalten.

---

## 5. Start Signal

- Vollbild, Hintergrund in Flaggenfarbe, Rennname oben, Elapsed-Uhr groß unten.
- **PURPLE:** Startnummern der gemeldeten Fahrer:innen als Raster, also die Startaufstellung.
- **GREEN:** „START“ bzw. die laufende Uhr. **FINISH:** schwarzer Hintergrund mit „FINISH“ und einem kleinen Schachbrett-Balken darunter (ein vollflächiges Schachbrett ist zu unruhig).
- „START“ erscheint in den ersten 5 s nach dem Start, danach nur die Uhr. YELLOW/RED zeigen den Flaggennamen groß.
- URL-Parameter: `?kiosk=1&scale=…`

## 6. Lap Counter

- Große, automatisch skalierende Zahl (Container-Query/SVG-Text), weiß auf schwarz, Flaggenstreifen unten.
- Modus „Laps to Go“ (Default) oder „Laps Complete“, Umschalter oder `?mode=up`.
- **Update-Verzögerung** (Default 5 s, `?delay=5`): Die Zahl wechselt erst, wenn der Leader die Linie seit `delay` Sekunden passiert hat, wie in Swing.
- Bei `lapsToGo = 1` „LAST LAP“ und optionale Glocken-Animation. Bei FINISH schwarzer Hintergrund mit „FINISH“ und kleinem Schachbrett-Balken darunter (wie beim Start Signal).
- Umsetzung: Die Verzögerung gilt für Zahl, LAST LAP und FINISH gemeinsam. Der erste Wert und ein Rennwechsel erscheinen sofort. URL-Parameter haben Vorrang vor den auf dem Gerät gespeicherten Einstellungen.

## 7. Finish Line Log

- Chronologische Liste der Durchfahrten aus `$J`-Passings: Zeit, #, Name, Runde, Rundenzeit, Position.
- Zeilenhöhe konfigurierbar (Default 24 px, wie `finishLineLog.rowHeight`). Neueste oben oder unten, mit Auto-Scroll und Pause beim Hovern.
- Zeilenhöhe frei eingebbar (16–200 px). Kompaktansicht nur mit Startnummer, Name, Runde und Platz. Für Kiosk-Bildschirme per URL: `?compact=1&rowHeight=40`.
- **Datenquelle:** Das Log braucht Ereignisse, keine Zustände. Der Service führt deshalb einen Ringpuffer der letzten 500 Passings je Rennen und bietet ihn an:
  - per `GET /api/race/:id/passings`
  - per WS-Kanal `/ws/race/current/passings` (append-only)
