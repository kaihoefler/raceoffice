# P3 Protocol Parser for TypeScript

TypeScript-Implementierung des MYLAPS-P3-Protokolls für Node.js.  
Das Protokoll wird **nur so weit abgebildet, wie es durch das bereitgestellte Pascal-Programm belegt ist**.

## Zwei API-Ebenen

| Ebene | Klassen / Typen | Für wen |
|---|---|---|
| **Client API** (empfohlen) | `P3DecoderDiscovery`, `P3DecoderConnection`, `P3DecoderPool` | Anwendungscode, Livetracking, Test-Clients |
| **Low-Level API** | `P3Parser`, `P3StreamDecoder`, `buildResendRequest`, … | Debugging, Protokollanalyse, Power-User |

Die Client API kapselt das P3-Protokoll vollständig. Anwendungscode arbeitet mit sauberen Domain-Typen (`PassingEvent`, `DecoderStatusEvent`, …) ohne direkte Abhängigkeit auf P3-Wire-Typen.

## Dokumentation

- **[Client API](doc/client-api.md)** — `P3DecoderDiscovery`, `P3DecoderConnection`, `P3DecoderPool`, alle Event-Typen und Beispiele
- **[Low-Level API](doc/low-level-api.md)** — `P3Parser`, `P3StreamDecoder`, Request-Builder, Wire-Protokoll-Details, Implementierungsentscheidungen

## Installation

```bash
npm install
npm run build
npm run test
```

## Dateien

```
src/
  clientTypes.ts          Saubere Public-API-Typen (Client-Ebene)
  P3DecoderConnection.ts  Einzelne TCP-Verbindung mit Auto-Reconnect
  P3DecoderDiscovery.ts   UDP-Broadcast-Discovery
  P3DecoderPool.ts        Multi-Decoder-Pool für Track-Setups
  types.ts                P3-Wire-Protokoll-Typen
  parser.ts               Einzelnachrichten-Parser
  stream.ts               Stream-Decoder für TCP
  builder.ts              Outbound-Request-Builder
  index.ts                Exports beider API-Ebenen

doc/
  client-api.md           Client API Dokumentation
  low-level-api.md        Low-Level API Dokumentation

examples/
  live-client.ts          Low-Level TCP-Beispiel (direkter Parser-Zugriff)
```

## Nächste sinnvolle Ausbaustufen

1. Logger/CLI zur Rohdatenanalyse
2. Golden-Testfälle aus echten Decoder-Frames
