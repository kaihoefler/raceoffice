/**
 * Uploads passings to the timing passing store (POST /timing/passings).
 *
 * - Batches: at most one request per interval, so a burst of passings costs one request.
 * - Reliable: a failed batch stays queued and is retried with backoff (1 s → 30 s). The store
 *   is idempotent by passing id, so a batch that reached the server but whose answer got lost
 *   does not duplicate anything.
 * - Bounded: beyond `maxQueue` the oldest passings are dropped with a warning (server down for
 *   a very long time) instead of growing without limit.
 */
import type { TimingPassingInput } from "@raceoffice/domain";

export type PassingUploaderOptions = {
  intervalMs?: number;
  maxBatch?: number;
  maxQueue?: number;
  fetchImpl?: typeof fetch;
  onWarning?: (message: string) => void;
};

export class TimingPassingUploader {
  private queue: TimingPassingInput[] = [];
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private backoffMs = 0;
  private readonly intervalMs: number;
  private readonly maxBatch: number;
  private readonly maxQueue: number;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly baseHttpUrl: string,
    private readonly options: PassingUploaderOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? 500;
    this.maxBatch = options.maxBatch ?? 500;
    this.maxQueue = options.maxQueue ?? 100_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  get pending(): number {
    return this.queue.length;
  }

  add(passing: TimingPassingInput): void {
    this.queue.push(passing);
    if (this.queue.length > this.maxQueue) {
      const dropped = this.queue.length - this.maxQueue;
      this.queue.splice(0, dropped);
      this.options.onWarning?.(`[timing] passing upload queue full: dropped ${dropped} oldest passing(s)`);
    }
    this.schedule(this.intervalMs);
  }

  /** Sends what is queued now (also used on shutdown). Resolves when the attempt is done. */
  async flush(): Promise<void> {
    if (this.inFlight || this.queue.length === 0) return;
    this.inFlight = true;
    const batch = this.queue.slice(0, this.maxBatch);
    try {
      const res = await this.fetchImpl(`${this.baseHttpUrl}/timing/passings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passings: batch }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Only now remove them: on failure they are retried.
      this.queue.splice(0, batch.length);
      this.backoffMs = 0;
    } catch (err) {
      this.backoffMs = Math.min(30_000, this.backoffMs ? this.backoffMs * 2 : 1_000);
      this.options.onWarning?.(
        `[timing] passing upload failed (${batch.length} queued, retry in ${this.backoffMs} ms): ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.inFlight = false;
    }
    if (this.queue.length > 0) this.schedule(this.backoffMs || this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(delayMs: number): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delayMs);
  }
}
