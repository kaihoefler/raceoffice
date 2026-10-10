# Szenario: Ausscheidungsrennen (AGI 2024, Cadet Men 6000 Elim-Final B)

Quelle: `packages/race-status-mock/recordings/AGI-2024_race-11-Cadet-Men-6000-Elim-Final-B.jsonl` (per-lap, anonymisiert), 26 Fahrer, 30 Runden.

Zweck: Für jeden Stand festhalten, was die Scoring-Seite (Tab ELIMINATION, Sync an) anzeigen, vorbelegen und erlauben soll. Daraus entsteht 1:1 der Komponententest (`feedStep` Stand für Stand).

Spalten (aus dem Feed abgeleitet, noch ohne erfasste Entscheidungen):
- **Letzte zwei aktive**: die zwei hintersten Fahrer, die auf der Führungsrunde sind (Kandidaten für ELIM)
- **Neu +1 Runde**: Fahrer, die in diesem Stand erstmals eine Runde zurückliegen (im Ausscheidungsrennen: zuvor ausgeschieden, ihre Rundenzahl friert ein)
- **≥2 Runden**: Anzahl Fahrer mit mindestens 2 Runden Rückstand (in der Starterliste markiert)
- **0 Runden**: Fahrer ohne gefahrene Runde (DNS-Vorbelegung ab Runde 2)
- **Erwartung**: von dir auszufüllen: Aktionen/Vorbelegungen/Entscheidungen in diesem Stand

Automatisiert in `elimination-agi-2024-cadet-men-final-b.test.tsx` (gleicher Ordner): pro Zeile ein `state(n)`, dann die Aktionen aus "Erwartung".

Abgestimmte Vorbelegung (App schlägt den hintersten Fahrer laut Feed-Position vor, ohne bereits Ausgeschiedene): in allen ELIM-Zeilen entspricht sie der Erwartung, außer
- Zeile 17: App schlägt 115 vor, die Kampfrichter scheiden 133 aus (manuell überschrieben); 115 folgt in Zeile 19
- Zeile 27: App schlägt 104 vor, die Kampfrichter scheiden 142 aus (manuell überschrieben); 104 folgt in Zeile 29
- DNS (Zeile 5): erst ab Live-Runde 2 vorbelegt, daher in Zeile 6 gespeichert

Zeile 34 ist ergänzt (nicht in der Aufzeichnung): Einlauf wie Zeile 35, aber Flagge GREEN, also der Moment nach der Zieldurchfahrt, bevor die Zeitmessung FINISH setzt. Der per-lap-Recorder behält nur den letzten Stand von Runde 30 (schon FINISH). Bei FINISH schaltet die App den Sync aus, daher werden die letzten Aktionen in Zeile 34 erfasst. Erzeugt in `agiCadetMenFinalB.ts`.

Feed-Eigenheiten: Stand 3 → 4 ist die gelöschte Zieldurchfahrt am Start (Runde 1 → 0). `lapsToGo` hinkt teilweise hinterher (Stände 6/7, 9/10).

| # | Flagge | Runde / to go | Rennzeit | Letzte zwei aktive | Neu +1 Runde | ≥2 Runden | 0 Runden | Erwartung |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | PURPLE | 0 / 30 | 0:00 | 146@P25, 123@P26 | – | – | (alle 0) | Neues Rennen anlegen auf Basis der Daten aus Live (Create New Race) |
| 2 | GREEN | 0 / 30 | 0:00 | 146@P25, 123@P26 | – | – | (alle 0) | "Activate Sync" aktivieren |
| 3 | GREEN | 1 / 29 | 0:03 | 150@P8, 141@P9 | 152, 153, 154, 133, 135, 114, 115, 117, 95, 96, 142, 123, 101, 145, 146, 148, 149 | – | 152, 153, 154, 133, 135, 114, 115, 117, 95, 96, 142, 123, 101, 145, 146, 148, 149 |  |
| 4 | GREEN | 0 / 30 | 0:09 | 146@P25, 123@P26 | – | – | (alle 0) |  |
| 5 | GREEN | 1 / 29 | 0:26 | 104@P22, 89@P23 | 123, 145, 146 | – | 123, 145, 146 | Zu Elimination DNS wechseln und dort die DNS eintragen. |
| 6 | GREEN | 2 / 27 | 1:02 | 89@P22, 151@P23 | – | 3 | 123, 145, 146 |  |
| 7 | GREEN | 3 / 27 | 1:04 | 151@P22, 89@P23 | – | 3 | 123, 145, 146 |  |
| 8 | GREEN | 4 / 26 | 1:34 | 133@P20, 101@P21 | 89, 151 | 3 | 123, 145, 146 | 2 Elim auswählen und Speichern |
| 9 | GREEN | 5 / 24 | 2:02 | 150@P20, 101@P21 | – | 5 | 123, 145, 146 |  |
| 10 | GREEN | 6 / 24 | 2:04 | 142@P18, 133@P19 | 150, 101 | 5 | 123, 145, 146 | 1 Elim auswählen und 101 Eliminieren |
| 11 | GREEN | 7 / 23 | 2:23 | 95@P18, 139@P19 | – | 7 | 123, 145, 146 | 150 Eliminieren |
| 12 | GREEN | 8 / 22 | 2:43 | 115@P18, 139@P19 | – | 7 | 123, 145, 146 | 95 DSQ |
| 13 | GREEN | 9 / 21 | 3:01 | 137@P16, 114@P17 | 139, 95 | 7 | 123, 145, 146 | 139 Eliminieren |
| 14 | GREEN | 10 / 20 | 3:22 | 115@P16, 137@P17 | – | 9 | 123, 145, 146 |  |
| 15 | GREEN | 11 / 19 | 3:42 | 114@P16, 88@P17 | – | 9 | 123, 145, 146 | 88 Eliminieren |
| 16 | GREEN | 12 / 18 | 4:08 | 148@P15, 115@P16 | 88 | 9 | 123, 145, 146 |  |
| 17 | GREEN | 13 / 17 | 4:32 | 137@P15, 115@P16 | – | 10 | 123, 145, 146 | 133 Elim |
| 18 | GREEN | 14 / 16 | 4:44 | 135@P13, 137@P14 | 133, 115 | 10 | 123, 145, 146 |  |
| 19 | GREEN | 15 / 15 | 5:05 | 148@P13, 137@P14 | – | 12 | 123, 145, 146 | 115 Elim |
| 20 | GREEN | 16 / 14 | 5:28 | 114@P13, 137@P14 | – | 12 | 123, 145, 146 |  |
| 21 | GREEN | 17 / 13 | 5:50 | 96@P13, 137@P14 | – | 12 | 123, 145, 146 | 137 Elim |
| 22 | GREEN | 18 / 12 | 6:03 | 104@P12, 142@P13 | 137 | 12 | 123, 145, 146 |  |
| 23 | GREEN | 19 / 11 | 6:24 | 114@P12, 135@P13 | – | 13 | 123, 145, 146 | 135 Elim |
| 24 | GREEN | 20 / 10 | 6:45 | 148@P11, 114@P12 | 135 | 13 | 123, 145, 146 |  |
| 25 | GREEN | 21 / 9 | 7:06 | 114@P11, 148@P12 | – | 14 | 123, 145, 146 |  |
| 26 | GREEN | 22 / 8 | 7:27 | 148@P11, 114@P12 | – | 14 | 123, 145, 146 |  |
| 27 | GREEN | 23 / 7 | 7:48 | 149@P11, 104@P12 | – | 14 | 123, 145, 146 | 142 Elim |
| 28 | GREEN | 24 / 6 | 8:11 | 104@P11, 142@P12 | – | 14 | 123, 145, 146 |  |
| 29 | GREEN | 25 / 5 | 8:32 | 114@P10, 104@P11 | 142 | 14 | 123, 145, 146 | 104 Elim |
| 30 | GREEN | 26 / 4 | 8:52 | 149@P9, 114@P10 | 104 | 15 | 123, 145, 146 |  |
| 31 | GREEN | 27 / 3 | 9:10 | 96@P8, 152@P9 | 114 | 16 | 123, 145, 146 | 114 Elim |
| 32 | GREEN | 28 / 2 | 9:30 | 96@P8, 148@P9 | – | 17 | 123, 145, 146 | 148 Elim |
| 33 | GREEN | 29 / 1 | 9:48 | 141@P7, 96@P8 | 148 | 17 | 123, 145, 146 | 96 Elim |
| 34 | GREEN | 30 / 0 | 10:13 | 141@P6, 149@P7 | 96 | 18 | 123, 145, 146 |  |
| 35 | FINISH | 30 / 0 | 10:13 | 141@P6, 149@P7 | 96 | 18 | 123, 145, 146 | Zieleinlauf übernehmen |
