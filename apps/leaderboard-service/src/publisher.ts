/**
 * SnapshotPublisher – turns store changes into WebSocket messages (snapshot + JSON-Patch).
 *
 * Channels:
 * - `current`: follows the race the REST API returns for `/race` (Java `getRaceToReturn`)
 * - `race:<id>`: one fixed race
 *
 * Rules (doc/leaderboard-integration/04-service-api.md):
 * - On subscribe: a `snapshot` of the channel.
 * - Changes are coalesced for `coalesceMs`, then diffed against the last sent state (`patch`
 *   with `baseRev`/`rev`).
 * - Race change (other raceID, or race ↔ null): a new `snapshot`, no patch.
 * - Liveness: every `$F` heartbeat produces a message, an empty patch if nothing visible
 *   changed. Otherwise the scoring would see "stale" while it shows the previous race
 *   (after `$I` the heartbeats go to the new, not yet published race).
 */
import fastJsonPatch from "fast-json-patch";
import type { LeaderboardWsMessage, RaceStatusRace } from "@raceoffice/domain";
import { toRaceTO, type RaceStateStore } from "@raceoffice/rmonitor";

const { compare } = fastJsonPatch;

export type ChannelKey = "current" | `race:${number}`;
export type Send = (message: LeaderboardWsMessage) => void;

type Channel = {
  key: ChannelKey;
  subscribers: Set<Send>;
  rev: number;
  raceId: number | null;
  data: RaceStatusRace | null;
};

export type Subscription = {
  /** Sends a fresh snapshot to this subscriber (resync). */
  resync(): void;
  unsubscribe(): void;
};

export class SnapshotPublisher {
  private readonly channels = new Map<ChannelKey, Channel>();
  private timer: NodeJS.Timeout | null = null;
  private pendingTick = false;

  constructor(
    private readonly getStore: () => RaceStateStore,
    private readonly coalesceMs: () => number,
  ) {}

  get subscriberCount(): number {
    let n = 0;
    for (const c of this.channels.values()) n += c.subscribers.size;
    return n;
  }

  subscribe(key: ChannelKey, send: Send): Subscription {
    let channel = this.channels.get(key);
    if (!channel) {
      const data = this.compute(key);
      channel = { key, subscribers: new Set(), rev: 0, raceId: data?.raceID ?? null, data };
      this.channels.set(key, channel);
    }
    const ch = channel;
    ch.subscribers.add(send);
    this.sendSnapshot(ch, send);
    return {
      resync: () => {
        this.flushNow();
        this.sendSnapshot(ch, send);
      },
      unsubscribe: () => {
        ch.subscribers.delete(send);
        if (ch.subscribers.size === 0) this.channels.delete(ch.key);
      },
    };
  }

  /** Called after every applied store change. */
  notify(options: { heartbeat?: boolean } = {}): void {
    if (options.heartbeat) this.pendingTick = true;
    if (this.channels.size === 0) {
      this.pendingTick = false;
      return;
    }
    if (this.timer) return;
    const delay = this.coalesceMs();
    if (delay <= 0) {
      this.flushNow();
      return;
    }
    this.timer = setTimeout(() => this.flushNow(), delay);
  }

  /** The store was replaced/reset: every channel gets a new snapshot. */
  reset(): void {
    this.cancelTimer();
    this.pendingTick = false;
    for (const ch of this.channels.values()) {
      ch.data = this.compute(ch.key);
      ch.raceId = ch.data?.raceID ?? null;
      ch.rev++;
      for (const send of ch.subscribers) this.sendSnapshot(ch, send);
    }
  }

  /** Computes and sends pending changes immediately. */
  flushNow(): void {
    this.cancelTimer();
    const tick = this.pendingTick;
    this.pendingTick = false;

    for (const ch of this.channels.values()) {
      const next = this.compute(ch.key);
      const nextId = next?.raceID ?? null;

      if (nextId !== ch.raceId || (next === null) !== (ch.data === null)) {
        ch.rev++;
        ch.data = next;
        ch.raceId = nextId;
        for (const send of ch.subscribers) this.sendSnapshot(ch, send);
        continue;
      }

      const ops = ch.data && next ? compare(ch.data, next) : [];
      if (ops.length === 0 && !tick) continue;
      const baseRev = ch.rev;
      ch.rev++;
      ch.data = next;
      if (nextId === null) continue; // no race: nothing to patch (snapshot rules cover null)
      const message: LeaderboardWsMessage = { type: "patch", raceId: nextId, rev: ch.rev, baseRev, patch: ops };
      for (const send of ch.subscribers) send(message);
    }
  }

  close(): void {
    this.cancelTimer();
    this.channels.clear();
  }

  private compute(key: ChannelKey): RaceStatusRace | null {
    const store = this.getStore();
    if (key === "current") return toRaceTO(store.displayRace);
    const race = store.getById(Number(key.slice("race:".length)));
    return race ? toRaceTO(race) : null;
  }

  private sendSnapshot(ch: Channel, send: Send): void {
    send({ type: "snapshot", raceId: ch.raceId, rev: ch.rev, data: ch.data });
  }

  private cancelTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
