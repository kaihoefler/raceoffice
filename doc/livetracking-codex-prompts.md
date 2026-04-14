# LiveTracking Codex Prompt-Serie für RaceOffice

Diese Datei enthält die komplette Prompt-Serie für die Arbeit in VSCodium mit GPT-5.3-Codex.

Empfohlene Nutzung:

1. Zuerst den **Startprompt** verwenden
2. Danach den **Repo-Analyse-Prompt**
3. Danach die **Phasen-Prompts** Schritt für Schritt
4. Zwischen den größeren Schritten die **Review-Prompts** einsetzen

Wichtig:
- Nicht sofort mit UI beginnen
- Erst Domain-Modell, Dokumenttypen und Integrationspunkte sauber aufbauen
- Architektur regelmäßig gegenprüfen
- Timing-Logik fachlich separat prüfen

---

## Externer Kontext, den der Assistent nicht zuverlässig im Code findet

Diesen kurzen Block kannst du zusätzlich voranstellen oder dem Assistenten separat geben:

```text
Externer Kontext, der nicht vollständig aus dem Code ableitbar ist:
- AMM Converter ist ein CLI-Tool, das pro Decoder-Instanz JSON-Daten per WebSocket bereitstellen kann. https://www.ammconverter.eu/
- Die ProChip-Decoder sind GPS-synchronisiert und liefern damit eine gemeinsame Zeitbasis, was für split-/lap-Berechnung über mehrere Messpunkte zentral ist.
- Das System soll nicht nur rohe Passings anzeigen, sondern daraus gültige Splits, Runden, Best Laps und Qualifying-Rankings ableiten.
```

Relevante externe Quellen:
- RaceOffice Repo / README / Architektur-Doku
- AMM Converter Doku
- ProChip Timing System PDF

---

## 1. Startprompt: Architektur- und Zielkontext setzen

```text
Du arbeitest im Repository "raceoffice" und sollst eine neue LiveTracking-Funktion in die bestehende Architektur integrieren.

WICHTIG:
- Behandle RaceOffice nicht als Greenfield-Projekt.
- Nutze die bestehende Monorepo-Struktur und vorhandene Architektur konsequent weiter.
- Führe keine zweite konkurrierende Zustandswelt ein. Das Livetracking ist eine separate Funktionalität. 
- Die bestehende RaceOffice-Server-/Dokumentenlogik bleibt das System of Record für Wettkämpfe
- Ein neuer LiveTracking-Worker ist ein ausführender Dienst, aber nicht die primäre Persistenzinstanz.
- Schreibe Änderungen so, dass sie zum bestehenden Stil und zur aktuellen Architektur passen.

PROJEKTKONTEXT:
- Monorepo / npm workspaces
- apps/frontend: bestehende RaceOffice SPA
- apps/server: bestehender Realtime-/Persistenzserver
- packages/domain: gemeinsame Fachtypen und pure Logik
- bestehender Realtime-Mechanismus ist dokumentbasiert
- Dokumente werden per WebSocket synchronisiert
- Dokumente werden serverseitig in SQLite persistiert
- Dokumente haben Revisionen und JSON-Patches
- Ziel ist, die Steuerung der neuen LiveTracking-Funktionalität in dieses Modell zu integrieren

GEPLANTE ZIELARCHITEKTUR:
- apps/frontend
  bestehende RaceOffice App
- apps/livetracking-frontend
  neuer spezialisierter Client
- apps/server
  bestehender Realtime-/Persistenzserver
- apps/livetracking-worker
  neuer Worker für AMM Converter / Decoder-Anbindung
- packages/domain
  gemeinsame RaceOffice und LiveTracking-Fachtypen und pure Logik

FACHLICHES ZIEL:
Es soll ein LiveTracking-System für  Qualifying / Training auf einem Track mit mehreren Messpunkten entstehen.

Die LiveTracking-Anzeige soll mindestens darstellen:
- Wer befindet sich gerade auf der Strecke / ist aktiv
- Welche Splitzeiten und Rundenzeiten fährt diese Person
- Was ist ihre beste Rundenzeit
- Es soll zwischen Training und Qualifying unterschieden werde. 
- Im Training wird immer der Sportler, der als letztes die Start/Ziel Linie überfährt (Ziel-Decoder) oben angezeigt.
  Für den Sportler werden die Anzahl der Runden, die letzte und die schnellste Rundenzeit angezeigt.
  Zudem die Splitzeiten, der laufenden Runde.
  Außerdem werden die x letzten Rundenzeiten in einer Zweiten Zeile angezeigt.  
- Wenn ein Qualifying aktiviert wurde wird für die Sportler (Transponder) angezeigt welchen Platz er basierend auf der seiner schnellsten Rundenzeit im Ranking einnimmt 
- Welchen Platz hat sie im Qualifying basierend auf der besten gültigen Runde

TEILNEHMERMODELL:
Zusätzlich soll es möglich sein, auf Event-Ebene LiveTracking-Teilnehmer zu pflegen, ohne dass zwingend ein Race in RaceOffice angelegt sein muss.

Diese eventweiten Teilnehmer enthalten die attribute des Athlete aus athlete.ts :
- ID
- Bib
- Name
- Vorname
- Nationalität
- AgeGroup
sowie zusätzlich
- TransponderIds
für das Mapping zwischen LiveTracking und den Athleten

WICHTIG:
- Eventweite Teilnehmer ersetzt Race-basierte Sessions nicht grundsätzlich.
- Für das Qualifiying wird in einer späteren Ausbaustufe soll das system zwei Betriebsarten unterstützen:
  1. Session basiert auf eventweitem LiveTracking-Roster
  2. Session basiert auf RaceOffice-Race

EXTERNE TECHNISCHE RAHMENBEDINGUNGEN:
AMM Converter:
- Der AMM Converter ist ein Kommandozeilenprogramm.
- Er verbindet sich zu einem Decoder über LAN/IP oder seriell.
- Er konvertiert die Decoderdaten in JSON.
- Er kann die JSON-Daten per WebSocket an Clients ausgeben.
- Pro Instanz wird ein WebSocket-Server auf einem konfigurierten Port geöffnet.
- Typisches Muster: pro Decoder eine eigene AMM-Converter-Instanz.

ProChip / Timing:
- Mehrere Decoder können an unterschiedlichen Punkten auf dem Track installiert sein.
- Die Decoder sind per GPS synchronisiert und haben damit dieselbe Zeitbasis.
- Die fachliche Wahrheit entsteht aus:
  - Track-Modell
  - geordneten TimingPoints
  - GPS-synchronen Zeitstempeln
  - plausibler Sequenzlogik pro Transponder

DOKUMENTMODELL:
Bitte arbeite auf Basis folgender Dokumenttypen:
1. liveTrackingRoster:{eventId}
2. liveTrackingSetup:{eventId} oder liveTrackingSetup:{setupId}
3. liveTrackingSession:{sessionId}
4. liveTrackingRuntime:{sessionId}
5. liveTrackingResults:{sessionId}

WICHTIG:
- Setup, Session, Runtime und Results strikt trennen.
- Keine Vermischung von persistierter Konfiguration und flüchtigem Laufzeitzustand.
- Kein monolithisches Dokument, das alles gleichzeitig enthält.

SESSION-STATE-MACHINE:
Zustände:
- idle
- preparing
- ready 
- running
- stopping
- error


Command-Intents:
- prepare  (Stößt Übergang an: idle -> preparing -> ready)
- start  (ready -> running)
- stop (running -> ready)
- shutdown (ready -> idle)
- reset

TRACK-/TIMINGPOINT-MODELL:
- Track
  - id
  - name
  - lengthM
  - timingPoints[]
- TimingPoint
  - id
  - name
  - decoderId
  - decoderIp
  - websocketPortAMM
  - order
  - distanceFromPreviousM
  - absolutePositionM
  - role: start_finish | split 
  - enabled

WICHTIG:
- Aus distanceFromPreviousM immer absolutePositionM ableiten.
- Genau ein Punkt soll Start/Ziel sein.
- Reihenfolge muss fachlich konsistent und lückenlos sein.

TEILNEHMERIDENTITÄT:
- Arbeite intern nicht über Name oder Bib als Primärschlüssel.
- Nutze die ID des Athlete.
- LiveTrackingAthlete:
  - ID
  - bib
  - firstName
  - lastName
  - nationality
  - ageGroup
  - transponderIds: string[]

TIMING-ENGINE:
Die Timing-Engine ist fachlich zentral und soll als pure Logik in packages/domain liegen.

Sie verarbeitet normalisierte PassingEvents und erzeugt:
- aktuelle Splits
- Sektorzeiten
- letzte Runde
- beste Runde
- Qualifying-Ranking
- Aktivitätsstatus pro Teilnehmer

WICHTIG:
- Berechne nicht blind alles aus jedem Passing.
- Verwende Plausibilitätsregeln:
  - Debounce pro Transponder und TimingPoint
  - minimale Abschnittszeit
  - minimale Rundenzeit
  - erwartete Sequenz der TimingPoints
  - Erkennung von doppelten Passings
  - Umgang mit fehlenden Splits
  - Umgang mit unbekannten Transpondern
  - Möglichkeit, ungültige Runden nicht ins Qualifying zu übernehmen

FRONTEND-ZIELE:
A) apps/frontend (wird als letztes gebaut)
- Pflege / Import des eventweiten LiveTracking-Rosters
- Transponderzuordnung
- Setup-Editor für Track / TimingPoints / Decoder
- Session-Administration optional

B) apps/livetracking-frontend
- Session Control
- Live Board
- Debug / Timing Monitor

ARBEITSWEISE:
- Arbeite zuerst architekturgetrieben und repositorykonform.
- Beginne nicht mit UI.
- Beginne mit Domain-Modell, Dokumenttypen und Integrationspunkten in das bestehende RaceOffice-System.
- Arbeite inkrementell und in kleinen reviewbaren Schritten.
- Keine unnötigen großflächigen Refactorings ohne Not.
- Neue Domainlogik möglichst als pure Funktionen in packages/domain/livetracking
- Keine Logik im Frontend duplizieren, wenn sie zentral in domain leben kann.

DEINE ERSTE AUFGABE:
1. Analysiere die aktuelle Repository-Struktur.
2. Identifiziere die Stellen für:
   - neue Dokumenttypen
   - gemeinsame Domain-Typen
   - neuen Worker
   - neues LiveTracking-Frontend
3. Erstelle einen konkreten Umsetzungsplan für dieses Repo.
4. Implementiere noch nichts, bevor du die Analyse und den Plan klar dargestellt hast.
```

---

## 2. Repo-Analyse-Prompt

```text
Analysiere jetzt das bestehende Repository konkret.

Ziel:
- Verstehe die aktuelle Ordnerstruktur
- identifiziere die bestehenden Architekturgrenzen
- finde heraus, wo Dokumenttypen, Domain-Typen und Frontend-/Server-Integrationspunkte liegen
- nenne die konkreten Dateien und Module, die für LiveTracking erweitert werden müssten

Bitte liefere:
1. eine kurze Zusammenfassung der bestehenden Struktur
2. eine Liste der relevanten bestehenden Dateien / Module
3. einen Vorschlag, wo genau die neuen Artefakte eingeführt werden sollten:
   - liveTrackingRoster
   - liveTrackingSetup
   - liveTrackingSession
   - liveTrackingRuntime
   - liveTrackingResults
   - apps/livetracking-worker
   - apps/livetracking-frontend
4. eine Empfehlung, welche Implementierungsreihenfolge für dieses konkrete Repo am besten passt

Noch keine UI implementieren.
Noch keinen Worker implementieren.
Noch keine großen Refactorings.
```

---

## 3. Phase 1: Domain-Modell und Basistypen

```text
Implementiere jetzt Phase 1: Domain-Modell und Basistypen.

Ziel:
Lege in packages/domain die Basistypen und Basisschemas für LiveTracking an.

Zu modellieren:
- liveTrackingRoster
- liveTrackingSetup
- liveTrackingSession
- liveTrackingRuntime
- liveTrackingResults

Zusätzlich:
- participantId-basierte Roster-Teilnehmer
- participantSource
- Session-State-Machine-Typen
- LiveTrackingCommand
- Track / TimingPoint
- erste Ergebnis- und Statusstrukturen

WICHTIG:
- Noch keine UI
- Noch kein Worker
- Noch keine AMM-Integration
- Noch keine vollständige Timing-Engine
- Fokus auf saubere Typen, Interfaces, Initializer, Type Guards oder Schema-Helfer
- Bleibe konsistent mit dem bestehenden Stil in packages/domain

Bitte:
1. nenne kurz den Plan
2. nenne die betroffenen Dateien
3. implementiere die Domain-Typen
4. erkläre danach knapp, was angelegt wurde
5. nenne offene Punkte für den nächsten Schritt
```

---

## 4. Phase 2: Dokumenttypen in den bestehenden Server integrieren

```text
Implementiere jetzt Phase 2: Integration der neuen LiveTracking-Dokumenttypen in die bestehende Dokumentwelt des Servers.

Ziel:
Die neuen Dokumenttypen sollen im bestehenden dokumentbasierten Realtime-/Persistenzmodell sauber unterstützt werden.

Dokumenttypen:
- liveTrackingRoster:{eventId}
- liveTrackingSetup:{eventId} oder liveTrackingSetup:{setupId}
- liveTrackingSession:{sessionId}
- liveTrackingRuntime:{sessionId}
- liveTrackingResults:{sessionId}

WICHTIG:
- Setup, Session, Runtime und Results strikt getrennt halten
- keine Vermischung von Runtime- und Konfigurationszustand
- keine zweite Persistenzwelt einführen
- möglichst wenig invasive Änderungen

Bitte:
1. analysiere die bestehenden Server-Stellen für Dokument-Handling, Defaults, ggf. Bootstrap-Logik
2. erweitere diese gezielt um die neuen Dokumenttypen
3. ergänze Initializer / Defaults, falls im bestehenden Architekturmodell üblich
4. erkläre danach konkret:
   - welche Dateien geändert wurden
   - wie neue Dokumente initialisiert werden
   - welche Risiken oder Folgearbeiten offen bleiben

Noch keine UI.
Noch kein Worker.
Noch keine Timing-Engine.
```

---

## 5. Phase 3: Eventweiter LiveTracking-Roster

```text
Implementiere jetzt Phase 3: eventweiten LiveTracking-Roster.

Ziel:
Es soll ein eventweiter Teilnehmerpool für LiveTracking modelliert und in die bestehende Systemarchitektur integriert werden.

Fachlich:
- Ein LiveTracking-Roster ist eventbezogen
- Teilnehmer haben:
  - participantId
  - bib
  - firstName
  - lastName
  - nationality
  - ageGroup
  - transponderIds: string[]
- Der Roster ist unabhängig davon nutzbar, ob ein Race in RaceOffice existiert

WICHTIG:
- Race-basierte Sessions sollen später weiterhin möglich bleiben
- Daher Roster nicht als Ersatz des Race-Modells implementieren
- Nur als zusätzliche participantSource
- Dubletten und Konflikte berücksichtigen, insbesondere Transponderkonflikte

Bitte:
1. erweitere Domain und ggf. Server-seitige Dokumentnutzung so, dass der Roster sauber unterstützt wird
2. führe sinnvolle Hilfsfunktionen ein für:
   - Participant-Erzeugung
   - Validierung
   - Konfliktprüfung
3. wenn bereits sinnvoll, ergänze Import-nahe Hilfsstrukturen
4. erkläre danach:
   - welche Konfliktregeln du implementiert hast
   - wie der Roster später von Sessions referenziert werden soll

Noch keine große UI.
Noch keine Worker-Logik.
```

---

## 6. Phase 4: Setup-Modell und TimingPoints

```text
Implementiere jetzt Phase 4: Setup-Modell für Track, TimingPoints und Decoder.

Ziel:
Das LiveTracking-Setup soll allgemeine Tracks mit beliebig vielen TimingPoints abbilden können.

Zu modellieren:
- Track
- TimingPoints
- Decoder-IP
- Reihenfolge
- distanceFromPreviousM
- absolutePositionM
- role
- enabled
- genau ein Start/Ziel-Punkt

WICHTIG:
- Nicht als Spezialfall für nur zwei Decoder modellieren
- Das Modell muss mehrere TimingPoints auf zyklischer Strecke abbilden können
- absolutePositionM soll aus distanceFromPreviousM abgeleitet werden
- sinnvolle Validierung ergänzen:
  - genau ein start_finish
  - Reihenfolge lückenlos
  - Distanzwerte plausibel
  - doppelte Decoder/IP-Konflikte erkennen, falls fachlich sinnvoll

Bitte:
1. ergänze die Domainmodelle und Validierungsfunktionen
2. implementiere reine Hilfsfunktionen für:
   - Normalisierung / Sortierung der TimingPoints
   - Berechnung von absolutePositionM
   - Setup-Validierung
3. erkläre danach:
   - welche Annahmen du getroffen hast
   - welche Punkte später im UI gepflegt werden müssen

Noch keine UI.
Noch kein Worker.
Noch keine Timing-Engine.
```

---

## 7. Phase 5: Session-State-Machine und Command Queue

```text
Implementiere jetzt Phase 5: Session-State-Machine und Command Queue.

Ziel:
LiveTracking-Sessions sollen nicht über lose unstrukturierte Kommandos gesteuert werden, sondern über ein klares Lifecycle-Modell.

Zustände:
- idle
- preparing
- ready
- arming
- running
- stopping
- stopped
- error

Command-Intents:
- prepare
- arm
- start
- stop
- shutdown
- reset

WICHTIG:
- Commands nicht als fire-and-forget behandeln
- Worker soll Command-Status zurückschreiben können
- Ungültige Übergänge müssen erkennbar sein
- Session-Dokument soll desiredState, actualState / state und Command Queue sinnvoll abbilden

Bitte:
1. ergänze die Domainmodelle für Session und Commands
2. implementiere pure Hilfsfunktionen für:
   - Validierung erlaubter Zustandsübergänge
   - Enqueue / Ack / Complete / Fail / Reject von Commands
   - Ableitung des nächsten sinnvollen Arbeitsschritts
3. erkläre danach:
   - wie der Worker dieses Modell später konsumieren soll
   - welche invariants gelten

Noch keinen Worker implementieren.
Noch keine UI.
```

---

## 8. Phase 6: Worker-Grundgerüst

```text
Implementiere jetzt Phase 6: Grundgerüst für apps/livetracking-worker.

Ziel:
Ein neuer Worker-Prozess soll in das Monorepo eingeführt werden, der später Setup/Session-Dokumente beobachtet und technische Decoder-/AMM-Aufgaben übernimmt.

WICHTIG:
- Der Worker ist kein zweiter Persistenzserver
- Er baut keine eigene konkurrierende Zustandswelt auf
- Er liest und schreibt in die bestehende Dokumentwelt
- Zunächst nur Grundgerüst, Bootstrap, Struktur und dokumentbezogene Integrationspunkte

Bitte:
1. lege apps/livetracking-worker an
2. richte die minimal nötige Projektstruktur ein
3. implementiere ein sauberes Bootstrap
4. implementiere zunächst nur das Lesen / Beobachten relevanter Dokumente oder den dafür vorgesehenen Zugriffspfad im bestehenden System
5. schreibe noch keine vollständige AMM- oder Timing-Logik
6. erkläre danach:
   - wie der Worker ins Monorepo integriert wurde
   - welche Abhängigkeiten und Startskripte ergänzt wurden
   - wie der Worker später Session-Commands konsumieren soll
```

---

## 9. Phase 7: Runtime-Modell und Worker-Status

```text
Implementiere jetzt Phase 7: Runtime-Modell und erste Worker-Statusaktualisierung.

Ziel:
Der Worker soll einen nachvollziehbaren technischen Laufzeitzustand in liveTrackingRuntime:{sessionId} schreiben können.

Inhalte des Runtime-Dokuments:
- Worker-Status
- Prozessstatus je Decoder / TimingPoint
- letzte erfolgreiche Verbindung
- letzter WebSocket-Empfang je Decoder
- Fehlerzustände
- Heartbeat / Health-Infos
- technische Debugdaten

WICHTIG:
- Runtime ist rein technischer Laufzeitzustand
- Keine Vermischung mit Setup oder fachlichen Ergebnissen
- Noch keine fertige Timing-Engine in Results vorwegnehmen

Bitte:
1. ergänze Runtime-Strukturen, falls nötig
2. implementiere im Worker erste Runtime-Aktualisierungen
3. sorge dafür, dass Session-/Runtime-Kopplung nachvollziehbar bleibt
4. erkläre danach:
   - welche Runtime-Zustände geschrieben werden
   - welche technischen Ereignisse bereits abgedeckt sind
   - was noch fehlt, bevor AMM-Integration startet
```

---

## 10. Phase 8: AMM-Converter-Prozessmanagement

```text
Implementiere jetzt Phase 8: AMM-Converter-Prozessmanagement im Worker.

Ziel:
Pro TimingPoint / Decoder soll der Worker eine eigene AMM-Converter-Instanz starten, überwachen und stoppen können.

WICHTIG:
- Noch nicht mit der vollständigen Timing-Logik vermischen
- Fokus auf technische Prozesssteuerung
- robuste Fehlerbehandlung
- Logging / stdout / stderr / exit status berücksichtigen
- Port-Konflikte und fehlerhafte Starts beachten

Bitte:
1. implementiere einen Prozessmanager im Worker
2. leite die notwendigen Prozesse aus liveTrackingSetup und liveTrackingSession ab
3. berücksichtige Start / Stop / Restart / Shutdown
4. aktualisiere liveTrackingRuntime passend
5. erkläre danach:
   - wie Prozesse identifiziert und verwaltet werden
   - welche Fehlerfälle berücksichtigt werden
   - welche Annahmen über CLI-Aufruf und Ports noch verifiziert werden müssen

Noch keine vollständige fachliche Ergebnisberechnung.
```

---

## 11. Phase 9: WebSocket-Collector für AMM-Output

```text
Implementiere jetzt Phase 9: WebSocket-Collector für die Ausgaben der AMM-Converter-Instanzen.

Ziel:
Der Worker soll die JSON-Passings aus den WebSocket-Streams der laufenden AMM-Converter konsumieren können.

WICHTIG:
- Noch keine komplette Timing-Engine in einem Schritt bauen
- Zuerst saubere Erfassung und Normalisierung der Rohereignisse
- Fehlertoleranz und Reconnect beachten
- Eingehende Daten nachvollziehbar loggen oder in Debugstrukturen abbilden

Bitte:
1. implementiere die Verbindung zu den konfigurierten WebSocket-Endpunkten
2. parse die JSON-Nachrichten robust
3. normalisiere sie in ein internes PassingEvent-Modell
4. trenne klar:
   - raw incoming payload
   - normalized passing event
5. aktualisiere liveTrackingRuntime um technische WS-Zustände
6. erkläre danach:
   - welches interne Eventmodell du verwendest
   - welche Annahmen über das JSON-Format getroffen wurden
   - welche nächsten Schritte für die Timing-Engine nötig sind
```

---

## 12. Phase 10: Timing-Engine Basiskern

```text
Implementiere jetzt Phase 10: Basiskern der Timing-Engine in packages/domain.

Ziel:
Aus normalisierten PassingEvents soll eine fachliche State-Verarbeitung entstehen.

Die Timing-Engine soll zunächst als pure Logik in packages/domain implementiert werden.

Fokus:
- Zuordnung transponderId -> participantId
- Verarbeitung einer Passing-Sequenz
- current athlete live state
- last lap
- best lap
- einfache split-/round-Grundlogik

WICHTIG:
- Keine UI-Logik
- Keine direkte Worker-Verdrahtung in denselben Funktionen
- pure Funktionen
- kleine, testbare Einheiten
- Plausibilitätsregeln von Anfang an berücksichtigen

Bitte:
1. implementiere die zentralen Domainfunktionen
2. beginne mit einem minimal tragfähigen Kern und nicht mit allen Spezialfällen auf einmal
3. berücksichtige:
   - Debounce
   - erwartete TimingPoint-Reihenfolge
   - minimale Abschnittszeiten
   - minimale Rundenzeit
   - unbekannte Transponder
4. erkläre danach:
   - wie eine gültige Runde aktuell definiert ist
   - was noch fehlt für eine vollständige Qualifying-Logik
```

---

## 13. Phase 11: Results-Dokument befüllen

```text
Implementiere jetzt Phase 11: liveTrackingResults aus Worker + Timing-Engine befüllen.

Ziel:
Der Worker soll die normalisierten Passings an die Timing-Engine übergeben und die berechneten Ergebnisse in liveTrackingResults:{sessionId} schreiben.

Die Ergebnisse sollen mindestens enthalten:
- recentPassings
- athleteLiveStates
- letzte Runde
- beste Runde
- aktuelle Splits
- unknownTransponders
- warnings / invalidated events
- Qualifying-Grundsortierung

WICHTIG:
- Results sind fachliche Ergebnisse
- Runtime bleibt technisch
- Setup bleibt konfigurationsbezogen
- klare Trennung beibehalten

Bitte:
1. verdrahte Worker und Timing-Engine
2. fülle Results-Dokument schrittweise
3. halte die Datenstruktur für Frontends gut nutzbar
4. erkläre danach:
   - welche Result-Felder jetzt zuverlässig befüllt werden
   - welche Felder vorläufig / experimentell sind
   - welche Folgearbeiten für Ranking und Anzeige noch fehlen
```

---

## 14. Phase 12: Qualifying-Ranking schärfen

```text
Implementiere jetzt Phase 12: Qualifying-Ranking.

Ziel:
Die LiveTracking-Ergebnisse sollen eine fachlich saubere Qualifying-Wertung auf Basis der besten gültigen Runde enthalten.

Bitte berücksichtige:
- pro Teilnehmer die beste gültige Runde
- Ranking nach bester Runde
- stabile Sortierung bei Gleichstand
- ungültige Runden nicht werten
- Teilnehmer ohne gültige Runde sinnvoll behandeln
- Teilnehmeraktivität getrennt vom Ranking modellieren

WICHTIG:
- Ranking-Regeln explizit machen
- Nicht stillschweigend Annahmen treffen
- Falls im bestehenden Projekt Kontext fehlt, implementiere eine nachvollziehbare Default-Regel und dokumentiere sie klar

Bitte:
1. erweitere Domain und Results
2. implementiere Ranking-Berechnung als pure Logik
3. verdrahte sie in die Ergebnisberechnung
4. erkläre danach:
   - welche Ranking-Regeln gelten
   - wo fachliche Entscheidungen noch offen sein könnten
```

---

## 15. Phase 13: RaceOffice-Frontend für Roster und Setup

```text
Implementiere jetzt Phase 13: erste UI-Erweiterungen im bestehenden apps/frontend.

Ziel:
Im bestehenden RaceOffice-Frontend sollen die Grundlagen für:
- eventweiten LiveTracking-Roster
- Transponderpflege
- LiveTracking-Setup
sichtbar und bearbeitbar werden.

WICHTIG:
- Nicht die gesamte UI auf einmal bauen
- Erst minimale, saubere Verwaltung
- Nutze bestehende Dokument- und UI-Muster des Projekts
- keine Fachlogik im Frontend duplizieren, die bereits in domain existiert

Bitte:
1. analysiere die bestehenden UI-Muster für Dokumentbearbeitung
2. erweitere sie um:
   - eventweiten Roster
   - TransponderIds
   - Setup-Bearbeitung für Track / TimingPoints / Decoder
3. implementiere zunächst die minimal nötigen Views / Formulare
4. erkläre danach:
   - welche UI-Teile ergänzt wurden
   - welche Teile bewusst noch fehlen
```

---

## 16. Phase 14: livetracking-frontend

```text
Implementiere jetzt Phase 14: apps/livetracking-frontend.

Ziel:
Ein neuer spezialisierter LiveTracking-Client soll entstehen.

Er soll zunächst drei Bereiche unterstützen:
1. Session Control
2. Live Board
3. Debug / Timing Monitor

WICHTIG:
- Keine Admin-Komplettlösung bauen
- Fokus auf Live-Nutzung
- bestehende Dokumentwelt verwenden
- keine eigene API-Welt daneben erfinden
- keine Fachlogik duplizieren, sondern Results/Runtime nutzen

Bitte:
1. lege apps/livetracking-frontend im Monorepo an
2. integriere es sauber in Build-/Workspace-Struktur
3. implementiere erste Ansichten für:
   - Session Control
   - Live Board
   - Debug / Monitor
4. erkläre danach:
   - welche Dokumente der Client konsumiert
   - welche Anzeigen bereits live funktionsfähig sind
   - was für produktionsreife Nutzung noch fehlt
```

---

## 17. Phase 15: Härtung und Fehlerfälle

```text
Implementiere jetzt Phase 15: Härtung und Fehlerfälle.

Ziel:
Das LiveTracking-System soll robuster gegen reale Betriebsprobleme werden.

Bitte überprüfe und verbessere mindestens:
- Worker-Neustart
- Prozessabsturz des AMM Converter
- fehlende WebSocket-Verbindung
- Decoder-Stille / Timeouts
- unbekannte Transponder
- doppelte Passings
- fehlende TimingPoints in einer Runde
- ungültige Runden
- inkonsistente Session-Commands

WICHTIG:
- Keine kosmetischen Änderungen
- Fokus auf Robustheit und nachvollziehbares Verhalten
- Fehlerzustände müssen in Runtime / Results sichtbar werden
- Entscheidungen dokumentieren

Bitte:
1. analysiere die aktuellen Schwachstellen
2. implementiere gezielte Verbesserungen
3. erkläre danach:
   - welche Fehlerfälle jetzt behandelt werden
   - welche Rest-Risiken bleiben
```

---

## 18. Review-Prompt: Architekturprüfung

```text
Prüfe die aktuelle Implementierung kritisch gegen die Zielarchitektur.

Achte insbesondere auf:
- keine zweite Datenwahrheit neben apps/server
- klare Trennung von:
  - Setup
  - Session
  - Runtime
  - Results
- keine fachliche Timing-Logik im falschen Layer
- keine unnötige Logikduplikation im Frontend
- Worker als ausführender Dienst, nicht als konkurrierender Backend-Kern
- Domainlogik möglichst als pure Funktionen in packages/domain

Bitte liefere:
1. konkrete Architekturverstöße oder Risiken
2. konkrete betroffene Dateien / Module
3. konkrete Verbesserungsvorschläge
4. Priorisierung nach Schweregrad

Sei kritisch und direkt.
```

---

## 19. Review-Prompt: Codequalität und Vereinfachung

```text
Prüfe die aktuelle Implementierung auf unnötige Komplexität, inkonsistente Modelle und vermeidbare technische Schulden.

Achte auf:
- zu früh abstrahierte Strukturen
- doppelte Typdefinitionen
- inkonsistente Benennungen
- vermischte Verantwortlichkeiten
- unnötig enge Kopplung zwischen Worker und Domain
- schwer testbare Logik
- fehlende Initializer / Guards / Validierungen

Bitte liefere:
1. die wichtigsten Probleme
2. Vorschläge zur Vereinfachung
3. welche Änderungen jetzt sinnvoll sind und welche erst später
```

---

## 20. Review-Prompt: Fachliche Timing-Prüfung

```text
Prüfe die aktuelle Timing-Logik fachlich kritisch.

Achte insbesondere auf:
- Definition einer gültigen Runde
- Debounce-Logik
- minimale Abschnittszeiten
- minimale Rundenzeiten
- erwartete Reihenfolge der TimingPoints
- Umgang mit fehlenden Splits
- Umgang mit unbekannten Transpondern
- Ranking nur aus gültigen Runden
- Trennung zwischen Aktivitätsstatus und Qualifying-Ranking

Bitte liefere:
1. fachliche Schwächen oder falsche Annahmen
2. konkrete problematische Code-Stellen
3. Verbesserungsvorschläge
4. welche Regeln noch explizit entschieden werden sollten
```

---

## Empfohlene Reihenfolge

1. Startprompt
2. Repo-Analyse
3. Phase 1
4. Review Architektur
5. Phase 2
6. Phase 3
7. Phase 4
8. Review Architektur
9. Phase 5
10. Phase 6
11. Phase 7
12. Phase 8
13. Phase 9
14. Review Timing
15. Phase 10
16. Phase 11
17. Phase 12
18. Review Architektur + Timing
19. Phase 13
20. Phase 14
21. Phase 15

---

## Quellenhinweise für den Assistenten

Diese Hinweise kann der Assistent bei der Implementierung benötigen, auch wenn sie nicht direkt im Code stehen:

1. RaceOffice Repo / Doku
- Monorepo mit `apps/*` und `packages/*`
- dokumentbasierter Realtime-Sync
- WebSocket-gestützte Dokumente
- SQLite-Persistenz
- gemeinsames Domain-Package

2. AMM Converter
- CLI-Tool
- pro Decoder typischerweise eigene Instanz
- JSON-Ausgabe
- WebSocket-Ausgabe pro Instanz auf konfigurierbarem Port

3. ProChip Timing System
- GPS-/UTC-Synchronisation
- gemeinsame Zeitbasis mehrerer Decoder
- relevant für split-/lap-Berechnung über mehrere Messpunkte

---

## Praktischer Hinweis für den Einsatz

Die beste Arbeitsweise ist:

- einmal mit dem langen Startprompt initialisieren
- dann phasenweise mit den kurzen Umsetzungs-Prompts arbeiten
- nach jeder größeren Phase Architekturprüfung
- bei Timing-Engine zusätzlich fachliche Timing-Prüfung

Das verhindert, dass das Modell:
- zu früh UI baut
- Setup, Runtime und Results vermischt
- Logik in den falschen Layer legt
- eine zweite Datenwahrheit aufbaut




#### Umsetzungsplan nach initialem Prompt: 


Phase 0 – Architektur-Fundament in Domain (ohne Worker/UI)
packages/domain/src/livetracking/ anlegen
Typen + Initializer + Guards für 5 Dokumenttypen
Doc-ID-Builder (string-Konvention zentralisieren)
Exports im Domain-Index ergänzen
Ergebnis: Server/Worker/Frontends greifen auf identische Typen + Defaults zu.

Phase 1 – Server-Dokumentintegration (minimal-invasiv)
apps/server/src/index.ts nur gezielt erweitern:
Erkennung der liveTracking* DocIds
Initialisierung mit Domain-Initializern
bestehendes WS/Patch-Handling unverändert lassen
Ergebnis: Livetracking-Dokumente sind im bestehenden Realtime-/Persistenzmodell verankert.

Phase 2 – Session-State-Machine + Commands (Domain first)
Sessionzustände (idle/preparing/ready/running/stopping/error) modellieren
erlaubte Transitionen als pure Funktionen
Command-Intent Modell + Queue/Statusfelder definieren
Ergebnis: Worker kann später robust und nachvollziehbar steuern.

Phase 3 – Setup/Track/TimingPoint Domainlogik
Track/TimingPoint-Typen
absolutePositionM aus distanceFromPreviousM ableiten
Validierung:
genau ein start_finish
konsistente Reihenfolge
lückenlose order
Plausibilitätsprüfungen
Ergebnis: saubere Setup-Grundlage für Decoder/AMM.

      Phase 4 – Eventweites Roster (Domain + Doc-Struktur)
      LiveTrackingAthlete + Transponder-Zuordnung
      Konfliktprüfungen (z. B. doppelte Transponder)
      klare Referenzierung über participantId/athlete.id
      Ergebnis: Session kann später race-unabhängig auf Event-Roster laufen.

Phase 5 – Worker-Grundgerüst (noch ohne volle Timing-Engine)
neuen Workspace apps/livetracking-worker anlegen
Realtime-Doc-Lese-/Schreibpfad implementieren
Session-Command-Loop (prepare/start/stop/shutdown/reset) andocken
Runtime-Heartbeat schreiben
Ergebnis: ausführender Dienst existiert, aber keine zweite Zustandswelt.

Phase 6 – AMM-Collector + normalisierte PassingEvents
pro TimingPoint WS-Verbindung zu AMM
robustes Parsing/Normalisierung
technische Zustände in liveTrackingRuntime:{sessionId}
Ergebnis: technische Datenaufnahme stabil, fachliche Berechnung folgt.

Phase 7 – Timing-Engine in packages/domain + Results-Dokument
pure Engine-Funktionen (Debounce, Sequenz, Min-Zeiten, Unknown Transponder)
Ableitung:
Splits/Sektoren
letzte Runde
beste Runde
Activity-Status
Ausgabe in liveTrackingResults:{sessionId}
Ergebnis: fachlich nutzbare Live-Daten zentral in Domain berechnet.

Phase 8 – Neues livetracking-frontend
Workspace anlegen
Session Control + Live Board + Debug View
nutzt nur Session/Runtime/Results-Dokumente (keine Logikduplikation)
Ergebnis: spezialisierter Live-Client auf bestehender Doc-Architektur.





Offene Folgearbeiten (bewusst noch nicht drin)
keine AMM-/Decoder-Prozesssteuerung
keine Timing-Engine/Results-Befüllung
kein robustes Retry-Handling bei rev_mismatch im Worker-Client
kein dediziertes Observability/Telemetry-Logging pro Command-Lifecycle
Wenn du willst, mache ich als nächsten Schritt direkt Phase 6 (AMM-Collector-Grundlagen) auf diesem Worker-Gerüst.