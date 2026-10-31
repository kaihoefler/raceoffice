/**
 * TimingPassingFeed – a consumer's view on the timing passing store
 * (WS /timing/passings/stream): all passings of given decoders after a store seq, kept in
 * memory and updated live.
 *
 * - `configure(decoderIds, sinceSeq)` (re)opens the stream when the selection changes.
 * - Passings deleted on the timing layer: the feed reloads from scratch, so consumers never
 *   keep passings that no longer exist.
 * - Reconnects with backoff when the server is unreachable.
 */
import type { TimingPassing, TimingPassingStreamMessage } from "@raceoffice/domain";

export type PassingFeedOptions = {
  /** WebSocket constructor (replaceable in tests). Defaults to the global WebSocket. */
  WebSocketImpl?: typeof WebSocket;
};

export class TimingPassingFeed {
  private socket: WebSocket | null = null;
  private key: string | null = null;
  private decoderIds: string[] = [];
  private sinceSeq = 0;
  private items: TimingPassing[] = [];
  private live = false;
  private retryTimer: NodeJS.Timeout | null = null;
  private backoffMs = 1_000;
  private closed = false;
  private readonly WebSocketImpl: typeof WebSocket;

  constructor(
    private readonly baseHttpUrl: string,
    private readonly onChange: () => void,
    options: PassingFeedOptions = {},
  ) {
    this.WebSocketImpl = options.WebSocketImpl ?? WebSocket;
  }

  /** Passings in seq order (only complete after the catch-up, see `isLive`). */
  get passings(): readonly TimingPassing[] {
    return this.items;
  }

  /** The catch-up is done; the list reflects the store. */
  get isLive(): boolean {
    return this.live;
  }

  /** Selects decoders and start seq; an empty decoder list or null seq closes the stream. */
  configure(decoderIds: readonly string[], sinceSeq: number | null): void {
    const ids = [...new Set(decoderIds)].sort();
    const key = sinceSeq === null || ids.length === 0 ? null : `${sinceSeq}|${ids.join(",")}`;
    if (key === this.key) return;
    this.key = key;
    this.decoderIds = ids;
    this.sinceSeq = sinceSeq ?? 0;
    this.reopen();
  }

  close(): void {
    this.closed = true;
    this.key = null;
    this.disconnect();
  }

  private reopen(): void {
    this.disconnect();
    this.items = [];
    this.live = false;
    this.onChange();
    if (this.key !== null && !this.closed) this.connect();
  }

  private connect(): void {
    const params = new URLSearchParams({ sinceSeq: String(this.sinceSeq), decoderIds: this.decoderIds.join(",") });
    const url = `${this.baseHttpUrl.replace(/^http/i, "ws")}/timing/passings/stream?${params}`;
    const ws = new this.WebSocketImpl(url);
    this.socket = ws;
    ws.addEventListener("open", () => {
      this.backoffMs = 1_000;
    });
    ws.addEventListener("message", (event) => {
      let msg: TimingPassingStreamMessage;
      try {
        msg = JSON.parse(String(event.data)) as TimingPassingStreamMessage;
      } catch {
        return;
      }
      if (msg.type === "passings") {
        const last = this.items[this.items.length - 1]?.seq ?? this.sinceSeq;
        const fresh = msg.passings.filter((p) => p.seq > last);
        if (fresh.length) this.items = [...this.items, ...fresh];
        if (this.live && fresh.length) this.onChange();
      } else if (msg.type === "live") {
        this.live = true;
        this.onChange();
      } else if (msg.type === "deleted") {
        this.reopen();
      }
    });
    ws.addEventListener("close", () => {
      if (this.socket !== ws || this.closed || this.key === null) return;
      this.socket = null;
      // Reconnect from scratch: the store may have changed meanwhile.
      this.retryTimer = setTimeout(() => this.reopen(), this.backoffMs);
      this.backoffMs = Math.min(10_000, this.backoffMs * 2);
    });
  }

  private disconnect(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const ws = this.socket;
    this.socket = null;
    if (ws && ws.readyState <= 1) ws.close();
  }
}
