import { describe, expect, it } from "vitest";

import { copyEventWithNewId, parseImportedEvent } from "./eventActions";

const exported = {
  id: "ev-1",
  name: " Bahn-DM 2026 ",
  slug: "bahn-dm-2026",
  activeRaceId: "race-1",
  ageGroups: [{ id: "ag-1", name: "U17", gender: "men", slug: "u17_men", eventId: "ev-1" }],
  races: [{ id: "race-1", eventId: "ev-1", name: "Final", raceResults: [], raceStarters: [], raceActivities: [] }],
  athletes: [{ id: "ath-1", bib: 7 }],
};

describe("parseImportedEvent", () => {
  it("accepts an exported event and trims the name", () => {
    const event = parseImportedEvent(exported);

    expect(event.id).toBe("ev-1");
    expect(event.name).toBe("Bahn-DM 2026");
    expect(event.races).toHaveLength(1);
    expect(event.athletes).toHaveLength(1);
  });

  it.each([
    ["no object", [1, 2]],
    ["missing id", { ...exported, id: "" }],
    ["missing name", { ...exported, name: "  " }],
    ["missing races", { ...exported, races: undefined }],
    ["missing athletes", { ...exported, athletes: null }],
  ])("rejects a file with %s", (_label, raw) => {
    expect(() => parseImportedEvent(raw)).toThrow();
  });
});

describe("copyEventWithNewId", () => {
  it("rewrites event id, name, slug and eventId references, keeps nested ids", () => {
    const copy = copyEventWithNewId(parseImportedEvent(exported), "ev-2", "Bahn-DM 2026 (Import)");

    expect(copy.id).toBe("ev-2");
    expect(copy.name).toBe("Bahn-DM 2026 (Import)");
    expect(copy.slug).toBe("bahn-dm-2026-import");
    expect(copy.races[0]).toMatchObject({ id: "race-1", eventId: "ev-2" });
    expect(copy.ageGroups[0]).toMatchObject({ id: "ag-1", eventId: "ev-2" });
    expect(copy.activeRaceId).toBe("race-1");
  });
});
