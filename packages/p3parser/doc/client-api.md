# P3 Client API

Die Client API kapselt das P3-Protokoll vollständig. Anwendungscode importiert nur saubere Domain-Typen und arbeitet niemals direkt mit P3-Wire-Typen, Frame-Strukturen oder TLV-Feldern.

## Architektur

```
P3DecoderPool           ← Multi-Decoder, Track-Setup, Livetracking
  └── P3DecoderConnection  ← Einzelverbindung, Test-Client
        └── P3StreamDecoder + P3Parser  ← Wire-Protokoll-Stack (intern)
```

`P3DecoderDiscovery` läuft unabhängig davon (UDP) und liefert `DecoderConfig`-Werte,
die direkt an `P3DecoderConnection` oder `P3DecoderPool` übergeben werden können.

---

## Typen

### `DecoderConfig`

Adresse und optionales Label eines Decoders.

```ts
type DecoderConfig = {
  ip: string;
  port?: number;   // Default: 5403
  label?: string;  // z.B. "Start", "Ziel", "Sektor 1"
};
```

`label` wird vom Client nicht interpretiert, aber in allen Pool-Callbacks als `source`-Parameter mitgegeben.

### `ConnectionState`

```ts
type ConnectionState = "disconnected" | "connecting" | "connected";
```

### `PassingEvent`

Transponder-Erkennung von einem verbundenen Decoder.

```ts
type PassingEvent = {
  passingNumber: number;
  /** Numerischer String für Tranx ("12345"), formatiert für ProChip ("AA-12345"). */
  transponderId: string;
  transponderType: "tranx" | "prochip";
  time: Date;
  timeSource: "rtc" | "utc";
  signalStrength: number;
  hits: number;
  lowBattery: boolean;
  /** Identifiziert den Decoder, der dieses Passing geliefert hat. */
  decoderId: string;
};
```

### `DecoderStatusEvent`

Periodischer Gesundheitsstatus vom Decoder.

```ts
type DecoderStatusEvent = {
  noise: number;
  gpsLocked: boolean;
  temperature: number;
  voltage: number;
  decoderId: string;
};
```

### `DecoderInfoEvent`

Decoder-Identifikation (gesendet beim Verbindungsaufbau).

```ts
type DecoderInfoEvent = {
  decoderType: string;
  firmwareVersion: string;
  decoderId: string;
};
```

### `DiscoveredDecoder`

Ergebnis einer UDP-Broadcast-Discovery.

```ts
type DiscoveredDecoder = {
  ip: string;
  port: number;
  decoderId: string;
  decoderType: string;
  firmwareVersion: string;
};
```

---

## `P3DecoderDiscovery`

Findet P3-Decoder im lokalen Netz via UDP-Broadcast. Kapselt den Discovery-Handshake vollständig (mehrere Request-Varianten, Antwort-Akkumulation pro Source-IP).

### Konstruktor

```ts
new P3DecoderDiscovery(callbacks: DiscoveryCallbacks, options?: DiscoveryOptions)
```

```ts
type DiscoveryCallbacks = {
  onDiscovered: (decoder: DiscoveredDecoder) => void;
  onError?: (error: Error) => void;
};

type DiscoveryOptions = {
  port?: number;             // Default: 5403
  broadcastAddress?: string; // Default: "255.255.255.255"
};
```

### Methoden

| Methode | Beschreibung |
|---|---|
| `start()` | Startet UDP-Socket, sendet Broadcasts, ruft `onDiscovered` für jeden gefundenen Decoder |
| `stop()` | Schließt UDP-Socket, räumt internen Zustand auf |
| `static scan(timeoutMs?)` | One-Shot: wartet `timeoutMs` ms (Default: 3000), gibt alle gefundenen Decoder zurück |

### Beispiel: Manuell

```ts
import { P3DecoderDiscovery } from "@raceoffice/p3parser";

const discovery = new P3DecoderDiscovery({
  onDiscovered: (decoder) => {
    console.log(`Decoder gefunden: ${decoder.ip} (${decoder.decoderType})`);
  },
});

discovery.start();
// ... irgendwann:
discovery.stop();
```

### Beispiel: One-Shot Scan

```ts
import { P3DecoderDiscovery } from "@raceoffice/p3parser";

const decoders = await P3DecoderDiscovery.scan(3000);
console.log(`${decoders.length} Decoder gefunden`);
```

---

## `P3DecoderConnection`

Einzelne TCP-Verbindung zu einem P3-Decoder. Empfohlen für den P3-Test-Client oder wenn volle Kontrolle über eine einzelne Verbindung benötigt wird.

### Konstruktor

```ts
new P3DecoderConnection(
  config: DecoderConfig,
  callbacks: DecoderConnectionCallbacks,
  options?: ConnectionOptions
)
```

```ts
type DecoderConnectionCallbacks = {
  /** Wird aufgerufen, wenn der Decoder sich mit VERSION_DECODER identifiziert hat. */
  onConnected: (info: DecoderInfoEvent) => void;
  onDisconnected: (reason: string) => void;
  onPassing: (event: PassingEvent) => void;
  onStatus: (event: DecoderStatusEvent) => void;
  onError: (error: Error) => void;
  /** Escape-Hatch: direkter Zugriff auf jeden geparsten P3-Record vor der Übersetzung. */
  onRawRecord?: (record: P3Record) => void;
};

type ConnectionOptions = {
  autoReconnect?: boolean;      // Default: true
  reconnectDelayMs?: number;    // Default: 3000
};
```

### Eigenschaften

| Eigenschaft | Typ | Beschreibung |
|---|---|---|
| `state` | `ConnectionState` | Aktueller Verbindungsstatus |
| `decoderId` | `string \| null` | Gesetzt sobald `VERSION_DECODER` empfangen wurde |

### Methoden

| Methode | Beschreibung |
|---|---|
| `connect()` | Stellt Verbindung her, gibt `Promise<void>` zurück (löst auf sobald verbunden oder Fehler) |
| `disconnect()` | Trennt Verbindung, deaktiviert Auto-Reconnect |
| `requestTime()` | Fragt aktuelle Decoder-Zeit ab |
| `requestSession(decoderId)` | Fragt Session-Info ab (letzter Passing-Index) |
| `requestPassings(decoderId, from, to)` | Fordert Passings in einem Nummernbereich an |

### Beispiel: P3-Test-Client

```ts
import { P3DecoderConnection } from "@raceoffice/p3parser";

const conn = new P3DecoderConnection(
  { ip: "192.168.1.100", label: "Test-Decoder" },
  {
    onConnected: (info) => {
      console.log(`Verbunden: ${info.decoderType} (${info.firmwareVersion})`);
      conn.requestTime();
      conn.requestSession(info.decoderId);
    },
    onDisconnected: (reason) => console.log("Getrennt:", reason),
    onPassing: (e) => console.log(`Passing #${e.passingNumber}: ${e.transponderId}`),
    onStatus: (e) => console.log(`Status: ${e.noise} noise, GPS: ${e.gpsLocked}`),
    onError: (err) => console.error("Fehler:", err),
    onRawRecord: (r) => console.debug("Raw:", r.torName, r.bodyHex),
  },
  { autoReconnect: false },
);

await conn.connect();
```

---

## `P3DecoderPool`

Verwaltet mehrere `P3DecoderConnection`-Instanzen als einheitliches Track-Setup.  
Alle Passings aus allen angeschlossenen Decodern kommen über einen einzigen `onPassing`-Callback. Das `decoderId`-Feld im `PassingEvent` identifiziert immer den Quell-Decoder.

### Konstruktor

```ts
new P3DecoderPool(
  decoders: DecoderConfig[],
  callbacks: DecoderPoolCallbacks,
  options?: PoolOptions
)
```

```ts
type DecoderPoolCallbacks = {
  /** Einheitlicher Passing-Stream aller Decoder. decoderId im Event identifiziert die Quelle. */
  onPassing: (event: PassingEvent) => void;
  onStatus: (event: DecoderStatusEvent, source: DecoderConfig) => void;
  onDecoderConnected: (info: DecoderInfoEvent, source: DecoderConfig) => void;
  onDecoderDisconnected: (source: DecoderConfig, reason: string) => void;
  onError: (error: Error, source: DecoderConfig) => void;
  /** Escape-Hatch für alle Decoder. */
  onRawRecord?: (record: P3Record, source: DecoderConfig) => void;
};

type PoolOptions = {
  autoReconnect?: boolean;    // Default: true
  reconnectDelayMs?: number;  // Default: 3000
};
```

### Eigenschaften

| Eigenschaft | Typ | Beschreibung |
|---|---|---|
| `connections` | `PoolDecoderState[]` | Aktueller Zustandssnapshot aller konfigurierten Decoder |

```ts
type PoolDecoderState = {
  config: DecoderConfig;
  decoderId: string | null;   // null bis VERSION_DECODER empfangen
  state: ConnectionState;
  lastError?: string;
};
```

### Methoden

| Methode | Beschreibung |
|---|---|
| `connect()` | Verbindet alle Decoder parallel, gibt `Promise<void>` zurück |
| `disconnect()` | Trennt alle Decoder |
| `requestPassings(ip, from, to)` | Sendet Resend-Anfrage an einen Decoder (identifiziert per IP) |
| `requestSession(ip)` | Fragt Session-Info von einem Decoder ab |

### Beispiel: Livetracking Track-Setup

```ts
import { P3DecoderPool } from "@raceoffice/p3parser";

const pool = new P3DecoderPool(
  [
    { ip: "192.168.1.100", label: "Start" },
    { ip: "192.168.1.101", label: "Ziel" },
    { ip: "192.168.1.102", label: "Sektor 1" },
  ],
  {
    onPassing: (event) => {
      // event.decoderId zeigt, welcher Decoder das Passing gemeldet hat
      timingEngine.recordPassing(event);
    },
    onDecoderConnected: (info, src) => {
      console.log(`${src.label} verbunden (${info.decoderType})`);
    },
    onDecoderDisconnected: (src, reason) => {
      console.warn(`${src.label} getrennt: ${reason}`);
    },
    onStatus: (event, src) => {
      updateDecoderHealth(src.label, event);
    },
    onError: (err, src) => {
      console.error(`${src.label} Fehler:`, err);
    },
  },
);

await pool.connect();
```

### Beispiel: Discovery + Pool kombiniert

```ts
import { P3DecoderDiscovery, P3DecoderPool } from "@raceoffice/p3parser";

const found = await P3DecoderDiscovery.scan(3000);

const pool = new P3DecoderPool(
  found.map((d) => ({ ip: d.ip, port: d.port })),
  {
    onPassing: (event) => handlePassing(event),
    onDecoderConnected: (info, src) => console.log(`${src.ip} bereit`),
    onDecoderDisconnected: (src, reason) => console.warn(`${src.ip}: ${reason}`),
    onError: (err, src) => console.error(src.ip, err),
    onStatus: () => {},
  },
);

await pool.connect();
```

---

## Escape-Hatch: Low-Level API

Wer direkten Zugriff auf den P3-Protokoll-Stack benötigt, kann ihn direkt importieren:

```ts
import {
  P3Parser,
  P3StreamDecoder,
  buildResendRequest,
  buildGetTimeRequest,
  type P3Record,
  type P3PassingRecord,
} from "@raceoffice/p3parser";
```

Dokumentation dazu im [Haupt-README](../README.md).
