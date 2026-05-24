# P3 Low-Level API

Der Low-Level-Stack gibt direkten Zugriff auf das P3-Wire-Protokoll: Frame-Parsing, Stream-Dekodierung und Outbound-Request-Builder. Er ist für Debugging, Protokollanalyse und Power-User gedacht.

Für Anwendungscode empfiehlt sich stattdessen die [Client API](client-api.md).

---

## Architektur

### `P3Parser`

Parst genau **eine** vollständige P3-Nachricht.

- De-Escaping
- Header lesen
- CRC berechnen und prüfen
- TLVs extrahieren
- bekannten TOR dekodieren
- unbekannte Felder in `unknownFields` belassen

### `P3StreamDecoder`

Nimmt beliebige TCP-Bytes entgegen und extrahiert daraus einzelne Frames.  
Damit kann `socket.on("data", ...)` direkt verarbeitet werden ohne Annahmen über Paketgrenzen.

---

## Installation / Build

```bash
npm install
npm run check
npm run build
npm run test
```

---

## Kurzes Beispiel: Einzelframe parsen

```ts
import { P3Parser } from "@raceoffice/p3parser";

const parser = new P3Parser();

const record = parser.parseRecord(
  "8E0228002DA5000002000102000007021B000C016D0601010A01038104521504008304A40203008F",
);

console.dir(record, { depth: null });
// → P3StatusRecord mit kind: "status"
```

## Live-Nutzung am TCP-Socket

```ts
import net from "node:net";
import { P3Parser, P3StreamDecoder } from "@raceoffice/p3parser";

const parser = new P3Parser();
const stream = new P3StreamDecoder(parser);

const socket = net.createConnection({ host: "192.168.0.10", port: 5403 });

socket.on("data", (chunk) => {
  const { records } = stream.push(chunk);
  for (const record of records) {
    console.dir(record, { depth: null });
  }
});
```

---

## Implementierte TORs

Diese TORs werden vollständig typisiert:

| TOR | Name | Anmerkung |
|---|---|---|
| `0x0001` | PASSING | Transponder-Erkennung |
| `0x0002` | STATUS | Decoder-Gesundheitsstatus |
| `0x0003` | VERSION_DECODER | Decoder-Identifikation |
| `0x0004` | RESEND | Echo einer Resend-Anfrage |
| `0x0012` | (observed) | Beobachtete UDP-Discovery-Antwort |
| `0x0013` | SERVER_SETTINGS | Opake Felder |
| `0x0015` | SESSION | Session-Info (letzter Passing-Index) |
| `0x0016` | NETWORK_SETTINGS | IP-Konfiguration des Decoders |
| `0x0024` | GET_TIME | Decoder-RTC-Zeitstempel |
| `0x0028` | GENERAL_SETTINGS | Opake Felder |
| `0x002D` | SIGNALS | Opake Felder |
| `0x0030` | GPS_INFO | Opake Felder |
| `0x0045` | FIRST_CONTACT | Opake Felder |
| `0x004A` | TIMELINE | Beobachtete UDP-Discovery-Antwort |

TORs/Felder ohne belastbare Evidenz bleiben als `kind: "unknown"` bzw. in `unknownFields` erhalten.

---

## Rückgabetypen

### Bekannte Record-Typen

- `P3PassingRecord`
- `P3StatusRecord`
- `P3VersionDecoderRecord`
- `P3GetTimeRecord`
- `P3SessionRecord`
- `P3ResendRecord`
- `P3NetworkSettingsRecord`
- `P3Tor0012ObservedRecord`
- `P3TimelineRecord`
- `P3SettingsRecord`
- `P3SignalsRecord`
- `P3GpsInfoRecord`
- `P3FirstContactRecord`

### Fallback

- `P3UnknownRecord` — für jeden nicht erkannten oder nicht vollständig parsebaren Frame

### Gemeinsame Basisfelder (`P3BaseRecord`)

Jeder Record enthält unabhängig vom TOR:

| Feld | Beschreibung |
|---|---|
| `header` | Vollständiger Frame-Header (version, flags, tor, crc, …) |
| `crcValid` | Ob der Header-CRC mit dem berechneten CRC übereinstimmt |
| `computedCrc` | Tatsächlich berechneter CRC |
| `rawFrameHex` | Escaped Frame-Bytes exakt wie empfangen |
| `frameHex` | De-escapte Frame-Bytes |
| `bodyHex` | Body-Bytes zwischen TOR und END |
| `tlvs` | Alle extrahierten TLV-Felder |
| `unknownFields` | TLVs, die keiner bekannten Eigenschaft zugeordnet wurden |
| `parseError?` | Gesetzt wenn strict-Parsing fehlschlug und Best-Effort-Recovery verwendet wurde |

Damit bleibt jeder Frame forensisch nachvollziehbar.

---

## Inhaltliche Entscheidungen

### Little Endian

Mehrbytige numerische Werte werden im Pascal-Code little endian gelesen. Diese Implementierung macht das genauso.

### Decoder-ID

Im Pascal-Code wird die Decoder-ID bei mehreren TORs in umgekehrter Byte-Reihenfolge als `AA-BB-CC-DD` ausgegeben. Dieses Verhalten wird für `PASSING`, `STATUS`, `GET_TIME`, `SESSION` und `RESEND` reproduziert.

Bei `VERSION_DECODER` liest der Pascal-Code die Bytes in **ursprünglicher Reihenfolge**. Auch das wird hier genauso abgebildet.

### ProChip/FlexChip-Transponder

Der Pascal-Code baut den Transponderwert aus Feld `0x0A` durch byteweise Umkehr und ASCII-Dekodierung. Das wird direkt reproduziert.

### Zeitstempel

Felder `RTC_TIME (0x04)` und `UTC_TIME (0x10)` werden als Mikrosekunden seit `1970-01-01T00:00:00Z` interpretiert (direkt aus `DecodePassingTime` übernommen).

### Observed Field 0x83 (`observedField131`)

In den TORs `PASSING`, `GET_TIME`, `SESSION` und `RESEND` wird Feld `0x83` als `observedField131` ausgegeben.

Aktuelle Interpretation ist bewusst minimal:
- little-endian unsigned Zahl
- keine feste fachliche Bedeutung bis belastbare Quellen vorliegen
- bei allen anderen TORs bleibt das Feld in `unknownFields`

### NETWORK_SETTINGS (0x0016): belegte Feldinterpretation

Aus beobachteten Discovery-Antworten werden folgende Felder semantisch gemappt:

| Field-ID | Eigenschaft |
|---|---|
| `0x08` | `ipAddress` |
| `0x09` | `netmask` |
| `0x0A` | `defaultGateway` |
| `0x05` | `dnsServer` (häufig `0.0.0.0` wenn nicht konfiguriert) |

Nicht belegte Felder bleiben in `unknownFields`.

---

## Grenzen dieser Implementierung

Bewusst nicht umgesetzt:

- `SIGNALS (0x002D)` semantisch dekodieren
- STATUS-Felder typisieren, die im Pascal-Code zwar als Konstanten existieren, aber nicht wirklich geparst werden
- Header-Längenfelder über strengere Plausibilitätsregeln validieren, die im Quellcode nicht belegt sind

---

## Outbound Request Builder

Builder für belegte Discovery- und Query-Frames. Alle Requests liefern sowohl `frame` (de-escaped, für CRC-Analyse) als auch `escapedFrame` (wire-ready) plus Hex-Ausgabe für Logging.

### UDP Broadcast Discovery

```ts
import { buildUdpBroadcastDiscoveryRequest25Byte, toNodeBuffer } from "@raceoffice/p3parser";
import dgram from "node:dgram";

const socket = dgram.createSocket("udp4");
socket.bind(0, () => {
  socket.setBroadcast(true);
  socket.send(
    toNodeBuffer(buildUdpBroadcastDiscoveryRequest25Byte()),
    5403,
    "255.255.255.255",
  );
});
```

Verfügbare Discovery-Requests:

| Funktion | Beschreibung |
|---|---|
| `buildUdpBroadcastDiscoveryRequest25Byte()` | Standard (aus Pascal `GetDecoderSearchPhrase`) |
| `buildUdpBroadcastDiscoveryRequest32ByteObserved()` | 32-Byte-Variante aus Feldnotizen |
| `buildUdpBroadcastDiscoveryRequest23ByteObserved()` | 23-Byte-Variante aus Feldnotizen |
| `buildUdpBroadcastDiscoveryRequest21ByteObserved()` | 21-Byte-Variante aus Feldnotizen |
| `buildDecoderSearchSmartDecoderBugRequest()` | SmartDecoder-Workaround |
| `buildDecoderSearchRequest()` | Alias auf 25-Byte-Variante (Rückwärtskompatibilität) |

### Direkte Decoder-Queries

```ts
import net from "node:net";
import { buildGetTimeRequest, buildSessionRequest, buildResendRequest, toNodeBuffer } from "@raceoffice/p3parser";

const socket = net.createConnection({ host: "192.168.0.10", port: 5403 }, () => {
  socket.write(toNodeBuffer(buildGetTimeRequest()));
  socket.write(toNodeBuffer(buildSessionRequest("40-24-04-00")));
  socket.write(toNodeBuffer(buildResendRequest(100, 120, "40-24-04-00")));
});
```

| Funktion | Beschreibung |
|---|---|
| `buildGetTimeRequest()` | RTC-Zeitabfrage (aus Pascal `GetRtcPhrase`) |
| `buildSessionRequest(decoderId)` | Session-Info-Abfrage (aus Pascal `GetSessionPhrase`) |
| `buildResendRequest(from, to, decoderId)` | Passings in Nummernbereich anfordern (aus Pascal `GetResendPhrase`) |

### Analysierbarkeit

Jeder Request ist direkt loggbar:

```ts
const req = buildResendRequest(100, 120, "40-24-04-00");
console.log(req.name);            // "resend"
console.log(req.torName);         // "RESEND"
console.log(req.usageScenario);   // "direct-decoder-query"
console.log(req.frameHex);        // de-escaped frame als Hex
console.log(req.escapedFrameHex); // wire-ready als Hex
```
