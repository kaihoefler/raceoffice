import { describe, expect, it } from "vitest";

import { abbreviateLiveTrackingDisplayName, resolveLiveTrackingDisplayName } from "./liveTrackingDisplayName";

describe("resolveLiveTrackingDisplayName", () => {
  it("returns pure transponder id for unknown:transponder synthetic athlete", () => {
    const name = resolveLiveTrackingDisplayName({
      row: {
        athleteId: "unknown:transponder:GV-21077",
        firstName: "",
        lastName: "GV-21077",
        bib: null,
        nation: null,
        transponderId: "GV-21077",
        activityStatus: "active",
        isActive: true,
        lastPassingAt: "2026-01-01T10:00:00.000Z",
        lapsCompleted: 0,
        currentLapSplits: [],
        recentLapTimesMs: [],
        completedLaps: [],
        lastLapTimeMs: null,
        bestLapTimeMs: null,
      },
      participantNameByAthleteId: new Map(),
      participantNameByTransponderId: new Map(),
    });

    expect(name).toBe("GV-21077");
  });

  it("uses known participant name before fallback logic", () => {
    const name = resolveLiveTrackingDisplayName({
      row: {
        athleteId: "ath-1",
        firstName: "",
        lastName: "",
        bib: null,
        nation: null,
        transponderId: "T-1",
        activityStatus: "active",
        isActive: true,
        lastPassingAt: "2026-01-01T10:00:00.000Z",
        lapsCompleted: 0,
        currentLapSplits: [],
        recentLapTimesMs: [],
        completedLaps: [],
        lastLapTimeMs: null,
        bestLapTimeMs: null,
      },
      participantNameByAthleteId: new Map([["ath-1", "Max Mustermann"]]),
      participantNameByTransponderId: new Map(),
    });

    expect(name).toBe("Max Mustermann");
  });
});

describe("abbreviateLiveTrackingDisplayName", () => {
  it("keeps short names unchanged", () => {
    expect(abbreviateLiveTrackingDisplayName("Liv Andersen", "Liv")).toBe("Liv Andersen");
  });

  it("reduces multi-part and hyphenated first names to initials when too long", () => {
    expect(abbreviateLiveTrackingDisplayName("Ava Sophie Diaz Heidrich", "Ava Sophie")).toBe("A. S. Diaz Heidrich");
    expect(abbreviateLiveTrackingDisplayName("Anna-Lena Grolleau Ngoma", "Anna-Lena")).toBe("A.-L. Grolleau Ngoma");
  });

  it("leaves names untouched that do not start with the first name", () => {
    expect(abbreviateLiveTrackingDisplayName("unknown:transponder:LG-74117", "")).toBe("unknown:transponder:LG-74117");
    expect(abbreviateLiveTrackingDisplayName("Grolleau Ngoma Nioundou Hanna", "Hanna")).toBe("Grolleau Ngoma Nioundou Hanna");
  });
});
