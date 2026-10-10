// FinishLineScoring: manual finish entry on the scoring page (rank field + bib field), without
// live feed. The rank is suggested (next free place), bibs are typed in finishing order.

import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { FullEvent } from "@raceoffice/domain";

import { eventDocs, race, TEST_EVENT_ID } from "../test/fixtures";
import { renderApp } from "../test/renderApp";

const rankField = () => screen.getByPlaceholderText("Rank");
const bibField = () => screen.getByPlaceholderText("Bib");

async function renderFinishTab() {
  const view = renderApp({
    route: "/races/r1/scoring",
    docs: eventDocs({ races: [race({ racemode: { isPointsRace: false, isEliminationRace: false }, starterBibs: [11, 12, 13] })] }),
  });
  await view.user.click(await screen.findByRole("tab", { name: "Finish" }));
  const finishRanks = () =>
    Object.fromEntries(
      (view.server.doc(`Event-${TEST_EVENT_ID}`).data as FullEvent).races[0]!.raceResults
        .filter((r) => r.finishRank > 0)
        .map((r) => [r.bib, r.finishRank]),
    );
  return { ...view, finishRanks };
}

describe("FinishLineScoring manual entry", () => {
  it("takes bibs in finishing order with the suggested rank", async () => {
    const { user, finishRanks } = await renderFinishTab();

    expect(rankField()).toHaveValue("1");
    expect(rankField()).toHaveAttribute("inputmode", "numeric");
    expect(rankField()).toHaveAttribute("pattern", "[0-9]*");

    await user.type(bibField(), "12{Enter}");
    await waitFor(() => expect(finishRanks()).toEqual({ 12: 1 }));
    expect(rankField()).toHaveValue("2");

    await user.type(bibField(), "11{Enter}");
    await waitFor(() => expect(finishRanks()).toEqual({ 12: 1, 11: 2 }));
    expect(rankField()).toHaveValue("3");
  });

  it("rejects a bib that already finished and accepts a rank typed by hand", async () => {
    const { user, finishRanks } = await renderFinishTab();

    await user.type(bibField(), "12{Enter}");
    await waitFor(() => expect(finishRanks()).toEqual({ 12: 1 }));

    await user.clear(bibField());
    await user.type(bibField(), "12{Enter}");
    expect(await screen.findByText("Startnummer 12 ist bereits in der Finisher-Liste")).toBeInTheDocument();

    // Rank by hand: Enter in the rank field moves on to the bib field.
    await user.clear(bibField());
    await user.clear(rankField());
    await user.type(rankField(), "5{Enter}");
    await waitFor(() => expect(bibField()).toHaveFocus());
    await user.keyboard("13{Enter}");
    await waitFor(() => expect(finishRanks()).toEqual({ 12: 1, 13: 5 }));
  });
});
