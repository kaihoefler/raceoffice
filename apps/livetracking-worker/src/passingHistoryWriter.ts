/**
 * Batches athlete passings into the append-only passing-history document.
 *
 * Why batching: the server re-reads and re-writes the whole document on every patch, and the
 * history grows to tens of thousands of entries in a long session. One write per second keeps
 * that cost bounded regardless of how many passings arrive.
 *
 * Delivery: a batch is "in flight" until the document revision advances. If the batch is then
 * missing from the document (rejected write, e.g. after a revision race), it is re-queued —
 * unless the history shrank in the meantime, which means a client reset it and the old
 * passings must not come back.
 */
import {
  createLiveTrackingPassingHistoryDocument,
  isLiveTrackingPassingHistoryDocument,
  type LiveTrackingPassingEvent,
  type LiveTrackingPassingHistoryDocument,
} from "@raceoffice/domain";

/** The subset of RealtimeDocClient this writer needs (kept small for tests). */
export type PassingHistoryDocClient = {
  readonly data: LiveTrackingPassingHistoryDocument | null;
  readonly rev: number;
  update(mutator: (prev: LiveTrackingPassingHistoryDocument) => LiveTrackingPassingHistoryDocument): boolean;
};

export class PassingHistoryWriter {
  private pending: LiveTrackingPassingEvent[] = [];
  private inFlight: LiveTrackingPassingEvent[] = [];
  private inFlightRev: number | null = null;
  private lastKnownLength = 0;

  constructor(private readonly client: PassingHistoryDocClient) {}

  /** Queues one passing for the next flush. */
  append(passing: LiveTrackingPassingEvent): void {
    this.pending.push(passing);
  }

  hasPending(): boolean {
    return this.pending.length > 0;
  }

  /**
   * Sends all pending passings as one append. Returns false when nothing could be sent
   * (nothing pending, previous batch not yet confirmed, or not connected); the caller
   * simply retries on the next tick.
   */
  flush(): boolean {
    if (this.pending.length === 0) return false;
    if (this.inFlightRev !== null) return false;

    const batch = this.pending;
    const updatedAt = new Date().toISOString();
    const sent = this.client.update((prev) => {
      const base = isLiveTrackingPassingHistoryDocument(prev) ? prev : createLiveTrackingPassingHistoryDocument();
      return { ...base, passings: [...base.passings, ...batch], updatedAt };
    });
    if (!sent) return false;

    this.pending = [];
    this.inFlight = batch;
    this.inFlightRev = this.client.rev;
    return true;
  }

  /** Must be called whenever the history document changes (snapshot or patch). */
  onDocumentChanged(): void {
    const passings = this.client.data?.passings ?? [];
    const wasReset = passings.length < this.lastKnownLength;
    this.lastKnownLength = passings.length;

    if (this.inFlightRev === null || this.client.rev <= this.inFlightRev) return;

    const batch = this.inFlight;
    this.inFlight = [];
    this.inFlightRev = null;
    if (wasReset) return;

    // Our batch was appended at the end; checking the tail is enough.
    const tailIds = new Set(passings.slice(-batch.length * 2 - 50).map((p) => p.id));
    const missing = batch.filter((p) => !tailIds.has(p.id));
    if (missing.length > 0) this.pending = [...missing, ...this.pending];
  }

  /**
   * All passings known so far: persisted history plus the ones not yet confirmed.
   * Returns null until the history document has loaded, so callers don't project
   * results from an incomplete view.
   */
  allPassings(): LiveTrackingPassingEvent[] | null {
    const doc = this.client.data;
    if (!doc) return null;
    const persisted = isLiveTrackingPassingHistoryDocument(doc) ? doc.passings : [];
    if (this.inFlight.length === 0 && this.pending.length === 0) return persisted;

    const known = new Set(persisted.slice(-(this.inFlight.length + this.pending.length) * 2 - 50).map((p) => p.id));
    return [...persisted, ...[...this.inFlight, ...this.pending].filter((p) => !known.has(p.id))];
  }
}
