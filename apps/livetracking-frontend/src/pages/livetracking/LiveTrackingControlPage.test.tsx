// LiveTrackingControlPage: the setup editor (track, timing points, simulation) of the tracking
// setup selected in the session. Covers the inputs with native attributes (min/step, inputMode,
// readOnly) that a MUI upgrade moves between props and slots, and that edits reach the document.

import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  createLiveTrackingParticipantPoolDocument,
  createLiveTrackingRuntimeDocument,
  createLiveTrackingSessionDocument,
  createLiveTrackingSetupDocument,
  makeLiveTrackingParticipantPoolDocId,
  makeLiveTrackingRuntimeDocId,
  makeLiveTrackingSessionDocId,
  makeLiveTrackingSetupDocId,
  type LiveTrackingRuntimePassingEvent,
  type LiveTrackingSetupDocument,
  type LiveTrackingTimingPoint,
} from "@raceoffice/domain";

import { renderApp } from "../../test/renderApp";

const SETUP_DOC_ID = makeLiveTrackingSetupDocId("s1");

function point(overrides: Partial<LiveTrackingTimingPoint>): LiveTrackingTimingPoint {
  return {
    id: "p1",
    name: "Finish",
    decoderIp: "10.0.0.1",
    websocketPortAMM: 9000,
    decoderType: "amb",
    decoderTimestampOffsetSecs: 0,
    order: 1,
    distanceFromPreviousM: 0,
    absolutePositionM: 0,
    role: "start_finish",
    enabled: true,
    ...overrides,
  };
}

function renderSetupEditor({ docs = {}, activeParticipantPoolIds }: { docs?: Record<string, unknown>; activeParticipantPoolIds?: string[] } = {}) {
  const setup: LiveTrackingSetupDocument = {
    ...createLiveTrackingSetupDocument({ setupId: "s1", name: "Test track" }),
    ...(activeParticipantPoolIds ? { activeParticipantPoolIds } : {}),
    track: {
      id: "t1",
      name: "Oval",
      lengthM: 200,
      timingPoints: [
        point({ id: "p1", name: "Finish" }),
        point({ id: "p2", name: "Back straight", decoderType: "sim", order: 2, distanceFromPreviousM: 100, absolutePositionM: 100, role: "split" }),
      ],
    },
  };
  const view = renderApp({
    route: "/live-tracking/setup",
    docs: {
      [makeLiveTrackingSessionDocId()]: createLiveTrackingSessionDocument({ setupId: "s1", eventId: "" }),
      [SETUP_DOC_ID]: setup,
      ...docs,
    },
  });
  const storedSetup = () => view.server.doc(SETUP_DOC_ID).data as LiveTrackingSetupDocument;
  return { ...view, storedSetup };
}

describe("LiveTrackingControlPage setup editor", () => {
  it("edits the minimum lap time and a decoder time offset and saves them to the setup document", async () => {
    const { user, storedSetup } = renderSetupEditor();

    const minLap = await screen.findByRole("spinbutton", { name: "Min. Lap Time (s)" });
    expect(minLap).toHaveValue(8);
    expect(minLap).toHaveAttribute("min", "1");
    expect(minLap).toHaveAttribute("step", "1");
    await user.type(minLap, "12", { initialSelectionStart: 0, initialSelectionEnd: 1 });
    expect(minLap).toHaveValue(12);

    const offset = screen.getAllByRole("textbox", { name: "Time Offset (s)" })[0]!;
    expect(offset).toHaveAttribute("inputmode", "decimal");
    expect(offset).toHaveAttribute("placeholder", "z. B. -1,234");
    // Only signed decimals with "." or "," get through; on blur the value is normalized.
    await user.type(offset, "-1,25x", { initialSelectionStart: 0, initialSelectionEnd: 1 });
    expect(offset).toHaveValue("-1,25");
    await user.tab();
    expect(offset).toHaveValue("-1.25");

    await user.click(screen.getByRole("button", { name: "Save Setup Document" }));

    await waitFor(() => expect(storedSetup().minLapTimeSecs).toBe(12));
    expect(storedSetup().track.timingPoints.find((p) => p.id === "p1")?.decoderTimestampOffsetSecs).toBe(-1.25);
  });

  it("renders the debug document JSON only while its accordion is expanded", async () => {
    const { user } = renderSetupEditor();

    const setupToggle = await screen.findByRole("button", { name: "Setup Document" });
    expect(setupToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/"name": "Test track"/)).not.toBeInTheDocument();

    await user.click(setupToggle);
    expect(await screen.findByText(/"name": "Test track"/)).toBeInTheDocument();

    await user.click(setupToggle);
    await waitFor(() => expect(screen.queryByText(/"name": "Test track"/)).not.toBeInTheDocument());
  });

  it("lists the last 20 passings per decoder, newest first, with athlete name or transponder", async () => {
    const passing = (n: number, timingPointId: string, transponderId: string): LiveTrackingRuntimePassingEvent => ({
      id: `${timingPointId}-${n}`,
      timestamp: new Date(Date.UTC(2026, 9, 10, 10, 0, n)).toISOString(),
      transponderId,
      timingPointId,
      decoderId: "d",
    });
    // 25 passings at the finish (only the last 20 show), one at the back straight.
    const passings = [
      ...Array.from({ length: 25 }, (_, n) => passing(n, "p1", n === 24 ? "111" : "999")),
      passing(30, "p2", "222"),
    ];
    const pool = {
      ...createLiveTrackingParticipantPoolDocument({ poolId: "pool1" }),
      athletes: [{ id: "a1", bib: 1, firstName: "Anna", lastName: "Alpha", nation: null, ageGroupId: null, transponderIds: ["111"] }],
    };
    const { user } = renderSetupEditor({
      activeParticipantPoolIds: ["pool1"],
      docs: {
        [makeLiveTrackingRuntimeDocId()]: { ...createLiveTrackingRuntimeDocument(), recentPassings: passings },
        [makeLiveTrackingParticipantPoolDocId("pool1")]: pool,
      },
    });

    const toggle = await screen.findByRole("button", { name: /Passing Log/ });
    expect(screen.queryByRole("table", { name: "Passings Finish (10.0.0.1)" })).not.toBeInTheDocument();
    await user.click(toggle);

    const finish = await screen.findByRole("table", { name: "Passings Finish (10.0.0.1)" });
    const finishRows = within(finish).getAllByRole("row").slice(1);
    expect(finishRows).toHaveLength(20);
    // Newest first; known transponder shows the athlete (plus transponder), unknown the transponder.
    expect(finishRows[0]).toHaveTextContent("Anna Alpha111");
    expect(finishRows[1]).toHaveTextContent("999");

    const backStraight = screen.getByRole("table", { name: "Passings Back straight (10.0.0.1)" });
    expect(within(backStraight).getAllByRole("row")).toHaveLength(2);
    expect(within(backStraight).getByText("222")).toBeInTheDocument();
  });

  it("shows the derived simulator delays of a simulated timing point read-only", async () => {
    renderSetupEditor();

    const passingDelay = await screen.findByRole("textbox", { name: "Passing Delay (ms)" });
    const startupDelay = screen.getByRole("textbox", { name: "Startup Delay (s)" });
    expect(passingDelay).toHaveAttribute("readonly");
    expect(startupDelay).toHaveAttribute("readonly");
    expect(passingDelay).not.toHaveValue("");
    expect(startupDelay).not.toHaveValue("");
  });
});
