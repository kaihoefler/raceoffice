import dgram from "node:dgram";
import os from "node:os";

import {
  P3DecoderConnection,
  P3Parser,
  buildDecoderSearchRequest,
  buildDecoderSearchSmartDecoderBugRequest,
  buildGetTimeRequest,
  buildResendRequest,
  buildSessionRequest,
  buildUdpBroadcastDiscoveryRequest21ByteObserved,
  buildUdpBroadcastDiscoveryRequest23ByteObserved,
  buildUdpBroadcastDiscoveryRequest25Byte,
  buildUdpBroadcastDiscoveryRequest32ByteObserved,
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
export type P3DiscoveredDecoder = {
  key: string;
  host: string;
  port: number;
  decoderId: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  responseCount: number;
  torNames: string[];
  lastRecordKind: string;
  decoderType: string | null;
  firmwareVersion: string | null;
  timelineName: string | null;
  networkIps: string[];
};

export type P3DiscoveryState = {
  status: "idle" | "running" | "completed" | "error";
  startedAt: string | null;
  finishedAt: string | null;
  timeoutMs: number;
  lastError: string | null;
  responsesReceived: number;
  decoders: P3DiscoveredDecoder[];
};

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
    bytesSent: number;
  };
  history: {
    nextEventId: number;
    events: P3TestEvent[];
  };
  discovery: P3DiscoveryState;
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
      return new Set([0x01, 0x03, 0x04, 0x05, 0x06, 0x08, 0x0a, 0x10, 0x14, 0x81, 0x83]);

    case "status":
      return new Set([0x01, 0x06, 0x07, 0x0c, 0x81]);

    case "version-decoder":
      return new Set([0x02, 0x03, 0x81, 0x83]);

    case "get-time":
      return new Set([0x01, 0x81, 0x83]);

    case "session":
      return new Set([0x04, 0x81, 0x83, 0x85]);

    case "resend":
      return new Set([0x01, 0x02, 0x81, 0x83]);

    case "network-settings":
      return new Set([0x05, 0x08, 0x09, 0x0a, 0x81, 0x83]);

    case "tor-0012-observed":
      return new Set([0x03, 0x04, 0x05, 0x81, 0x83]);

    case "timeline":
      return new Set([0x01, 0x02, 0x03, 0x04, 0x81, 0x83]);

    case "settings":
    case "signals":
    case "gps-info":
    case "first-contact":
      return new Set([0x81]);

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
        observedField131: record.observedField131 ?? null,
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
        observedField131: record.observedField131 ?? null,
      };

    case "get-time":
      return {
        ...base,
        currentDecoderTime: record.currentDecoderTime ? record.currentDecoderTime.toISOString() : null,
        decoderId: record.decoderId ?? null,
        observedField131: record.observedField131 ?? null,
      };

    case "session":
      return {
        ...base,
        lastPassingIndex: record.lastPassingIndex ?? null,
        decoderId: record.decoderId ?? null,
        requestId: record.requestId ?? null,
        observedField131: record.observedField131 ?? null,
      };

    case "resend":
      return {
        ...base,
        fromPassingNumber: record.fromPassingNumber ?? null,
        toPassingNumber: record.toPassingNumber ?? null,
        decoderId: record.decoderId ?? null,
        observedField131: record.observedField131 ?? null,
      };

    case "network-settings":
      return {
        ...base,
        decoderId: record.decoderId ?? null,
        ipAddress: record.ipAddress ?? null,
        netmask: record.netmask ?? null,
        defaultGateway: record.defaultGateway ?? null,
        dnsServer: record.dnsServer ?? null,
        observedField131: record.observedField131 ?? null,
      };

    case "tor-0012-observed":
      return {
        ...base,
        decoderId: record.decoderId ?? null,
        observedField03: record.observedField03 ?? null,
        observedField04: record.observedField04 ?? null,
        observedField05: record.observedField05 ?? null,
        observedField131: record.observedField131 ?? null,
      };

    case "timeline":
      return {
        ...base,
        decoderId: record.decoderId ?? null,
        timelineName: record.timelineName ?? null,
        observedField02: record.observedField02 ?? null,
        observedField03: record.observedField03 ?? null,
        observedField04: record.observedField04 ?? null,
        observedField131: record.observedField131 ?? null,
      };

    case "settings":
    case "signals":
    case "gps-info":
    case "first-contact":
      return {
        ...base,
        decoderId: record.decoderId ?? null,
        observedNumericFields: record.observedNumericFields,
        observedAsciiFields: record.observedAsciiFields,
      };

    case "unknown":
    default:
      return base;
  }
}

function decoderIdOfRecord(record: P3Record): string | null {
  switch (record.kind) {
    case "passing":
    case "status":
    case "version-decoder":
    case "get-time":
    case "session":
    case "resend":
    case "network-settings":
    case "tor-0012-observed":
    case "timeline":
    case "settings":
    case "signals":
    case "gps-info":
    case "first-contact":
      return record.decoderId ?? null;
    default:
      return null;
  }
}

function networkIpsOfRecord(record: P3Record): string[] {
  if (record.kind !== "network-settings") return [];
  return [record.ipAddress, record.netmask, record.defaultGateway, record.dnsServer].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }

  const [a, b, c, d] = parts as [number, number, number, number];
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function intToIpv4(value: number): string {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ].join(".");
}

function getBroadcastTargets(): string[] {
  const targets = new Set<string>(["255.255.255.255"]);
  const interfaces = os.networkInterfaces();

  for (const infos of Object.values(interfaces)) {
    for (const info of infos ?? []) {
      if (info.family !== "IPv4" || info.internal || !info.netmask) continue;
      const ip = ipv4ToInt(info.address);
      const mask = ipv4ToInt(info.netmask);
      if (ip == null || mask == null) continue;

      const broadcast = (ip & mask) | (~mask >>> 0);
      targets.add(intToIpv4(broadcast >>> 0));
    }
  }

  return [...targets];
}


export class P3TestClientService {

  // P3Parser is still needed for raw UDP discovery (which intentionally uses the
  // low-level API to surface all TOR types, including TIMELINE and TOR_0012).
  private readonly parser = new P3Parser({ strict: false, rejectOnCrcMismatch: false });

  private connection: P3DecoderConnection | null = null;
  private discoveryInFlight: Promise<void> | null = null;

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
      bytesSent: 0,
    },
    history: {
      nextEventId: 1,
      events: [],
    },
    discovery: {
      status: "idle",
      startedAt: null,
      finishedAt: null,
      timeoutMs: 4_000,
      lastError: null,
      responsesReceived: 0,
      decoders: [],
    },
  };

  constructor(private readonly logger: Logger) {}

  getState(): P3TestClientState {
    return structuredClone(this.state);
  }

  getDiscoveryState(): P3DiscoveryState {
    return structuredClone(this.state.discovery);
  }

  async startDiscovery(timeoutMs = 4_000) {
    if (this.discoveryInFlight) {
      return { ok: false, message: "Discovery is already running." };
    }

    const safeTimeout = Number.isFinite(timeoutMs) ? Math.max(500, Math.min(30_000, Math.floor(timeoutMs))) : 4_000;
    const startedAt = nowIso();
    const discoveredByKey = new Map<string, P3DiscoveredDecoder>();

    this.state = {
      ...this.state,
      discovery: {
        status: "running",
        startedAt,
        finishedAt: null,
        timeoutMs: safeTimeout,
        lastError: null,
        responsesReceived: 0,
        decoders: [],
      },
    };

    this.pushEvent("socket", { action: "discovery-started", timeoutMs: safeTimeout });

    const runPromise = this.runUdpDiscovery(safeTimeout, discoveredByKey)
      .then(() => {
        this.state = {
          ...this.state,
          discovery: {
            ...this.state.discovery,
            status: "completed",
            finishedAt: nowIso(),
            decoders: [...discoveredByKey.values()].sort((a, b) => a.host.localeCompare(b.host)),
          },
        };

        this.pushEvent("socket", {
          action: "discovery-finished",
          decoders: this.state.discovery.decoders.length,
          responses: this.state.discovery.responsesReceived,
        });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Discovery failed.";
        this.state = {
          ...this.state,
          discovery: {
            ...this.state.discovery,
            status: "error",
            finishedAt: nowIso(),
            lastError: message,
            decoders: [...discoveredByKey.values()].sort((a, b) => a.host.localeCompare(b.host)),
          },
        };
        this.pushEvent("warning", { action: "discovery-error", message });
      })
      .finally(() => {
        this.discoveryInFlight = null;
      });

    this.discoveryInFlight = runPromise;
    await runPromise;

    if (this.state.discovery.status === "error") {
      return { ok: false, message: this.state.discovery.lastError ?? "Discovery failed." };
    }

    return {
      ok: true,
      message: `Discovery completed. Found ${String(this.state.discovery.decoders.length)} decoder(s).`,
    };
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

    if (this.connection) {
      this.disconnect("connect requested while previous connection was active");
    }

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
      transport: { bytesSent: 0 },
    };

    this.pushEvent("socket", { action: "connect-requested", host: safeHost, port: safePort });
    this.logger.info({ scope: "p3-test-client", host: safeHost, port: safePort }, "p3 connect requested");

    const conn = new P3DecoderConnection(
      { ip: safeHost, port: safePort },
      {
        onConnected: (info) => {
          this.logger.info(
            { scope: "p3-test-client", decoderType: info.decoderType, decoderId: info.decoderId },
            "p3 decoder identified",
          );
        },
        onDisconnected: (reason) => {
          this.connection = null;
          this.state = {
            ...this.state,
            connection: {
              ...this.state.connection,
              status: "disconnected",
              disconnectedAt: nowIso(),
            },
          };
          this.pushEvent("socket", { action: "disconnected", reason });
          this.logger.info({ scope: "p3-test-client", reason }, "p3 socket closed");
        },
        onPassing: () => {},
        onStatus: () => {},
        onError: (error) => {
          const message = error.message;
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
        },
        onRawRecord: (record) => {
          const receivedAt = nowIso();
          this.pushEvent("record", { receivedAt, record: toSerializableRecord(record) });
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
        },
      },
      { autoReconnect: false },
    );

    this.connection = conn;

    // Fire-and-forget: update state once TCP connection is established.
    conn.connect().then(() => {
      if (conn.state === "connected") {
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
        this.logger.info({ scope: "p3-test-client", host: safeHost, port: safePort }, "p3 socket connected");
      }
    }).catch(() => {});

    return { ok: true, message: `Connecting to ${safeHost}:${String(safePort)}` };
  }

  disconnect(reason = "disconnect requested") {
    if (!this.connection) {
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

    this.connection.disconnect();
    this.connection = null;

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
    if (!this.connection || this.connection.state !== "connected") {
      return { ok: false, message: "Socket is not connected." };
    }

    const request = this.buildRequest(input);
    if (!request) {
      return { ok: false, message: "Invalid request payload for selected request kind." };
    }

    this.connection.sendBuiltRequest(request);

    this.state = {
      ...this.state,
      transport: {
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
        const { fromPassingNumber, toPassingNumber } = input;
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

  private async runUdpDiscovery(timeoutMs: number, discoveredByKey: Map<string, P3DiscoveredDecoder>) {
    const socket = dgram.createSocket("udp4");

    await new Promise<void>((resolve, reject) => {
      let settled = false;

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        socket.removeAllListeners("message");
        socket.removeAllListeners("error");
        socket.removeAllListeners("listening");

        try {
          socket.close();
        } catch {
          // ignore close errors during shutdown
        }

        if (error) reject(error);
        else resolve();
      };

      socket.on("error", (error) => {
        finish(error instanceof Error ? error : new Error("UDP discovery socket error."));
      });

      socket.on("message", (msg, rinfo) => {
        const receivedAt = nowIso();

        try {
          const record = this.parser.parseRecord(msg);
          const serializableRecord = toSerializableRecord(record);

          this.state = {
            ...this.state,
            discovery: {
              ...this.state.discovery,
              responsesReceived: this.state.discovery.responsesReceived + 1,
            },
          };

          this.mergeDiscoveredDecoder(discoveredByKey, record, rinfo.address, rinfo.port, receivedAt);

          this.pushEvent("record", {
            receivedAt,
            source: "udp-discovery",
            remoteHost: rinfo.address,
            remotePort: rinfo.port,
            record: serializableRecord,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to parse UDP discovery response.";
          this.pushEvent("warning", {
            action: "discovery-parse-error",
            remoteHost: rinfo.address,
            remotePort: rinfo.port,
            message,
            frameHexPreview: toHexPreview(msg),
          });
        }
      });

      socket.on("listening", () => {
        socket.setBroadcast(true);

        const local = socket.address();
        const broadcastTargets = getBroadcastTargets();

        this.pushEvent("socket", {
          action: "discovery-listening",
          localPort: typeof local === "string" ? null : local.port,
          targets: broadcastTargets,
        });

        const requests = [
          buildUdpBroadcastDiscoveryRequest25Byte(),
          buildUdpBroadcastDiscoveryRequest32ByteObserved(),
          buildUdpBroadcastDiscoveryRequest23ByteObserved(),
          buildUdpBroadcastDiscoveryRequest21ByteObserved(),
          buildDecoderSearchSmartDecoderBugRequest(),
        ];

        for (const request of requests) {
          for (const target of broadcastTargets) {
            socket.send(toNodeBuffer(request), 5403, target, (error) => {
              if (!error) return;
              this.pushEvent("warning", {
                action: "discovery-send-error",
                request: request.name,
                target,
                message: error.message,
              });
            });
          }

          this.pushEvent("request", {
            kind: "decoder-search",
            source: "udp-discovery",
            request: {
              name: request.name,
              tor: request.tor,
              torName: request.torName,
              frameHex: request.frameHex,
              escapedFrameHex: request.escapedFrameHex,
              notes: request.notes ?? null,
            },
          });
        }

        setTimeout(() => finish(), timeoutMs);
      });

      // Many decoders answer discovery on UDP source port 5303 (as documented in field notes).
      socket.bind(5303, "0.0.0.0");
    });
  }

  private mergeDiscoveredDecoder(
    discoveredByKey: Map<string, P3DiscoveredDecoder>,
    record: P3Record,
    host: string,
    port: number,
    receivedAt: string,
  ) {
    const key = host;
    const observedDecoderId = decoderIdOfRecord(record);

    const existing = discoveredByKey.get(key);
    const torNames = existing ? [...existing.torNames] : [];
    if (!torNames.includes(record.torName)) torNames.push(record.torName);

    const networkIps = new Set(existing?.networkIps ?? []);
    for (const ip of networkIpsOfRecord(record)) {
      networkIps.add(ip);
    }

    const next: P3DiscoveredDecoder = {
      key,
      host,
      port,
      decoderId: observedDecoderId ?? existing?.decoderId ?? null,
      firstSeenAt: existing?.firstSeenAt ?? receivedAt,
      lastSeenAt: receivedAt,
      responseCount: (existing?.responseCount ?? 0) + 1,
      torNames,
      lastRecordKind: record.kind,
      decoderType:
        record.kind === "version-decoder"
          ? (record.decoderType ?? existing?.decoderType ?? null)
          : (existing?.decoderType ?? null),
      firmwareVersion:
        record.kind === "version-decoder"
          ? (record.firmwareVersion ?? existing?.firmwareVersion ?? null)
          : (existing?.firmwareVersion ?? null),
      timelineName:
        record.kind === "timeline"
          ? (record.timelineName ?? existing?.timelineName ?? null)
          : (existing?.timelineName ?? null),
      networkIps: [...networkIps],
    };

    discoveredByKey.set(key, next);
    this.state = {
      ...this.state,
      discovery: {
        ...this.state.discovery,
        decoders: [...discoveredByKey.values()].sort((a, b) => a.host.localeCompare(b.host)),
      },
    };
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
