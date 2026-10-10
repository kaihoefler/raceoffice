// Actions and checks on the scoring page, in the vocabulary of the scenario tables
// ("activate sync", "switch to DNS", "2 P prefilled with 148", "save").
// Queries use roles, labels and placeholders only, so they survive MUI upgrades.

import { screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { expect } from "vitest";

export type PointsPlace = "3 P" | "2 P" | "1 P";
export type EliminationMode = "1 Elim" | "2 Elim" | "DNF" | "DNS" | "DSQ";

export function scoringPage(user: UserEvent) {
  /** Bib input of the elimination tab, row 1..n (rows grow in DNF/DNS/DSQ mode). */
  const bibRow = (row: number) => screen.getByPlaceholderText<HTMLInputElement>(row === 1 ? "Bib" : `Bib ${row}`);
  const pointsField = (place: PointsPlace) => screen.getByRole<HTMLInputElement>("combobox", { name: `${place} bib` });
  const lapField = () => screen.getByRole<HTMLInputElement>("spinbutton", { name: "Lap" });

  return {
    bibRow,
    pointsField,
    lapField,

    /** "Create New Race" in the live status box; optionally switch the race type to points. */
    async createRaceFromLive({ asPointsRace = false } = {}) {
      await user.click(await screen.findByRole("button", { name: "Create New Race" }));
      const dialog = await screen.findByRole("dialog");
      if (asPointsRace) {
        const points = within(dialog).getByRole("checkbox", { name: "Points" });
        const elimination = within(dialog).getByRole("checkbox", { name: "Elimination" });
        if (!(points as HTMLInputElement).checked) await user.click(points);
        if ((elimination as HTMLInputElement).checked) await user.click(elimination);
      }
      await user.click(within(dialog).getByRole("button", { name: "Create" }));
    },

    async activateSync() {
      await user.click(await screen.findByRole("button", { name: "Activate Sync" }));
    },

    async tab(name: "Points" | "Finish" | "Elimination") {
      await user.click(screen.getByRole("tab", { name }));
    },

    async eliminationMode(mode: EliminationMode) {
      await user.click(screen.getByRole("button", { name: mode }));
    },

    async save() {
      await user.click(screen.getByRole("button", { name: "Save" }));
    },

    /** Elimination tab: rows 1..n hold exactly these bibs (in this order). */
    expectBibRows(...bibs: number[]) {
      return waitFor(() => expect(bibs.map((_, i) => bibRow(i + 1).value)).toEqual(bibs.map(String)));
    },

    /** Points tab: the given places hold these bibs. */
    expectPoints(expected: Partial<Record<PointsPlace, number>>) {
      return waitFor(() => {
        for (const [place, bib] of Object.entries(expected)) {
          expect(pointsField(place as PointsPlace).value, place).toBe(String(bib));
        }
      });
    },

    expectLap(lap: number) {
      return waitFor(() => expect(lapField().value).toBe(String(lap)));
    },

    /** Replaces the content of a bib field by typing (manual override of a prefill). */
    async typeBib(field: HTMLInputElement, bib: number) {
      await user.clear(field);
      await user.type(field, String(bib));
    },
  };
}
