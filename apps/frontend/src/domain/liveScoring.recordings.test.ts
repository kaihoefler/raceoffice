// Runs every state of every recorded real race (packages/race-status-mock/recordings/*.jsonl)
// through the live scoring rules and checks properties that must hold for ANY feed state.
// Targeted cases live in liveScoring.test.ts; this test catches constellations from real
// races nobody wrote a case for. New recordings are picked up automatically.

import { describe, expect, it } from "vitest";
import type { Race, RaceStatusRace } from "@raceoffice/domain";
import { racesOf } from "@raceoffice/race-status-mock";
import { listRecordings, loadRecording } from "@raceoffice/race-status-mock/server";
import { deriveLiveScoring, suggestDnfGroup } from "./liveScoring";

const recordings = listRecordings();

/** The race as RaceOffice would know it: every rider of the feed registered as starter. */
function raceFromFeed(live: RaceStatusRace): Race {
  return {
    id: String(live.raceID),
    name: live.raceName,
    slug: "",
    racemode: { isPointsRace: false, isEliminationRace: true },
    stage: "",
    stage_value: "",
    distance_value: "",
    ageGroupId: null,
    eventId: "",
    raceStarters: live.competitors.map((c) => ({
      id: c.number, bib: Number(c.number), firstName: c.firstName, lastName: c.lastName, ageGroupId: null, nation: null,
    })),
    raceResults: [],
    raceActivities: [],
  } as unknown as Race;
}

describe.skipIf(recordings.length === 0)("live scoring invariants over recorded races", () => {
  it.each(recordings.map((file) => [file.split(/[\\/]/).pop() ?? file, file]))("%s", (_name, file) => {
    const states = racesOf(loadRecording(file)).filter((r): r is RaceStatusRace => r != null);

    for (const live of states) {
      const result = deriveLiveScoring(raceFromFeed(live), live);

      for (const bib of suggestDnfGroup(result.lappedIndicationByBib).bibs) expect(result.liveBibs.has(bib)).toBe(true);
      for (const bib of [result.liveLastEligibleBibs.lastBib, result.liveLastEligibleBibs.secondLastBib]) {
        if (bib != null) expect(result.liveBibs.has(bib)).toBe(true);
      }
      for (const gap of result.lappedIndicationByBib.values()) expect(gap).toBeGreaterThanOrEqual(1);
      for (const bib of result.lappedIndicationBibs) expect(result.lappedIndicationByBib.get(bib)).toBeGreaterThanOrEqual(2);
      expect(result.unknownLiveBibs.size).toBe(0);
    }
    // Note: lap counts are NOT monotonic in real feeds. At the start a finish-line passing can
    // be recorded by mistake (riders at lap 1 seconds after the start); the timekeepers delete
    // it manually and the feed drops back to lap 0 (seen in the AGI Cadet Men 6000 Elim-Final B
    // recording). The rules evaluate each state on its own, so they do not depend on monotonic laps.
  });
});
