/** Counts events over a sliding window of whole seconds (cheap: one bucket per second). */
export class RateCounter {
  private readonly buckets: number[];
  private readonly seconds: number[];

  constructor(private readonly windowSeconds: number) {
    this.buckets = new Array<number>(windowSeconds).fill(0);
    this.seconds = new Array<number>(windowSeconds).fill(-1);
  }

  add(now = Date.now()): void {
    const second = Math.floor(now / 1000);
    const index = second % this.windowSeconds;
    if (this.seconds[index] !== second) {
      this.seconds[index] = second;
      this.buckets[index] = 0;
    }
    this.buckets[index] = (this.buckets[index] ?? 0) + 1;
  }

  /** Number of events within the last `windowSeconds` seconds. */
  total(now = Date.now()): number {
    const second = Math.floor(now / 1000);
    let sum = 0;
    for (let i = 0; i < this.windowSeconds; i++) {
      const s = this.seconds[i] ?? -1;
      if (s > second - this.windowSeconds && s <= second) sum += this.buckets[i] ?? 0;
    }
    return sum;
  }
}
