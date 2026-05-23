# P3-Format: Abgleich zwischen vorhandener Doku und aktueller Implementierung

## Ziel dieses Dokuments

Dieses Dokument gleicht die vorhandenen Notizen in `packages/p3parser/doc/` mit der aktuellen Implementierung in `packages/p3parser/src/` ab.

Wichtig: Es werden **nur** Aussagen aufgenommen, die sich aus den vorhandenen Dateien belegen lassen.

---

## Verwendete Quellen

- `packages/p3parser/doc/Notizen_Analyse.txt`
- `packages/p3parser/doc/DecoderInterface.pas`
- `packages/p3parser/README.md`
- `packages/p3parser/src/types.ts`
- `packages/p3parser/src/parser.ts`
- `packages/p3parser/src/stream.ts`
- `packages/p3parser/src/builder.ts`

Hinweis: Die Datei `packages/p3parser/doc/P3_Protocol_Specification_Enhanced.docx` wurde hier nicht inhaltlich ausgewertet (binäres Office-Dokument).

---

## 1) Frame-Grundstruktur und Byte-Handling

### Belegt in Doku/Referenz

In `DecoderInterface.pas` ist erkennbar:
- Startbyte `0x8E`
- Endbyte `0x8F`
- Escape-Byte `0x8D`
- Escape-Logik: `0x8D` + (`Byte + 0x20`) beim Senden, bzw. `-0x20` beim Empfangen
- Header enthält u. a. Version, Length, CRC, Flags, TOR

### Implementiert in TypeScript

- `P3_CONTROL` mit `START=0x8e`, `ESC=0x8d`, `END=0x8f` in `src/types.ts`
- `deEscapeMessage(...)` und `escapeMessage(...)` in `src/parser.ts` reproduzieren die Pascal-Logik
- Header-Parsing in `parseHeader(...)` in `src/parser.ts`
- TLV-Parsing über `(type, length, value)` in `parseTlvs(...)`

**Abgleich-Ergebnis:** konsistent.

---

## 2) CRC-Verhalten

### Belegt in Doku/Referenz

In `DecoderInterface.pas` (u. a. bei `GetRtcPhrase`, `GetSessionPhrase`, `GetResendPhrase`) wird:
1. ein Frame mit CRC=`0000` gebaut,
2. CRC berechnet,
3. CRC in Header-Bytes zurückgeschrieben,
4. anschließend escaped.

### Implementiert in TypeScript

- CRC16 in `P3Parser.calcCrc16(...)` (`src/parser.ts`) und in `calcCrc16(...)` (`src/builder.ts`)
- Header-CRC-Logik explizit in `calcHeaderCrc(...)` (`src/parser.ts`): CRC-Feld vorher auf `0x00 0x00`
- Builder (`src/builder.ts`) erzeugt Frames mit CRC-Berechnung und Escaping in genau dieser Reihenfolge

**Abgleich-Ergebnis:** konsistent.

---

## 3) Unterstützte TORs (Parser)

### Belegt in Doku/Referenz

`DecoderInterface.pas` parst im Message-Dispatch konkret:
- `TOR_PASSING (0x0001)`
- `TOR_STATUS (0x0002)`
- `TOR_VERSION_DECODER (0x0003)`
- `TOR_GET_TIME (0x0024)`
- `TOR_SESSION (0x0015)`

Zusätzlich sind in den Konstanten weitere TORs definiert.

### Implementiert in TypeScript

In `src/parser.ts` sind als typisierte Records umgesetzt:
- `PASSING (0x0001)`
- `STATUS (0x0002)`
- `VERSION_DECODER (0x0003)`
- `GET_TIME (0x0024)`
- `SESSION (0x0015)`
- `RESEND (0x0004)`

Alle übrigen TORs werden als `kind: "unknown"` mit TLVs/Raw-Daten zurückgegeben.

**Abgleich-Ergebnis:** konsistent zum „nicht erfinden“-Ansatz; TypeScript enthält zusätzlich explizites Parsing für `RESEND`.

---

## 4) Feldsemantik (belegte Dekodierung)

### PASSING (`TOR 0x0001`)

Aus `DecoderInterface.pas` belegt und in `src/parser.ts` umgesetzt:
- Passing Number (`0x01`)
- Transponder TranX (`0x03`) inkl. Sonderwerte:
  - `9992 -> Switch`
  - `9993 -> SyncPulse`
  - `9991 -> FinishCamStart`
- Transponder ProChip/FlexChip (`0x0A`) via ASCII-Dekodierung
- Zeitfelder:
  - RTC (`0x04`) als Fallback
  - UTC (`0x10`) überschreibt RTC wenn vorhanden
- Strength (`0x05`), Hits (`0x06`), Flags (`0x08` -> LowBattery bit0), Sport (`0x14`)
- Decoder-ID (`0x81`) in Pascal-Reihenfolge (reversed-byte Darstellung)
- Observed FIELD_131 (`0x83`) als little-endian unsigned Zahl (`observedField131`)

### STATUS (`TOR 0x0002`)

Belegt und umgesetzt:
- Noise (`0x01`)
- GPS (`0x06`)
- Temperature (`0x07`)
- InputVoltage (`0x0C`) mit `/10`
- Decoder-ID (`0x81`)

`STATUS_SATINUSE (0x0A)` und `STATUS_LOOP_TRIGGERS (0x0B)` sind im Pascal als Konstanten sichtbar, werden in TypeScript aktuell nicht in fixe Felder gemappt (bleiben in `unknownFields`).

### VERSION_DECODER (`TOR 0x0003`)

Belegt und umgesetzt:
- Decoder Type (`0x02`) als ASCII
- Firmware (`0x03`) als ASCII
- Decoder ID (`0x81`) **nicht reversed**, sondern in Wire-Reihenfolge

### GET_TIME (`TOR 0x0024`)

Belegt und umgesetzt:
- RTC (`0x01`) -> Zeit
- Decoder ID (`0x81`)
- Observed FIELD_131 (`0x83`) als little-endian unsigned Zahl (`observedField131`)

### SESSION (`TOR 0x0015`)

Belegt und umgesetzt:
- LastPassingIndex (`0x04`)
- Decoder ID (`0x81`)
- Observed FIELD_131 (`0x83`) als little-endian unsigned Zahl (`observedField131`)
- Request-ID (`0x85`) wird in TypeScript zusätzlich als Decimal-String erfasst

### RESEND (`TOR 0x0004`)

Belegt und umgesetzt:
- FromPassingNumber (`0x01`)
- ToPassingNumber (`0x02`)
- Decoder ID (`0x81`)
- Observed FIELD_131 (`0x83`) als little-endian unsigned Zahl (`observedField131`)

### NETWORK_SETTINGS (`TOR 0x0016`)

Für beobachtete Discovery-Antworten ist nun evidenzbasiert gemappt:
- Feld `0x08` -> `ipAddress`
- Feld `0x09` -> `netmask`
- Feld `0x0A` -> `defaultGateway`
- Feld `0x05` -> `dnsServer` (bei fehlender DNS-Konfiguration oft `0.0.0.0`)

Weitere nicht belegte `NETWORK_SETTINGS`-Felder verbleiben in `unknownFields`.

### Zeitinterpretation

`DecodePassingTime(...)` in `DecoderInterface.pas` rechnet Mikrosekunden seit 1970-01-01. Das wird in `decodeP3Timestamp(...)` (`src/parser.ts`) entsprechend abgebildet.

Hinweis zu FIELD_131 (`0x83`):

Das Feld wird in den TORs `PASSING`, `GET_TIME`, `SESSION` und `RESEND` derzeit evidenzbasiert als numerischer little-endian Wert ausgegeben. Eine fachliche Bedeutung ist in den gezeigten Quellen nicht belastbar benannt.

**Abgleich-Ergebnis:** konsistent mit dokumentierter Evidenz; zusätzliche TypeScript-Details bleiben rückwärtskompatibel.

---

## 5) Stream-Dekodierung

### Belegt in Doku/Referenz

Pascal arbeitet auf laufendem Nachrichtenstrom, de-escaped und parst Frame für Frame.

### Implementiert in TypeScript

`src/stream.ts` (`P3StreamDecoder`):
- nimmt beliebige TCP-Chunks,
- schneidet Frames anhand `0x8E ... 0x8F`,
- versucht Strict-Parsing,
- fällt bei Fehlern auf Best-Effort-Recovery zurück (`parseError` bleibt sichtbar).

**Abgleich-Ergebnis:** funktional konsistent, zusätzlich bessere Recovery/Diagnostik.

---

## 6) Outbound-Requests / Discovery

### In Notizen (`doc/Notizen_Analyse.txt`) beobachtete UDP Discovery-Frames

Die Datei enthält beobachtete Broadcast-Requests von Orbits (`255.255.255.255`, UDP `5303 -> 5403`), u. a.:
- 25-Byte Request: `8e001900a53900000300010002000300040008000a000c008f`
- 32-Byte Request: `8e001f00dd8daf000036000100020003000400050006000700080009000a008f`
- 23-Byte Request: `8e001700a7f600004a000100020003000400050006008f`
- 21-Byte Request: `8e001500338000001200010002000300040005008f`

Außerdem sind in `Notizen_Analyse.txt` Beispielantworten des Smart-Decoder dokumentiert.

### In TypeScript implementierte Builder (`src/builder.ts`)

Vorhanden sind:
- `buildDecoderSearchRequest()` -> exakt der 25-Byte-Frame aus Pascal (`GetDecoderSearchPhrase`)
- `buildDecoderSearchSmartDecoderBugRequest()` -> exakt der Pascal-Workaround-Frame aus `GetDecoderSearchPhraseSmartDecoderBug`
- `buildGetTimeRequest()`
- `buildSessionRequest(decoderId)`
- `buildResendRequest(from, to, decoderId)`

Wichtig:
- Die zusätzlichen Orbits-Broadcast-Varianten aus `Notizen_Analyse.txt` (32/23/21 Byte) sind **nicht** als eigene Builder in `src/builder.ts` vorhanden.
- Der implementierte SmartDecoderBug-Frame stammt aus `DecoderInterface.pas` und unterscheidet sich von den in `Notizen_Analyse.txt` gezeigten 21/23/32-Byte-Varianten.

**Abgleich-Ergebnis:**
- Standard-Discovery (25 Byte) ist belegt + implementiert.
- Weitere in Notizen beobachtete Discovery-Varianten sind dokumentiert, aber aktuell nicht als dedizierte Builder modelliert.

---

## 7) Was in der Implementierung bewusst offen bleibt

Wie in `README.md` und im Code (`unknownFields`) ersichtlich:
- nicht belegte Feldsemantik wird nicht „erfunden“;
- nicht gemappte TLVs bleiben erhalten;
- unbekannte TORs gehen als `kind: "unknown"` nicht verloren.

**Abgleich-Ergebnis:** konsistent mit dem dokumentierten Designziel.

---

## Zusammenfassung

Die aktuelle TypeScript-Implementierung in `packages/p3parser/src/` ist im Kern konsistent zur Pascal-Referenz in `packages/p3parser/doc/DecoderInterface.pas` und zur bestehenden Paketdokumentation in `packages/p3parser/README.md`.

Die in `packages/p3parser/doc/Notizen_Analyse.txt` dokumentierten zusätzlichen UDP-Discovery-Frames (21/23/32 Byte) sind als Analysewissen vorhanden, aber derzeit nicht als separate Builder-Funktionen implementiert.
