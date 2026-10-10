# Szenario: Punkterennen (gleiche Aufzeichnung, als Punkterennen interpretiert)

Quelle: `packages/race-status-mock/recordings/AGI-2024_race-11-Cadet-Men-6000-Elim-Final-B.jsonl` (per-lap, anonymisiert), 26 Fahrer, 30 Runden.

Zweck: Für jeden Stand festhalten, was die Scoring-Seite (Tab POINTS, Sync an) anzeigen, vorbelegen und erlauben soll. Daraus entsteht 1:1 der Komponententest (`feedStep` Stand für Stand), wie beim Ausscheidungsrennen.

Hinweise:
- Der Rennname enthält "Elim", daher schlägt "Create New Race" den Modus Ausscheidung vor. Für dieses Szenario im Dialog auf Punkterennen umstellen (oder angeben, wie das Rennen angelegt werden soll).
- Mit Sync übernimmt der Tab POINTS die Runde aus dem Feed und belegt P1–P3 mit den ersten drei Positionen vor.

Spalten (aus dem Feed abgeleitet, noch ohne erfasste Entscheidungen):
- **Top 4 (Bib@Pos)**: die vier vordersten Fahrer laut Feed, P1–P3 = Sprint-Vorbelegung; (+N) = Rundenrückstand
- **Neu +1 Runde**: Fahrer, die in diesem Stand erstmals eine Runde zurückliegen
- **≥2 Runden**: Anzahl Fahrer mit mindestens 2 Runden Rückstand
- **Erwartung**: von dir auszufüllen: Sprint werten (welche Plätze/Punkte), Abzüge, DNF, Zieleinlauf …

Zeile 34 ist ergänzt (nicht in der Aufzeichnung): Einlauf wie Zeile 35, aber Flagge GREEN, also der Moment nach der Zieldurchfahrt, bevor die Zeitmessung FINISH setzt. Der per-lap-Recorder behält nur den letzten Stand von Runde 30 (schon FINISH). Bei FINISH schaltet die App den Sync aus, daher werden die letzten Aktionen in Zeile 34 erfasst. Erzeugt in `agiCadetMenFinalB.ts`.

Feed-Eigenheiten: Stand 3 → 4 ist die gelöschte Zieldurchfahrt am Start (Runde 1 → 0). `lapsToGo` hinkt teilweise hinterher (Stände 6/7, 9/10).

| # | Flagge | Runde / to go | Rennzeit | Top 4 (Bib@Pos) | Neu +1 Runde | ≥2 Runden | Erwartung |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | PURPLE | 0 / 30 | 0:00 | 96@P1, 153@P2, 143@P3, 145@P4 | – | – | Neues Rennen anlegen auf Basis der Daten aus Live (Create New Race)<br>Dabei Ändern der Rennart auf Points |
| 2 | GREEN | 0 / 30 | 0:00 | 96@P1, 153@P2, 143@P3, 145@P4 | – | – | "Activate Sync" aktivieren |
| 3 | GREEN | 1 / 29 | 0:03 | 88@P1, 151@P2, 137@P3, 143@P4 | 96, 153, 145, 117, 154, 133, 135, 101, 114, 149, 152, 148, 95, 115, 142, 146, 123 | – |  |
| 4 | GREEN | 0 / 30 | 0:09 | 96@P1, 153@P2, 143@P3, 145@P4 | – | – |  |
| 5 | GREEN | 1 / 29 | 0:26 | 137@P1, 96@P2, 101@P3, 133@P4 | 145, 146, 123 | – |  |
| 6 | GREEN | 2 / 27 | 1:02 | 148@P1, 143@P2, 101@P3, 149@P4 | – | 3 | Zu Elimination DNS wechseln und dort die DNS eintragen. |
| 7 | GREEN | 3 / 27 | 1:04 | 148@P1, 149@P2, 117@P3, 143@P4 | – | 3 |  |
| 8 | GREEN | 4 / 26 | 1:34 | 148@P1, 117@P2, 149@P3, 143@P4 | 151, 89 | 3 |  |
| 9 | GREEN | 5 / 24 | 2:02 | 148@P1, 117@P2, 149@P3, 143@P4 | – | 5 |  |
| 10 | GREEN | 6 / 24 | 2:04 | 148@P1, 143@P2, 117@P3, 154@P4 | 150, 101 | 5 | Punkte vergeben 148@P1, 143@P2 |
| 11 | GREEN | 7 / 23 | 2:23 | 149@P1, 88@P2, 148@P3, 117@P4 | – | 7 |  |
| 12 | GREEN | 8 / 22 | 2:43 | 149@P1, 135@P2, 96@P3, 88@P4 | – | 7 | Punkte 149@P1, 135@P2 |
| 13 | GREEN | 9 / 21 | 3:01 | 148@P1, 149@P2, 135@P3, 154@P4 | 95, 139 | 7 | DNF anhand Vorbelegung Eintragen für 151, 89 (Runde 3).<br>Dann für 150, 101 (Runde 5) |
| 14 | GREEN | 10 / 20 | 3:22 | 142@P1, 148@P2, 149@P3, 143@P4 | – | 9 | Punkte vergeben Platz 1 und 2 tauschen (Button mit Pfeil hoch und Runter) |
| 15 | GREEN | 11 / 19 | 3:42 | 152@P1, 154@P2, 115@P3, 117@P4 | – | 9 | DSQ für 139 |
| 16 | GREEN | 12 / 18 | 4:08 | 152@P1, 154@P2, 117@P3, 96@P4 | 88 | 9 | Punkte vergeben 152@P1, 154@P2, |
| 17 | GREEN | 13 / 17 | 4:32 | 149@P1, 152@P2, 154@P3, 143@P4 | – | 10 | DNF für 95 und DNF für 88 |
| 18 | GREEN | 14 / 16 | 4:44 | 149@P1, 117@P2, 152@P3, 154@P4 | 133, 115 | 10 | Punkte vergeben |
| 19 | GREEN | 15 / 15 | 5:05 | 154@P1, 143@P2, 149@P3, 152@P4 | – | 12 |  |
| 20 | GREEN | 16 / 14 | 5:28 | 148@P1, 152@P2, 154@P3, 143@P4 | – | 12 | Punkte vergeben Manuell 152 Platz 1, 154 Platz 2 |
| 21 | GREEN | 17 / 13 | 5:50 | 148@P1, 154@P2, 143@P3, 153@P4 | – | 12 |  |
| 22 | GREEN | 18 / 12 | 6:03 | 149@P1, 143@P2, 153@P3, 148@P4 | 137 | 12 | Punkte vergeben |
| 23 | GREEN | 19 / 11 | 6:24 | 154@P1, 149@P2, 96@P3, 143@P4 | – | 13 |  |
| 24 | GREEN | 20 / 10 | 6:45 | 149@P1, 117@P2, 143@P3, 153@P4 | 135 | 13 | Punkte vergeben |
| 25 | GREEN | 21 / 9 | 7:06 | 154@P1, 117@P2, 143@P3, 149@P4 | – | 14 | DNF für 133, 115 sowie 137 und 135 eintragen (jeweils deren Runde) |
| 26 | GREEN | 22 / 8 | 7:27 | 154@P1, 153@P2, 117@P3, 143@P4 | – | 14 | Punkte vergeben |
| 27 | GREEN | 23 / 7 | 7:48 | 148@P1, 143@P2, 154@P3, 152@P4 | – | 14 |  |
| 28 | GREEN | 24 / 6 | 8:11 | 148@P1, 143@P2, 154@P3, 153@P4 | – | 14 | Punkte vergeben |
| 29 | GREEN | 25 / 5 | 8:32 | 143@P1, 153@P2, 154@P3, 117@P4 | 142 | 14 |  |
| 30 | GREEN | 26 / 4 | 8:52 | 141@P1, 143@P2, 153@P3, 154@P4 | 104 | 15 | Punkte vergeben |
| 31 | GREEN | 27 / 3 | 9:10 | 141@P1, 149@P2, 143@P3, 154@P4 | 114 | 16 |  |
| 32 | GREEN | 28 / 2 | 9:30 | 149@P1, 143@P2, 154@P3, 117@P4 | – | 17 | Punkte vergeben |
| 33 | GREEN | 29 / 1 | 9:48 | 117@P1, 143@P2, 154@P3, 153@P4 | 148 | 17 | DNF 142, 104, 114, 148 |
| 34 | GREEN | 30 / 0 | 10:13 | 117@P1, 154@P2, 143@P3, 152@P4 | 96 | 18 | Punkte vergeben Platz 1-3<br>DNF 96 |
| 35 | FINISH | 30 / 0 | 10:13 | 117@P1, 154@P2, 143@P3, 152@P4 | 96 | 18 | Zieleinlauf übernehmen |
