// Scenario: real elimination race, scored state by state on the scoring page.
//
// Source of truth: elimination-agi-2024-cadet-men-final-b.md (same folder). Each `state(n)`
// below is row n of that table: the timing system reports the recorded state n, then the
// test performs the official's actions from the "Erwartung" column.
//
// What it guards:
// - creating the race from the live feed (name, starters)
// - live sync of the elimination tab: which riders the app PREFILLS (last eligible riders,
//   DNS candidates from lap 2) — the expected prefills were agreed with the race office,
//   including the two states where the officials overrode the proposal (17, 27)
// - that every decision is stored as the right race activity, and the finish order is taken
//   over from the feed

import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { FullEvent } from "@raceoffice/domain";
import { feedStep } from "@raceoffice/test-utils";

import { eventDocs, race, TEST_EVENT_ID } from "../fixtures";
import { renderApp } from "../renderApp";
import { RACE_NAME, scenarioStates } from "./agiCadetMenFinalB";

describe(`scenario: ${RACE_NAME} (elimination, live sync)`, () => {
  it("scores the race state by state as agreed with the race office", { timeout: 60_000 }, async () => {
    const states = scenarioStates();
    const { feed, server, user } = renderApp({
      route: "/races/prev/scoring",
      docs: eventDocs({ races: [race({ id: "prev", name: "Cadet Men 6000 Elim-Final A" })] }),
    });

    const state = (n: number) => feedStep(feed, states[n - 1]!);
    const bibField = (row: number) => screen.getByPlaceholderText<HTMLInputElement>(row === 1 ? "Bib" : `Bib ${row}`);
    const expectPrefilled = (...bibs: number[]) =>
      waitFor(() => expect(bibs.map((_, i) => bibField(i + 1).value)).toEqual(bibs.map(String)));
    const mode = (label: "1 Elim" | "2 Elim" | "DNS" | "DSQ") => user.click(screen.getByRole("button", { name: label }));
    const save = () => user.click(screen.getByRole("button", { name: "Save" }));
    const overrideWith = async (bib: number) => {
      await user.clear(bibField(1));
      await user.type(bibField(1), String(bib));
    };

    // 1 (PURPLE): create the race from the live feed
    await state(1);
    await user.click(await screen.findByRole("button", { name: "Create New Race" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(await screen.findByText(`Scoring • ${RACE_NAME}`)).toBeInTheDocument();

    // 2 (GREEN, lap 0): activate sync, work in the elimination tab
    await state(2);
    await user.click(await screen.findByRole("button", { name: "Activate Sync" }));
    await user.click(screen.getByRole("tab", { name: "Elimination" }));

    // 3-4: passing at the start recorded and deleted by the timekeepers (lap 1 -> 0)
    await state(3);
    await state(4);

    // 5 (lap 1): switch to DNS; no DNS proposal before lap 2
    await state(5);
    await mode("DNS");
    await waitFor(() => expect(bibField(1).value).toBe(""));

    // 6 (lap 2): riders without a lap are prefilled as DNS
    await state(6);
    await expectPrefilled(123, 145, 146);
    await save();

    await state(7);

    // 8 (lap 4): two eliminations, as proposed
    await state(8);
    await mode("2 Elim");
    await expectPrefilled(89, 151);
    await save();

    await state(9);

    // 10-11: one elimination per state, as proposed
    await state(10);
    await mode("1 Elim");
    await expectPrefilled(101);
    await save();

    await state(11);
    await expectPrefilled(150);
    await save();

    // 12: 95 disqualified (entered by hand)
    await state(12);
    await mode("DSQ");
    await user.type(bibField(1), "95");
    await save();
    await mode("1 Elim");

    await state(13);
    await expectPrefilled(139);
    await save();

    await state(14);

    await state(15);
    await expectPrefilled(88);
    await save();

    await state(16);

    // 17: the app proposes 115, the officials eliminate 133
    await state(17);
    await expectPrefilled(115);
    await overrideWith(133);
    await save();

    await state(18);

    await state(19);
    await expectPrefilled(115);
    await save();

    await state(20);

    await state(21);
    await expectPrefilled(137);
    await save();

    await state(22);

    await state(23);
    await expectPrefilled(135);
    await save();

    await state(24);
    await state(25);
    await state(26);

    // 27: the app proposes 104, the officials eliminate 142
    await state(27);
    await expectPrefilled(104);
    await overrideWith(142);
    await save();

    await state(28);

    await state(29);
    await expectPrefilled(104);
    await save();

    await state(30);

    for (const [n, bib] of [
      [31, 114],
      [32, 148],
      [33, 96],
    ] as const) {
      await state(n);
      await expectPrefilled(bib);
      await save();
    }

    // 34 (GREEN, final order): nothing to do
    await state(34);

    // 35 (FINISH): take over the finish order from the feed
    await state(35);
    await user.click(screen.getByRole("tab", { name: "Finish" }));
    await user.click(await screen.findByRole("button", { name: "Fill from Live" }));

    // Sync stays on at FINISH; it only goes off when the timing system moves on to another race.
    expect(screen.getByRole("button", { name: "Activate Sync" })).toHaveAttribute("aria-pressed", "true");
    await feedStep(feed, { ...states[34]!, raceID: states[34]!.raceID + 1, raceName: "Next Race", flagStatus: "PURPLE" });
    expect(await screen.findByText("Next Race")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Activate Sync" })).toHaveAttribute("aria-pressed", "false"));

    // ---- What was stored ----
    await waitFor(() => {
      const event = server.doc(`Event-${TEST_EVENT_ID}`).data as FullEvent;
      const created = event.races.find((r) => r.name === RACE_NAME);
      expect(created?.raceResults.some((r) => r.finishRank > 0)).toBe(true);
    });

    const event = server.doc(`Event-${TEST_EVENT_ID}`).data as FullEvent;
    const created = event.races.find((r) => r.name === RACE_NAME)!;
    const finalState = states[34]!;

    expect(created.raceStarters.map((a) => a.bib).sort((a, b) => a! - b!)).toEqual(
      finalState.competitors.map((c) => Number(c.number)).sort((a, b) => a - b),
    );

    const activities = created.raceActivities.filter((a: any) => !a.data?.isDeleted) as any[];
    expect(activities.filter((a) => a.type === "DNS").map((a) => a.data.bib)).toEqual([123, 145, 146]);
    expect(activities.filter((a) => a.type === "DSQ").map((a) => a.data.bib)).toEqual([95]);
    expect(
      activities.filter((a) => a.type === "DNF" && a.data.dnfType === "elimination").map((a) => [a.data.lap, a.data.results.map((r: any) => r.bib)]),
    ).toEqual([
      [4, [89, 151]],
      [6, [101]],
      [7, [150]],
      [9, [139]],
      [11, [88]],
      [13, [133]],
      [15, [115]],
      [17, [137]],
      [19, [135]],
      [23, [142]],
      [25, [104]],
      [27, [114]],
      [28, [148]],
      [29, [96]],
    ]);

    // Finish order taken over from the feed: riders who completed all laps rank by live position.
    const finishers = finalState.competitors.filter((c) => c.lapsComplete === finalState.lapsComplete);
    for (const c of finishers) {
      expect(created.raceResults.find((r) => r.bib === Number(c.number))?.finishRank).toBe(c.position);
    }
  });
});
