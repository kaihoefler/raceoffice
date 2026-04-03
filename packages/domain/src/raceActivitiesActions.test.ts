import { describe, expect, it } from "vitest";

import type {
  RaceActivity,
  RaceActivityDNF,
  RaceActivityDisqualfication,
  RaceActivityDns,
  RaceActivityPointsRemoval,
  RaceActivityPointsSprint,
} from "./raceactivities";

import { filterActivitiesByAllowedBibs, removeBibFromActivities } from "./raceActivitiesActions";

function pointsSprintActivity(id: string, lap: number, results: Array<{ bib: number; points: number }>): RaceActivityPointsSprint {
  return {
    id,
    createdAt: `${id}-createdAt`,
    type: "pointsSprint",
    data: {
      lap,
      isDeleted: false,
      results,
      history: [],
    },
  };
}

function pointsRemovalActivity(id: string, lap: number, bibs: number[]): RaceActivityPointsRemoval {
  return {
    id,
    createdAt: `${id}-createdAt`,
    type: "pointsRemoval",
    data: {
      lap,
      isDeleted: false,
      results: bibs.map((bib) => ({ bib })),
      history: [],
    },
  };
}

function eliminationActivity(id: string, lap: number, bibs: number[]): RaceActivityDNF {
  return {
    id,
    createdAt: `${id}-createdAt`,
    type: "DNF",
    data: {
      lap,
      dnfType: "elimination",
      isDeleted: false,
      results: bibs.map((bib) => ({ bib })),
      history: [],
    },
  };
}

function dnsActivity(id: string, bib: number): RaceActivityDns {
  return {
    id,
    createdAt: `${id}-createdAt`,
    type: "DNS",
    data: {
      bib,
      isDeleted: false,
      history: [],
    },
  };
}

function dsqActivity(id: string, bib: number): RaceActivityDisqualfication {
  return {
    id,
    createdAt: `${id}-createdAt`,
    type: "DSQ",
    data: {
      bib,
      isDeleted: false,
      history: [],
    },
  };
}

describe("raceActivitiesActions", () => {
  describe("filterActivitiesByAllowedBibs", () => {
    it("filters pointsRemoval results by allowed bibs and removes empty activities", () => {
      const activities: RaceActivity[] = [
        pointsRemovalActivity("pr-1", 7, [1, 2]),
        pointsRemovalActivity("pr-2", 7, [1]),
        pointsSprintActivity("ps-1", 8, [{ bib: 3, points: 2 }]),
        eliminationActivity("elim-1", 9, [2, 4]),
        dnsActivity("dns-1", 1),
        dsqActivity("dsq-1", 3),
      ];

      const next = filterActivitiesByAllowedBibs(activities, [2, 3]);

      expect(next.map((a) => a.id)).toEqual(["pr-1", "ps-1", "elim-1", "dsq-1"]);

      const pr1 = next.find((a) => a.id === "pr-1");
      expect(pr1?.type).toBe("pointsRemoval");
      expect((pr1 as RaceActivityPointsRemoval).data.results).toEqual([{ bib: 2 }]);

      const elim1 = next.find((a) => a.id === "elim-1");
      expect(elim1?.type).toBe("DNF");
      expect((elim1 as RaceActivityDNF).data.results).toEqual([{ bib: 2 }]);
    });
  });

  describe("removeBibFromActivities", () => {
    it("removes bib references from pointsRemoval and drops now-empty activities", () => {
      const activities: RaceActivity[] = [
        pointsRemovalActivity("pr-1", 5, [5, 6]),
        pointsSprintActivity("ps-1", 5, [{ bib: 6, points: 3 }]),
        dnsActivity("dns-1", 5),
        dsqActivity("dsq-1", 6),
      ];

      const next = removeBibFromActivities(activities, 6);

      // ps-1 and dsq-1 only referenced bib 6 -> removed.
      // pr-1 keeps bib 5.
      // dns-1 for bib 5 remains.
      expect(next.map((a) => a.id)).toEqual(["pr-1", "dns-1"]);

      const pr1 = next.find((a) => a.id === "pr-1") as RaceActivityPointsRemoval;
      expect(pr1.data.results).toEqual([{ bib: 5 }]);
    });
  });
});
