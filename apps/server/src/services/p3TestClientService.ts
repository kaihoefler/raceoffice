import net, { type Socket } from "node:net";
import {
  P3Parser,
  P3StreamDecoder,
  buildDecoderSearchRequest,
  buildDecoderSearchSmartDecoderBugRequest,
  buildGetTimeRequest,
  buildResendRequest,
  buildSessionRequest,
  toNodeBuffer,
  type P3BuiltRequest,
  type P3Record,
  type P3TlvField,
} from "@raceoffice/p3parser";

/**
 * Minimal logger contract so service internals stay framework-agnostic.
 */
type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
};

/**
 * Outbound request kinds that are explicitly evidenced by the Pascal source
 * and the parser package README.
 */
export type P3TestRequestKind =
  | "decoder-search"
  | "decoder-search-smartdecoder-bug"
  | "get-time"
  | "session"
  | "resend";

/**
 * UI-facing service state. Kept intentionally explicit so frontend can visualize
 * connection lifecycle, stream buffering and transport errors without guessing.
 */
export type P3TestClientState = {
  connection: {
    status: "disconnected" | "connecting" | "connected" | "error";
    host: string | null;
    port: number | null;
    connectedAt: string | null;
    disconnectedAt: string | null;
    lastError: string | null;
  };
  transport: {
    bytesReceived: number;
    bytesSent: number;
    bufferedHex: string;
  };
  history: {
    nextEventId: number;
    events: P3TestEvent[];
  };
};

/**
 * Event stream item surfaced to the frontend.
 *
 * Design rule:
 * - known/unknown protocol records are serialized in a lossless-but-JSON-safe way
 * - socket and command lifecycle events are included to support troubleshooting
 */
export type P3TestEvent = {
  id: number;
  ts: string;
  kind: "record" | "request" | "socket" | "warning";
  payload: unknown;
};

function nowIso(): string {
  return new Date().toISOString();
}

function toHexPreview(bytes: Uint8Array, maxChars = 160): string {
  const full = Buffer.from(bytes).toString("hex").toUpperCase();
  if (full.length <= maxChars) return full;
  return `${full.slice(0, maxChars)}…`;
}

function appendBounded<T>(items: T[], item: T, max: number): T[] {
  const next = [...items, item];
  return next.length > max ? next.slice(next.length - max) : next;
}

function readBigUIntBe(bytes: Uint8Array): bigint {
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) | BigInt(byte);
  }
  return result;
}

function isPrintableAscii(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  return [...bytes].every((b) => b >= 0x20 && b <= 0x7e);
}

function toIso(valueMs: number): string | null {
  if (!Number.isFinite(valueMs)) return null;
  const d = new Date(valueMs);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function tlvToJson(tlv: P3TlvField) {
  const raw = tlv.raw;
  const reversed = Uint8Array.from([...raw].reverse());

  const heuristics: Record<string, unknown> = {
    rawLength: raw.length,
  };

  if (isPrintableAscii(raw)) {
    heuristics.ascii = Buffer.from(raw).toString("ascii");
  }

  if (isPrintableAscii(reversed)) {
    heuristics.reversedAscii = Buffer.from(reversed).toString("ascii");
  }

  if (raw.length <= 8) {
    const unsignedLe = Number(BigInt(`0x${tlv.reversedHex || "0"}`));
    const unsignedBe = Number(BigInt(`0x${tlv.rawHex || "0"}`));

    if (Number.isFinite(unsignedLe)) heuristics.unsignedLe = unsignedLe;
    if (Number.isFinite(unsignedBe)) heuristics.unsignedBe = unsignedBe;

    if (raw.length === 4) {
      heuristics.unixSecondsLe = toIso(unsignedLe * 1000);
      heuristics.unixSecondsBe = toIso(unsignedBe * 1000);
      heuristics.unixMillisecondsLe = toIso(unsignedLe);
      heuristics.unixMillisecondsBe = toIso(unsignedBe);
    }
  }

  if (raw.length === 8) {
    heuristics.u64Le = BigInt(`0x${tlv.reversedHex || "0"}`).toString(10);
    heuristics.u64Be = readBigUIntBe(raw).toString(10);
  }

  return {
    type: tlv.type,
    length: tlv.length,
    rawHex: tlv.rawHex,
    reversedHex: tlv.reversedHex,
    heuristics,
  };
}

/**
 * Defensive server-side unknown-field extraction.
 *
 * Why not trust `record.unknownFields` directly?
 * - We want diagnostics to remain stable even while parser internals evolve.
 * - The UI should only show TLVs that are not mapped into typed properties.
 */
function knownTlvTypesForRecord(record: P3Record): Set<number> {
  switch (record.kind) {
    case "passing":
      return new Set([0x01, 0x03, 0x04, 0x05, 0x06, 0x08, 0x0a, 0x10, 0x14, 0x81]);
    case "status":
      return new Set([0x01, 0x06, 0x07, 0x0c, 0x81]);
    case "version-decoder":
      return new Set([0x02, 0x03, 0x81]);
    case "get-time":
      return new Set([0x01, 0x81]);
    case "session":
      return new Set([0x04, 0x81, 0x85]);
    case "resend":
      return new Set([0x01, 0x02, 0x81]);
    case "unknown":
    default:
      return new Set();
  }
}

function deriveUnknownFields(record: P3Record): P3TlvField[] {
  const known = knownTlvTypesForRecord(record);
  if (known.size === 0) return [...record.tlvs];
  return record.tlvs.filter((tlv) => !known.has(tlv.type));
}

/**
 * Converts parser records to transport-safe JSON while preserving all evidentiary
 * protocol data exposed by `@raceoffice/p3parser`.
 */
function toSerializableRecord(record: P3Record) {
  const unknownFields = deriveUnknownFields(record);

  const base = {
    kind: record.kind,
    tor: record.tor,
    torName: record.torName,
    header: record.header,
    crcValid: record.crcValid,
    computedCrc: record.computedCrc,
    bodyHex: record.bodyHex,
    rawFrameHex: record.rawFrameHex,
    frameHex: record.frameHex,
    tlvs: record.tlvs.map(tlvToJson),
    unknownFields: unknownFields.map(tlvToJson),
    parseError: record.parseError ?? null,
  };

  switch (record.kind) {
    case "passing":
      return {
        ...base,
        passingNumber: record.passingNumber ?? null,
        transponderId: record.transponderId ?? null,
        transponderType: record.transponderType ?? null,
        passingTime: record.passingTime ? record.passingTime.toISOString() : null,
        passingTimeSource: record.passingTimeSource ?? null,
        signalStrength: record.signalStrength ?? null,
        hits: record.hits ?? null,
        sport: record.sport ?? null,
        decoderId: record.decoderId ?? null,
        lowBatteryWarning: record.lowBatteryWarning ?? null,
      };

    case "status":
      return {
        ...base,
        noise: record.noise ?? null,
        gps: record.gps ?? null,
        temperature: record.temperature ?? null,
        inputVoltage: record.inputVoltage ?? null,
        decoderId: record.decoderId ?? null,
      };

    case "version-decoder":
      return {
        ...base,
        firmwareVersion: record.firmwareVersion ?? null,
        decoderType: record.decoderType ?? null,
        decoderId: record.decoderId ?? null,
      };

    case "get-time":
      return {
        ...base,
        currentDecoderTime: record.currentDecoderTime ? record.currentDecoderTime.toISOString() : null,
        decoderId: record.decoderId ?? null,
      };

    case "session":
      return {
        ...base,
        lastPassingIndex: record.lastPassingIndex ?? null,
        decoderId: record.decoderId ?? null,
        requestId: record.requestId ?? null,
      };

    case "resend":
      return {
        ...base,
        fromPassingNumber: record.fromPassingNumber ?? null,
        toPassingNumber: record.toPassingNumber ?? null,
        decoderId: record.decoderId ?? null,
      };

    case "unknown":
    default:
      return base;
  }
}

export class P3TestClientService {
  private readonly parser = new P3Parser({ strict: true, rejectOnCrcMismatch: false });
  private readonly stream = new P3StreamDecoder(this.parser);
  private socket: Socket | null = null;

  private state: P3TestClientState = {
    connection: {
      status: "disconnected",
      host: null,
      port: null,
      connectedAt: null,
      disconnectedAt: null,
      lastError: null,
    },
    transport: {
      bytesReceived: 0,
      bytesSent: 0,
      bufferedHex: "",
    },
    history: {
      nextEventId: 1,
      events: [],
    },
  };

  constructor(private readonly logger: Logger) {}

  getState(): P3TestClientState {
    return structuredClone(this.state);
  }

  clearHistory() {
    this.state = {
      ...this.state,
      history: {
        ...this.state.history,
        events: [],
      },
    };
  }

  connect(host: string, port: number) {
    const safeHost = String(host ?? "").trim();
    const safePort = Number(port);

    if (!safeHost) {
      return { ok: false, message: "Host is required." };
    }

    if (!Number.isInteger(safePort) || safePort < 1 || safePort > 65535) {
      return { ok: false, message: "Port must be an integer between 1 and 65535." };
    }

    if (this.socket) {
      this.disconnect("connect requested while previous socket was active");
    }

    this.stream.reset();
    this.state = {
      ...this.state,
      connection: {
        status: "connecting",
        host: safeHost,
        port: safePort,
        connectedAt: null,
        disconnectedAt: this.state.connection.disconnectedAt,
        lastError: null,
      },
      transport: {
        ...this.state.transport,
        bufferedHex: "",
      },
    };

    this.pushEvent("socket", {
      action: "connect-requested",
      host: safeHost,
      port: safePort,
    });

    this.logger.info(
      {
        scope: "p3-test-client",
        host: safeHost,
        port: safePort,
      },
      "p3 connect requested",
    );

    const socket = net.createConnection({ host: safeHost, port: safePort });
    this.socket = socket;

    socket.on("connect", () => {
      if (this.socket !== socket) return;

      this.state = {
        ...this.state,
        connection: {
          ...this.state.connection,
          status: "connected",
          connectedAt: nowIso(),
          lastError: null,
        },
      };

      this.pushEvent("socket", { action: "connected", host: safeHost, port: safePort });
      this.logger.info(
        {
          scope: "p3-test-client",
          host: safeHost,
          port: safePort,
        },
        "p3 socket connected",
      );
    });

    socket.on("data", (chunk) => {
      if (this.socket !== socket) return;

      const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
      const receivedAt = nowIso();
      const result = this.stream.push(bytes);

      this.logger.info(
        {
          scope: "p3-test-client",
          receivedAt,
          bytes: bytes.length,
          chunkHexPreview: toHexPreview(bytes),
          parsedRecords: result.records.length,
          bufferedHexTail: result.bufferedHex,
        },
        "p3 socket data received",
      );

      this.state = {
        ...this.state,
        transport: {
          ...this.state.transport,
          bytesReceived: this.state.transport.bytesReceived + bytes.length,
          bufferedHex: result.bufferedHex,
        },
      };

      for (const record of result.records) {
        this.pushEvent("record", {
          receivedAt,
          record: toSerializableRecord(record),
        });

        this.logger.info(
          {
            scope: "p3-test-client",
            kind: record.kind,
            tor: record.tor,
            torName: record.torName,
            crcValid: record.crcValid,
            parseError: record.parseError ?? null,
          },
          "p3 record parsed",
        );
      }
    });

    socket.on("error", (error) => {
      if (this.socket !== socket) return;

      const message = error instanceof Error ? error.message : "Socket error";
      this.state = {
        ...this.state,
        connection: {
          ...this.state.connection,
          status: "error",
          lastError: message,
        },
      };

      this.logger.warn({ scope: "p3-test-client", error: message }, "p3 socket error");
      this.pushEvent("warning", { action: "socket-error", message });
    });

    socket.on("close", () => {
      if (this.socket !== socket) return;

      this.socket = null;
      this.state = {
        ...this.state,
        connection: {
          ...this.state.connection,
          status: "disconnected",
          disconnectedAt: nowIso(),
        },
      };

      this.pushEvent("socket", { action: "disconnected" });
      this.logger.info({ scope: "p3-test-client" }, "p3 socket closed");
    });

    return { ok: true, message: `Connecting to ${safeHost}:${String(safePort)}` };
  }

  disconnect(reason = "disconnect requested") {
    if (!this.socket) {
      this.state = {
        ...this.state,
        connection: {
          ...this.state.connection,
          status: "disconnected",
          disconnectedAt: nowIso(),
        },
      };
      this.logger.info({ scope: "p3-test-client", reason }, "p3 disconnect requested (already disconnected)");
      return { ok: true, message: "Already disconnected." };
    }

    const socket = this.socket;
    this.socket = null;

    socket.end();
    socket.destroy();

    this.state = {
      ...this.state,
      connection: {
        ...this.state.connection,
        status: "disconnected",
        disconnectedAt: nowIso(),
      },
    };

    this.pushEvent("socket", { action: "disconnect", reason });
    this.logger.info({ scope: "p3-test-client", reason }, "p3 disconnect requested");
    return { ok: true, message: "Disconnected." };
  }

  sendRequest(input: {
    kind: P3TestRequestKind;
    decoderId?: string;
    fromPassingNumber?: number;
    toPassingNumber?: number;
  }) {
    if (!this.socket || this.socket.readyState !== "open") {
      return { ok: false, message: "Socket is not connected." };
    }

    const request = this.buildRequest(input);
    if (!request) {
      return { ok: false, message: "Invalid request payload for selected request kind." };
    }

    this.socket.write(toNodeBuffer(request));

    this.state = {
      ...this.state,
      transport: {
        ...this.state.transport,
        bytesSent: this.state.transport.bytesSent + request.escapedFrame.length,
      },
    };

    this.pushEvent("request", {
      kind: input.kind,
      request: {
        name: request.name,
        tor: request.tor,
        torName: request.torName,
        frameHex: request.frameHex,
        escapedFrameHex: request.escapedFrameHex,
        notes: request.notes ?? null,
      },
    });

    this.logger.info(
      {
        scope: "p3-test-client",
        request: request.name,
        tor: request.torName,
        bytes: request.escapedFrame.length,
      },
      "p3 request sent",
    );

    return { ok: true, message: `${request.name} sent.` };
  }

  private buildRequest(input: {
    kind: P3TestRequestKind;
    decoderId?: string;
    fromPassingNumber?: number;
    toPassingNumber?: number;
  }): P3BuiltRequest | null {
    switch (input.kind) {
      case "decoder-search":
        return buildDecoderSearchRequest();
      case "decoder-search-smartdecoder-bug":
        return buildDecoderSearchSmartDecoderBugRequest();
      case "get-time":
        return buildGetTimeRequest();
      case "session":
        return input.decoderId ? buildSessionRequest(input.decoderId) : null;
      case "resend": {
        const fromPassingNumber = input.fromPassingNumber;
        const toPassingNumber = input.toPassingNumber;

        if (
          input.decoderId === undefined ||
          fromPassingNumber === undefined ||
          toPassingNumber === undefined ||
          !Number.isInteger(fromPassingNumber) ||
          !Number.isInteger(toPassingNumber)
        ) {
          return null;
        }

        return buildResendRequest(fromPassingNumber, toPassingNumber, input.decoderId);
      }
      default:
        return null;
    }
  }

  private pushEvent(kind: P3TestEvent["kind"], payload: unknown) {
    const event: P3TestEvent = {
      id: this.state.history.nextEventId,
      ts: nowIso(),
      kind,
      payload,
    };

    this.state = {
      ...this.state,
      history: {
        nextEventId: this.state.history.nextEventId + 1,
        events: appendBounded(this.state.history.events, event, 400),
      },
    };
  }
}
