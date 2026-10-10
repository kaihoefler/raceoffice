import dgram from "node:dgram";
import os from "node:os";

import {
  buildDecoderSearchSmartDecoderBugRequest,
  buildUdpBroadcastDiscoveryRequest21ByteObserved,
  buildUdpBroadcastDiscoveryRequest23ByteObserved,
  buildUdpBroadcastDiscoveryRequest25Byte,
  buildUdpBroadcastDiscoveryRequest32ByteObserved,
  toNodeBuffer,
  type P3BuiltRequest,
} from "./builder.js";
import type { DiscoveredDecoder } from "./clientTypes.js";
import { P3Parser } from "./parser.js";
import type { P3Record } from "./types.js";

const DEFAULT_PORT = 5403;
// Decoders answer discovery towards UDP port 5303 (field notes); replies to an
// ephemeral source port are not reliably delivered.
const DEFAULT_LOCAL_PORT = 5303;
const LIMITED_BROADCAST = "255.255.255.255";

export type DiscoveryRemote = { address: string; port: number };

export type DiscoveryCallbacks = {
  /** Called for every reply with the merged snapshot of the replying decoder. */
  onDiscovered?: (decoder: DiscoveredDecoder) => void;
  /** Socket-level failure (e.g. local port already in use). The scan is unusable afterwards. */
  onError?: (error: Error) => void;
  // Diagnostic hooks (used by the P3 test client to build its event log).
  onListening?: (info: { localPort: number | null; targets: string[] }) => void;
  onRequestSent?: (request: P3BuiltRequest) => void;
  onSendError?: (error: Error, request: P3BuiltRequest, target: string) => void;
  onRecord?: (record: P3Record, remote: DiscoveryRemote) => void;
  onParseError?: (error: Error, remote: DiscoveryRemote, frame: Uint8Array) => void;
};

export type DiscoveryOptions = {
  /** UDP port the decoders listen on; also reported as TCP port of the result. Default: 5403 */
  port?: number;
  /** Local UDP port to bind for replies. Default: 5303 */
  localPort?: number;
  /**
   * Broadcast targets. Default: 255.255.255.255 plus the directed broadcast of
   * every non-internal IPv4 interface.
   */
  broadcastAddresses?: string[];
};

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }

  const [a, b, c, d] = parts as [number, number, number, number];
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function intToIpv4(value: number): string {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff].join(".");
}

/**
 * The limited broadcast (255.255.255.255) leaves through a single interface
 * only — on Windows hosts with several adapters (WSL/Hyper-V vEthernet, VPN,
 * WLAN + LAN) frequently the wrong one. Directed subnet broadcasts reach each
 * attached network explicitly.
 */
export function getDefaultBroadcastAddresses(): string[] {
  const targets = new Set<string>([LIMITED_BROADCAST]);

  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family !== "IPv4" || info.internal || !info.netmask) continue;
      const ip = ipv4ToInt(info.address);
      const mask = ipv4ToInt(info.netmask);
      if (ip == null || mask == null) continue;

      targets.add(intToIpv4(((ip & mask) | (~mask >>> 0)) >>> 0));
    }
  }

  return [...targets];
}

/**
 * Request variants observed from the vendor software. Decoder generations
 * differ in which one they answer, so all of them are sent.
 */
function discoveryRequests(): P3BuiltRequest[] {
  return [
    buildUdpBroadcastDiscoveryRequest25Byte(),
    buildUdpBroadcastDiscoveryRequest32ByteObserved(),
    buildUdpBroadcastDiscoveryRequest23ByteObserved(),
    buildUdpBroadcastDiscoveryRequest21ByteObserved(),
    buildDecoderSearchSmartDecoderBugRequest(),
  ];
}

/**
 * Discovers P3 decoders on the local network via UDP broadcast.
 *
 * Replies are grouped by UDP source address: every parseable reply counts as
 * a decoder, even without a decoder id. Decoders typically answer with
 * NETWORK_SETTINGS, TIMELINE and TOR 0x0012 frames rather than VERSION_DECODER,
 * so id/type/firmware are filled in as far as the replies carry them.
 */
export class P3DecoderDiscovery {
  private readonly callbacks: DiscoveryCallbacks;
  private readonly port: number;
  private readonly localPort: number;
  private readonly broadcastAddresses: string[] | undefined;

  private socket: dgram.Socket | null = null;
  private readonly parser = new P3Parser({ strict: false, rejectOnCrcMismatch: false });
  private readonly decoders = new Map<string, DiscoveredDecoder>();
  // Set while run() is pending so socket errors can reject its promise.
  private failRun: ((error: Error) => void) | null = null;

  constructor(callbacks: DiscoveryCallbacks = {}, options: DiscoveryOptions = {}) {
    this.callbacks = callbacks;
    this.port = options.port ?? DEFAULT_PORT;
    this.localPort = options.localPort ?? DEFAULT_LOCAL_PORT;
    this.broadcastAddresses = options.broadcastAddresses;
  }

  start(): void {
    if (this.socket) return;

    const socket = dgram.createSocket("udp4");
    this.socket = socket;

    socket.on("error", (err) => {
      this.callbacks.onError?.(err);
      this.failRun?.(err);
    });

    socket.on("message", (msg: Buffer, rinfo: dgram.RemoteInfo) => {
      this._handleMessage(new Uint8Array(msg), { address: rinfo.address, port: rinfo.port });
    });

    socket.on("listening", () => {
      socket.setBroadcast(true);

      const local = socket.address();
      const targets = this.broadcastAddresses ?? getDefaultBroadcastAddresses();
      this.callbacks.onListening?.({ localPort: typeof local === "string" ? null : local.port, targets });

      this._sendBroadcasts(socket, targets);
    });

    socket.bind(this.localPort, "0.0.0.0");
  }

  stop(): void {
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      socket.removeAllListeners();
      // Swallow errors during shutdown (e.g. close after a failed bind).
      socket.on("error", () => {});
      try {
        socket.close();
      } catch {
        // already closed
      }
    }
  }

  /** Snapshot of all decoders seen since the instance was created, sorted by IP. */
  getDecoders(): DiscoveredDecoder[] {
    return [...this.decoders.values()].sort((a, b) => a.ip.localeCompare(b.ip));
  }

  /**
   * Starts, waits `timeoutMs`, stops and resolves with all discovered decoders.
   * Rejects on socket errors (e.g. local port already in use).
   */
  run(timeoutMs = 3000): Promise<DiscoveredDecoder[]> {
    return new Promise((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        this.failRun = null;
        this.stop();
        if (error) reject(error);
        else resolve(this.getDecoders());
      };

      this.failRun = finish;
      const timer = setTimeout(() => finish(), timeoutMs);
      this.start();
    });
  }

  /** One-shot convenience: broadcast, wait for timeoutMs, return all discovered decoders. */
  static scan(timeoutMs = 3000, options: DiscoveryOptions = {}): Promise<DiscoveredDecoder[]> {
    return new P3DecoderDiscovery({}, options).run(timeoutMs);
  }

  // ---------------------------------------------------------------------------

  private _sendBroadcasts(socket: dgram.Socket, targets: string[]): void {
    for (const request of discoveryRequests()) {
      for (const target of targets) {
        socket.send(toNodeBuffer(request), this.port, target, (error) => {
          if (error) this.callbacks.onSendError?.(error, request, target);
        });
      }
      this.callbacks.onRequestSent?.(request);
    }
  }

  private _handleMessage(msg: Uint8Array, remote: DiscoveryRemote): void {
    let record: P3Record;
    try {
      record = this.parser.parseRecord(msg);
    } catch (error) {
      const err = error instanceof Error ? error : new Error("Failed to parse UDP discovery response.");
      this.callbacks.onParseError?.(err, remote, msg);
      return;
    }

    this.callbacks.onRecord?.(record, remote);

    const decoder = this._merge(record, remote.address);
    this.decoders.set(decoder.ip, decoder);
    this.callbacks.onDiscovered?.(decoder);
  }

  private _merge(record: P3Record, ip: string): DiscoveredDecoder {
    const receivedAt = new Date().toISOString();
    const existing = this.decoders.get(ip);

    const torNames = existing ? [...existing.torNames] : [];
    if (!torNames.includes(record.torName)) torNames.push(record.torName);

    const decoderId = record.kind !== "unknown" ? (record.decoderId ?? null) : null;

    return {
      ip,
      port: this.port,
      decoderId: decoderId ?? existing?.decoderId ?? null,
      decoderType:
        record.kind === "version-decoder" ? (record.decoderType ?? existing?.decoderType ?? null) : (existing?.decoderType ?? null),
      firmwareVersion:
        record.kind === "version-decoder"
          ? (record.firmwareVersion ?? existing?.firmwareVersion ?? null)
          : (existing?.firmwareVersion ?? null),
      timelineName:
        record.kind === "timeline" ? (record.timelineName ?? existing?.timelineName ?? null) : (existing?.timelineName ?? null),
      network:
        record.kind === "network-settings"
          ? {
              ipAddress: record.ipAddress ?? null,
              netmask: record.netmask ?? null,
              defaultGateway: record.defaultGateway ?? null,
              dnsServer: record.dnsServer ?? null,
            }
          : (existing?.network ?? null),
      torNames,
      lastRecordKind: record.kind,
      responseCount: (existing?.responseCount ?? 0) + 1,
      firstSeenAt: existing?.firstSeenAt ?? receivedAt,
      lastSeenAt: receivedAt,
    };
  }
}
