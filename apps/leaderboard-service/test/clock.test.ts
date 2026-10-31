/**
 * Heartbeat time of day on the race stream: keeps running after Orbits resets ($I), while the
 * feed (and REST) still shows the finished race with its frozen time of day.
 */
import { describe, expect, it } from "vitest";
import type { LeaderboardWsMessage } from "@raceoffice/domain";
import { parseLine, RaceStateStore } from "@raceoffice/rmonitor";
import { SnapshotPublisher } from "../src/publisher.js";

describe("heartbeat time of day", () => {
  it("keeps running while the previous race is shown", () => {
    let store = new RaceStateStore();
    const publisher = new SnapshotPublisher(() => store, () => 0);
    const messages: LeaderboardWsMessage[] = [];
    publisher.subscribe("current", (m) => messages.push(m));

    const feed = (line: string) => {
      const msg = parseLine(line);
      if (store.apply(msg).changed) publisher.notify({ heartbeat: msg.kind === "heartbeat" });
    };
    feed(`$B,7,"Junior Men 500+D Sprint"`);
    feed(`$F,0,"00:00:00","13:06:26","00:00:46","Finish"`);
    feed(`$I,"13:06:30","20 Apr 24"`);
    const afterReset = messages.at(-1)!;
    feed(`$F,0,"00:00:00","13:15:38","00:00:00","      "`);
    const later = messages.at(-1)!;

    expect(afterReset).toMatchObject({ timeOfDay: "13:06:26" }); // no "0:00" before the first heartbeat
    expect(later.type).toBe("patch");
    expect(later).toMatchObject({ raceId: 7, timeOfDay: "13:15:38" });
    // The race data itself (scoring/REST format) still shows the finished race.
    expect(store.displayRace.id).toBe(7);
    expect(later.type === "patch" && later.patch).toEqual([]);
    store = new RaceStateStore();
  });
});
