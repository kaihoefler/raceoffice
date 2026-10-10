// Scenario: the same real race interpreted as a points race, scored state by state.
//
// Source of truth: points-agi-2024-cadet-men-final-b.md (same folder). Each `state(n)` is row
// n of that table: the timing system reports state n, then the test performs the actions from
// the "Erwartung" column.
//
// What it guards:
// - creating a points race from the live feed (race type changed in the dialog)
// - live sync of the points tab: lap and sprint prefill (P1 -> 2 P, P2 -> 1 P; in the final
//   sprint, at 0 laps to go, P1..P3 -> 3/2/1 P), swapping 2 P/1 P, manual entry
// - DNF proposals in the elimination tab: group furthest behind, DNF lap derived from the
//   lap deficit; DNS from lap 2; DSQ by hand
// - all decisions stored as race activities, finish order taken over from the feed

import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { FullEvent } from "@raceoffice/domain";
import { feedStep } from "@raceoffice/test-utils";

import { eventDocs, race, TEST_EVENT_ID } from "../fixtures";
import { renderApp } from "../renderApp";
import { RACE_NAME, scenarioStates } from "./agiCadetMenFinalB";
import { scoringPage } from "./scoringPage";

describe(`scenario: ${RACE_NAME} as points race (live sync)`, () => {
  it("scores the race state by state as agreed with the race office", { timeout: 90_000 }, async () => {
    const states = scenarioStates();
    const { feed, server, user } = renderApp({
      route: "/races/prev/scoring",
      docs: eventDocs({ races: [race({ id: "prev", name: "Cadet Men 6000 Points-Final A" })] }),
    });
    const page = scoringPage(user);
    const state = (n: number) => feedStep(feed, states[n - 1]!);

    /** Lap sprint: the prefill must match, then save. */
    const sprint = async (twoP: number, oneP: number) => {
      await page.expectPoints({ "2 P": twoP, "1 P": oneP });
      await page.save();
    };

    /** DNF groups in the elimination tab, each prefilled with its DNF lap, then back to points. */
    const dnf = async (...groups: Array<{ bibs: number[]; lap: number }>) => {
      await page.tab("Elimination");
      await page.eliminationMode("DNF");
      for (const g of groups) {
        await page.expectBibRows(...g.bibs);
        await page.expectLap(g.lap);
        await page.save();
      }
      await page.tab("Points");
    };

    // 1 (PURPLE): create the race from live, race type points
    await state(1);
    await page.createRaceFromLive({ asPointsRace: true });
    expect(await screen.findByText(`Scoring • ${RACE_NAME}`)).toBeInTheDocument();

    // 2: activate sync, work in the points tab
    await state(2);
    await page.activateSync();
    await page.tab("Points");

    await state(3);
    await state(4);
    await state(5);

    // 6 (lap 2): DNS prefilled in the elimination tab
    await state(6);
    await page.tab("Elimination");
    await page.eliminationMode("DNS");
    await page.expectBibRows(123, 145, 146);
    await page.save();
    await page.tab("Points");

    await state(7);
    await state(8);
    await state(9);

    await state(10);
    await page.expectLap(6);
    await sprint(148, 143);

    await state(11);

    await state(12);
    await sprint(149, 135);

    // 13: two DNF groups, furthest behind first
    await state(13);
    await dnf({ bibs: [89, 151], lap: 3 }, { bibs: [101, 150], lap: 5 });

    // 14: prefill 142 / 148, places swapped before saving
    await state(14);
    await page.expectPoints({ "2 P": 142, "1 P": 148 });
    await user.click(screen.getByRole("button", { name: "Swap 2P and 1P" }));
    await sprint(148, 142);

    // 15: 139 disqualified (entered by hand)
    await state(15);
    await page.tab("Elimination");
    await page.eliminationMode("DSQ");
    await user.type(page.bibRow(1), "139");
    await page.save();
    await page.tab("Points");

    await state(16);
    await sprint(152, 154);

    await state(17);
    await dnf({ bibs: [95], lap: 8 }, { bibs: [88], lap: 11 });

    await state(18);
    await sprint(149, 117);

    await state(19);

    // 20: prefill 148 / 152, officials award 152 / 154 (entered by hand)
    await state(20);
    await page.expectPoints({ "2 P": 148, "1 P": 152 });
    await page.typeBib(page.pointsField("1 P"), 154);
    await page.typeBib(page.pointsField("2 P"), 152);
    await page.expectPoints({ "2 P": 152, "1 P": 154 });
    await page.save();

    await state(21);

    await state(22);
    await sprint(149, 143);

    await state(23);

    await state(24);
    await sprint(149, 117);

    await state(25);
    await dnf({ bibs: [115, 133], lap: 13 }, { bibs: [137], lap: 17 }, { bibs: [135], lap: 19 });

    await state(26);
    await sprint(154, 153);

    await state(27);

    await state(28);
    await sprint(148, 143);

    await state(29);

    await state(30);
    await sprint(141, 143);

    await state(31);

    await state(32);
    await sprint(149, 143);

    await state(33);
    await dnf({ bibs: [142], lap: 24 }, { bibs: [104], lap: 25 }, { bibs: [114], lap: 26 }, { bibs: [148], lap: 28 });

    // 34 (GREEN, 0 laps to go): final sprint with three places, last DNF
    await state(34);
    await page.expectPoints({ "3 P": 117, "2 P": 154, "1 P": 143 });
    await page.save();
    await dnf({ bibs: [96], lap: 29 });

    // 35 (FINISH): take over the finish order from the feed
    await state(35);
    await page.tab("Finish");
    await user.click(await screen.findByRole("button", { name: "Fill from Live" }));

    // ---- What was stored ----
    const createdRace = () => (server.doc(`Event-${TEST_EVENT_ID}`).data as FullEvent).races.find((r) => r.name === RACE_NAME)!;
    await waitFor(() => expect(createdRace().raceResults.some((r) => r.finishRank > 0)).toBe(true));
    const created = createdRace();

    expect(created.racemode).toEqual({ isPointsRace: true, isEliminationRace: false });

    const activities = created.raceActivities.filter((a: any) => !a.data?.isDeleted) as any[];
    expect(activities.filter((a) => a.type === "DNS").map((a) => a.data.bib)).toEqual([123, 145, 146]);
    expect(activities.filter((a) => a.type === "DSQ").map((a) => a.data.bib)).toEqual([139]);
    expect(
      activities.filter((a) => a.type === "DNF").map((a) => [a.data.lap, a.data.dnfType, a.data.results.map((r: any) => r.bib)]),
    ).toEqual([
      [3, "dnf", [89, 151]],
      [5, "dnf", [101, 150]],
      [8, "dnf", [95]],
      [11, "dnf", [88]],
      [13, "dnf", [115, 133]],
      [17, "dnf", [137]],
      [19, "dnf", [135]],
      [24, "dnf", [142]],
      [25, "dnf", [104]],
      [26, "dnf", [114]],
      [28, "dnf", [148]],
      [29, "dnf", [96]],
    ]);
    expect(
      activities.filter((a) => a.type === "pointsSprint").map((a) => [a.data.lap, a.data.results.map((r: any) => `${r.bib}:${r.points}`)]),
    ).toEqual([
      [6, ["148:2", "143:1"]],
      [8, ["149:2", "135:1"]],
      [10, ["148:2", "142:1"]],
      [12, ["152:2", "154:1"]],
      [14, ["149:2", "117:1"]],
      [16, ["152:2", "154:1"]],
      [18, ["149:2", "143:1"]],
      [20, ["149:2", "117:1"]],
      [22, ["154:2", "153:1"]],
      [24, ["148:2", "143:1"]],
      [26, ["141:2", "143:1"]],
      [28, ["149:2", "143:1"]],
      [30, ["117:3", "154:2", "143:1"]],
    ]);

    // Finish order taken over from the feed: riders who completed all laps rank by live position.
    const finalState = states[34]!;
    for (const c of finalState.competitors.filter((c) => c.lapsComplete === finalState.lapsComplete)) {
      expect(created.raceResults.find((r) => r.bib === Number(c.number))?.finishRank).toBe(c.position);
    }
  });
});
