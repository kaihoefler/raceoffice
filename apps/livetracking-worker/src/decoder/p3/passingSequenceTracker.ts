/**
 * PassingSequenceTracker – detects missing P3 passings and decides what to request again.
 *
 * P3 decoders number their passings consecutively (passing number). A gap means passings were
 * lost (e.g. a short network outage). The decoder keeps them in memory and sends them again on
 * a RESEND request for a number range.
 *
 * Rules:
 * - Live gap: after number n the next is n+k (k > 1) → request n+1 … n+k-1.
 * - Catch-up after (re)connecting: the decoder reports its last passing index (SESSION); every
 *   number after the highest one already stored is requested, capped at `maxCatchUp` (a decoder
 *   seen for the first time does not pull its whole memory).
 * - A requested number that has not arrived after `retryMs` is requested again, at most
 *   `maxAttempts` times; then it counts as lost (`open` stays > 0 in the stats).
 * - A last index lower than the highest stored number means the decoder memory was reset:
 *   nothing is requested and tracking restarts from the reported index.
 * - Pure logic, no I/O and no timers: the adapter calls `due(now)` periodically.
 */

export type PassingRange = { from: number; to: number };

export type PassingSequenceStats = {
  /** Numbers requested again (each counted once). */
  requested: number;
  /** Requested numbers that arrived. */
  recovered: number;
  /** Requested numbers still missing (including given-up ones). */
  open: number;
};

type Pending = { attempts: number; lastRequestAt: number };

export type PassingSequenceTrackerOptions = {
  retryMs?: number;
  maxAttempts?: number;
  maxCatchUp?: number;
  /** Largest single gap that is requested (bigger jumps are treated as a decoder reset). */
  maxGap?: number;
};

export class PassingSequenceTracker {
  private highest: number | null = null;
  private readonly pending = new Map<number, Pending>();
  private readonly given = new Set<number>();
  private stats: PassingSequenceStats = { requested: 0, recovered: 0, open: 0 };
  private readonly retryMs: number;
  private readonly maxAttempts: number;
  private readonly maxCatchUp: number;
  private readonly maxGap: number;

  constructor(options: PassingSequenceTrackerOptions = {}) {
    this.retryMs = options.retryMs ?? 5_000;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.maxCatchUp = options.maxCatchUp ?? 2_000;
    this.maxGap = options.maxGap ?? 2_000;
  }

  get snapshot(): PassingSequenceStats {
    return { ...this.stats, open: this.pending.size + this.given.size };
  }

  /** Highest number already stored for this decoder (from the passing store), if known. */
  resumeFrom(highestStored: number | null): void {
    if (highestStored === null || !Number.isFinite(highestStored)) return;
    if (this.highest === null || highestStored > this.highest) this.highest = highestStored;
  }

  /** The decoder reported its last passing index (SESSION answer). */
  onSession(lastPassingIndex: number, now: number): PassingRange[] {
    if (!Number.isFinite(lastPassingIndex)) return [];
    if (this.highest === null) {
      // Nothing stored yet: start from here, do not pull the decoder memory.
      this.highest = lastPassingIndex;
      return [];
    }
    if (lastPassingIndex < this.highest) {
      // Decoder memory was reset (or another device answers at this address).
      this.pending.clear();
      this.highest = lastPassingIndex;
      return [];
    }
    const from = Math.max(this.highest + 1, lastPassingIndex - this.maxCatchUp + 1);
    this.highest = lastPassingIndex;
    return this.request(from, lastPassingIndex, now);
  }

  /** A passing arrived (live or resent). Returns ranges to request now. */
  onPassing(passingNumber: number, now: number): PassingRange[] {
    if (!Number.isFinite(passingNumber)) return [];
    if (this.pending.delete(passingNumber) || this.given.delete(passingNumber)) {
      this.stats.recovered++;
    }
    if (this.highest === null) {
      this.highest = passingNumber;
      return [];
    }
    if (passingNumber <= this.highest) return [];
    const gapFrom = this.highest + 1;
    this.highest = passingNumber;
    if (passingNumber - gapFrom > this.maxGap) return []; // decoder reset or foreign numbering
    return gapFrom <= passingNumber - 1 ? this.request(gapFrom, passingNumber - 1, now) : [];
  }

  /** Numbers whose request timed out and should be requested again. */
  due(now: number): PassingRange[] {
    const numbers: number[] = [];
    for (const [n, p] of this.pending) {
      if (now - p.lastRequestAt < this.retryMs) continue;
      if (p.attempts >= this.maxAttempts) {
        this.pending.delete(n);
        this.given.add(n);
        continue;
      }
      p.attempts++;
      p.lastRequestAt = now;
      numbers.push(n);
    }
    return toRanges(numbers);
  }

  private request(from: number, to: number, now: number): PassingRange[] {
    const numbers: number[] = [];
    for (let n = from; n <= to; n++) {
      if (this.pending.has(n)) continue;
      this.pending.set(n, { attempts: 1, lastRequestAt: now });
      this.stats.requested++;
      numbers.push(n);
    }
    return toRanges(numbers);
  }
}

/** Sorted numbers → contiguous ranges. */
export function toRanges(numbers: number[]): PassingRange[] {
  const sorted = [...numbers].sort((a, b) => a - b);
  const ranges: PassingRange[] = [];
  for (const n of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && n === last.to + 1) last.to = n;
    else ranges.push({ from: n, to: n });
  }
  return ranges;
}
