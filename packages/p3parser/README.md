# P3 Protocol Parser for TypeScript

Diese Implementierung bildet das MYLAPS-P3-Protokoll **nur so weit ab, wie es durch das bereitgestellte Pascal-Programm belegt ist**.

Ziel:

- P3-Nachrichten aus einem TCP-Datenstrom einlesen
- Frames sauber de-escapen und per CRC prüfen
- bekannte Nachrichtentypen typisiert zurückgeben
- unbekannte oder noch nicht sicher interpretierbare Teile **nicht verlieren**, sondern als strukturierte Raw-Daten ausgeben

## Was sicher implementiert ist

Diese TORs werden typisiert umgesetzt:

- `0x0001` PASSING
- `0x0002` STATUS
- `0x0003` VERSION_DECODER
- `0x0004` RESEND
- `0x0012` (observed UDP discovery response)
- `0x0013` SETTINGS (SERVER_SETTINGS)
- `0x0015` SESSION
- `0x0016` NETWORK_SETTINGS (observed UDP discovery response)
- `0x0024` GET_TIME
- `0x0028` SETTINGS (GENERAL_SETTINGS)
- `0x002D` SIGNALS
- `0x0030` GPS_INFO
- `0x0045` FIRST_CONTACT
- `0x004A` TIMELINE (observed UDP discovery response)


Nicht typisiert bleiben weiterhin TORs/Felder ohne belastbare Evidenz. Diese werden als `kind: "unknown"` bzw. über `unknownFields` erhalten.



## Architektur

Es gibt drei Ebenen:

### 1. `P3Parser`

Parst genau **eine** vollständige P3-Nachricht.

- de-escaping
- Header lesen
- CRC berechnen
- TLVs extrahieren
- bekannten TOR dekodieren
- unbekannte Felder in `unknownFields` belassen

### 2. `P3StreamDecoder`

Nimmt beliebige TCP-Bytes entgegen und extrahiert daraus einzelne Frames.

Damit kannst du direkt `socket.on("data", ...)` verarbeiten.

### 3. Live-Beispiel

`examples/live-client.ts` zeigt:

- TCP-Verbindung zum Decoder
- Einspeisen von Socket-Chunks in den Stream-Decoder
- Ausgabe von bekannten und unbekannten Feldern
- Senden zweier rekonstruierten Beispielanfragen aus dem Pascal-Code

## Installation

```bash
npm install
npm run check
npm run build
npm run test
```


## Kurzes Beispiel

```ts
import { P3Parser } from "./src/index.js";

const parser = new P3Parser();

const record = parser.parseRecord(
  "8E0228002DA5000002000102000007021B000C016D0601010A01038104521504008304A40203008F",
);

console.dir(record, { depth: null });
```

Für die Beispielnachricht erhältst du einen `status`-Record.

Wichtig:

- `0x83` wird bei `PASSING`, `GET_TIME`, `SESSION` und `RESEND` als beobachtetes Feld `observedField131` (little-endian unsigned number) bereitgestellt; die fachliche Semantik bleibt bewusst offen
- `0x0A` bei STATUS wird ebenfalls nicht fest in eine Eigenschaft gegossen, obwohl der Pascal-Code dafür `STATUS_SATINUSE` benennt
- bei observed Discovery-/Meta-TORs (`0x0012`, `0x0016`, `0x004A`, `0x0013`, `0x0028`, `0x002D`, `0x0030`, `0x0045`) werden nur belegte Felder gemappt; unklare Semantik bleibt als `unknownFields`
- für `NETWORK_SETTINGS (0x0016)` sind belegte semantische Felder vorhanden: `ipAddress`, `netmask`, `defaultGateway`, `dnsServer`






## Rückgabetypen

### Bekannte Records

- `P3PassingRecord`
- `P3StatusRecord`
- `P3VersionDecoderRecord`
- `P3GetTimeRecord`
- `P3SessionRecord`
- `P3ResendRecord`
- `P3Tor0012ObservedRecord`
- `P3NetworkSettingsRecord`
- `P3TimelineRecord`
- `P3SettingsRecord`
- `P3SignalsRecord`
- `P3GpsInfoRecord`
- `P3FirstContactRecord`




### Unbekannter Record

- `P3UnknownRecord`

Jeder Record enthält außerdem:

- `header`
- `crcValid`
- `computedCrc`
- `rawFrameHex`
- `frameHex`
- `bodyHex`
- `tlvs`
- `unknownFields`

Damit bleibt jeder Frame forensisch nachvollziehbar.

## Wichtige inhaltliche Entscheidungen

### Little Endian

Mehrbyteige numerische Werte werden im Pascal-Code little endian gelesen. Diese Implementierung macht das genauso.

### Decoder-ID

Im Pascal-Code wird die Decoder-ID bei mehreren TORs in umgekehrter Byte-Reihenfolge als `AA-BB-CC-DD` ausgegeben. Diese Implementierung reproduziert genau dieses Verhalten für PASSING, STATUS, GET_TIME, SESSION und RESEND.


Bei `VERSION_DECODER` liest der Pascal-Code die Bytes dagegen **in der ursprünglichen Reihenfolge** aus dem Feld. Auch das wird hier genauso abgebildet.

### ProChip/FlexChip-Transponder

Der Pascal-Code baut den Wert aus Feld `0x0A` durch byteweise Umkehr und ASCII-Dekodierung. Das wird hier direkt reproduziert.

### Zeitstempel

Feld `RTC_TIME (0x04)` und `UTC_TIME (0x10)` werden als Mikrosekunden seit `1970-01-01T00:00:00Z` interpretiert.

Das ist direkt aus `DecodePassingTime` übernommen.

### Observed FIELD_131 (`0x83`)

In den TORs `PASSING`, `GET_TIME`, `SESSION` und `RESEND` wird Feld `0x83` als `observedField131` ausgegeben.

Die aktuelle evidenzbasierte Interpretation ist bewusst minimal:

- little-endian unsigned Zahl (`numericLe`)
- keine feste fachliche Bedeutung, bis belastbare Quellen vorliegen
- bei nicht passenden TORs bleibt das Feld weiterhin in `unknownFields`


### NETWORK_SETTINGS (0x0016): belegte Feldinterpretation

Aus beobachteten Discovery-Antworten werden bei `network-settings` folgende Felder semantisch gemappt:

- `0x08` -> `ipAddress`
- `0x09` -> `netmask`
- `0x0A` -> `defaultGateway`
- `0x05` -> `dnsServer` (häufig `0.0.0.0`, wenn kein DNS konfiguriert ist)

Nicht belegte `NETWORK_SETTINGS`-Felder bleiben weiterhin in `unknownFields` erhalten.



## Live-Nutzung am Socket

```ts
import net from "node:net";
import { P3Parser, P3StreamDecoder } from "./src/index.js";

const parser = new P3Parser();
const decoder = new P3StreamDecoder(parser);

const socket = net.createConnection({ host: "192.168.0.10", port: 5403 });

socket.on("data", (chunk) => {
  const { records } = decoder.push(chunk);
  for (const record of records) {
    console.dir(record, { depth: null });
  }
});
```

## Grenzen dieser Implementierung

Diese Implementierung absichtlich **nicht**:

- SIGNALS semantisch dekodieren
- STATUS-Felder typisieren, die im Pascal-Code zwar als Konstanten existieren, aber nicht wirklich geparst werden
- Header-Längenfelder über strengere Plausibilitätsregeln validieren, die im Quellcode nicht belegt sind


## Outbound Requests / Query-Builder

Es gibt jetzt zusätzlich einen Builder für belegte Discovery-/Query-Frames:

**UDP Broadcast Discovery**
- `buildUdpBroadcastDiscoveryRequest25Byte()`
- `buildUdpBroadcastDiscoveryRequest32ByteObserved()`
- `buildUdpBroadcastDiscoveryRequest23ByteObserved()`
- `buildUdpBroadcastDiscoveryRequest21ByteObserved()`
- `buildDecoderSearchSmartDecoderBugRequest()`
- `buildDecoderSearchRequest()` (Alias auf die 25-Byte-Discovery-Variante, für Rückwärtskompatibilität)

**Direkte Decoder-Queries**
- `buildGetTimeRequest()`
- `buildSessionRequest(decoderId)`
- `buildResendRequest(fromPassingNumber, toPassingNumber, decoderId)`

Wichtig:

- Broadcast-Discovery und direkte Decoder-Queries sind im Builder explizit getrennt (`request.usageScenario`)
- bekannte Wire-Frames aus Pascal/Feldnotizen werden ohne zusätzliche Semantik als stabile Requests bereitgestellt
- `GET_TIME`, `SESSION` und `RESEND` werden als dynamisch berechnete Requests (inkl. CRC) gebaut
- jede Anfrage liefert sowohl `frame` als auch `escapedFrame`, plus Hex-Ausgabe für Logging und Analyse

### Beispiel: UDP Broadcast Discovery

```ts
import dgram from "node:dgram";
import {
  buildUdpBroadcastDiscoveryRequest25Byte,
  buildUdpBroadcastDiscoveryRequest32ByteObserved,
  buildUdpBroadcastDiscoveryRequest23ByteObserved,
  buildUdpBroadcastDiscoveryRequest21ByteObserved,
  toNodeBuffer,
} from "./src/index.js";

const socket = dgram.createSocket("udp4");

socket.bind(5303, () => {
  socket.setBroadcast(true);

  const requests = [
    buildUdpBroadcastDiscoveryRequest25Byte(),
    buildUdpBroadcastDiscoveryRequest32ByteObserved(),
    buildUdpBroadcastDiscoveryRequest23ByteObserved(),
    buildUdpBroadcastDiscoveryRequest21ByteObserved(),
  ];

  for (const request of requests) {
    socket.send(toNodeBuffer(request), 5403, "255.255.255.255");
  }
});
```

### Beispiel: Direkte Decoder-Queries

```ts
import net from "node:net";
import {
  buildGetTimeRequest,
  buildResendRequest,
  buildSessionRequest,
  toNodeBuffer,
} from "./src/index.js";

const socket = net.createConnection({ host: "192.168.0.10", port: 5403 }, () => {
  const rtc = buildGetTimeRequest();
  const session = buildSessionRequest("40-24-04-00");
  const resend = buildResendRequest(100, 120, "40-24-04-00");

  socket.write(toNodeBuffer(rtc));
  socket.write(toNodeBuffer(session));
  socket.write(toNodeBuffer(resend));
});
```


### Analysierbarkeit

Die Builder sind bewusst so gestaltet, dass du jeden gesendeten Request direkt loggen kannst:

- `request.name`
- `request.tor` / `request.torName`
- `request.frameHex`
- `request.escapedFrameHex`
- `request.usageScenario`


Damit bleibt auch die Sendeseite forensisch nachvollziehbar.

## Nächste sinnvolle Ausbaustufen

1. EventEmitter-Wrapper für dauerhafte Live-Verbindungen
2. Logger/CLI zur Rohdatenanalyse
3. Golden-Testfälle aus echten Decoder-Frames

## Dateien

- `src/types.ts` – Typen
- `src/parser.ts` – Einzelnachrichten-Parser
- `src/stream.ts` – Stream-Decoder
- `src/builder.ts` – Outbound-Request-Builder
- `examples/live-client.ts` – TCP-Beispiel
