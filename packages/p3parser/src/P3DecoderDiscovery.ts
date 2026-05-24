import dgram from "node:dgram";

import {
  buildDecoderSearchSmartDecoderBugRequest,
  buildUdpBroadcastDiscoveryRequest25Byte,
  toNodeBuffer,
} from "./builder.js";
import type { DiscoveredDecoder } from "./clientTypes.js";
import { P3Parser } from "./parser.js";

const DEFAULT_PORT = 5403;
const BROADCAST_ADDRESS = "255.255.255.255";

export type DiscoveryCallbacks = {
  onDiscovered: (decoder: DiscoveredDecoder) => void;
  onError?: (error: Error) => void;
};

export type DiscoveryOptions = {
  /** UDP port to broadcast to. Default: 5403 */
  port?: number;
  /** Broadcast address. Default: 255.255.255.255 */
  broadcastAddress?: string;
};

/**
 * Discovers P3 decoders on the local network via UDP broadcast.
 *
 * Each decoder typically responds with a VERSION_DECODER frame (firmware info)
 * and a NETWORK_SETTINGS frame (IP config). Both are parsed to build a
 * DiscoveredDecoder, deduplicated by (sourceIp, decoderId).
 */
export class P3DecoderDiscovery {
  private readonly callbacks: DiscoveryCallbacks;
  private readonly port: number;
  private readonly broadcastAddress: string;

  private socket: dgram.Socket | null = null;
  private readonly parser = new P3Parser({ strict: false, rejectOnCrcMismatch: false });

  // Accumulate partial info per source IP until we have enough to emit.
  private readonly pending = new Map<string, Partial<DiscoveredDecoder> & { ip: string }>();
  private readonly emitted = new Set<string>(); // "ip:decoderId"

  constructor(callbacks: DiscoveryCallbacks, options: DiscoveryOptions = {}) {
    this.callbacks = callbacks;
    this.port = options.port ?? DEFAULT_PORT;
    this.broadcastAddress = options.broadcastAddress ?? BROADCAST_ADDRESS;
  }

  start(): void {
    if (this.socket) return;

    const socket = dgram.createSocket("udp4");
    this.socket = socket;

    socket.on("error", (err) => {
      this.callbacks.onError?.(err);
    });

    socket.on("message", (msg: Buffer, rinfo: dgram.RemoteInfo) => {
      this._handleMessage(new Uint8Array(msg), rinfo.address);
    });

    socket.bind(0, () => {
      socket.setBroadcast(true);
      this._sendBroadcasts();
    });
  }

  stop(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.pending.clear();
    this.emitted.clear();
  }

  /**
   * One-shot convenience: broadcast, wait for timeoutMs, return all discovered decoders.
   */
  static scan(timeoutMs = 3000): Promise<DiscoveredDecoder[]> {
    return new Promise((resolve) => {
      const found = new Map<string, DiscoveredDecoder>();

      const discovery = new P3DecoderDiscovery({
        onDiscovered: (decoder) => {
          found.set(`${decoder.ip}:${decoder.decoderId}`, decoder);
        },
      });

      discovery.start();
      setTimeout(() => {
        discovery.stop();
        resolve([...found.values()]);
      }, timeoutMs);
    });
  }

  // ---------------------------------------------------------------------------

  private _sendBroadcasts(): void {
    if (!this.socket) return;

    for (const request of [
      buildUdpBroadcastDiscoveryRequest25Byte(),
      buildDecoderSearchSmartDecoderBugRequest(),
    ]) {
      this.socket.send(toNodeBuffer(request), this.port, this.broadcastAddress);
    }
  }

  private _handleMessage(msg: Uint8Array, sourceIp: string): void {
    let record;
    try {
      record = this.parser.parseRecord(msg);
    } catch {
      return; // ignore unparseable UDP frames
    }

    const entry = this.pending.get(sourceIp) ?? { ip: sourceIp };

    if (record.kind === "version-decoder") {
      if (record.decoderId) entry.decoderId = record.decoderId;
      if (record.decoderType) entry.decoderType = record.decoderType;
      if (record.firmwareVersion) entry.firmwareVersion = record.firmwareVersion;
      entry.port = this.port;
    } else if (record.kind === "network-settings" && record.ipAddress) {
      // Prefer the decoder's self-reported IP over the UDP source IP.
      entry.ip = record.ipAddress;
      if (record.decoderId) entry.decoderId = record.decoderId;
    }

    this.pending.set(sourceIp, entry);

    if (entry.decoderId) {
      const key = `${entry.ip}:${entry.decoderId}`;
      if (!this.emitted.has(key)) {
        this.emitted.add(key);
        this.callbacks.onDiscovered({
          ip: entry.ip,
          port: entry.port ?? this.port,
          decoderId: entry.decoderId,
          decoderType: entry.decoderType ?? "unknown",
          firmwareVersion: entry.firmwareVersion ?? "unknown",
        });
      }
    }
  }
}
