// Start Signal, Lap Counter and Finish Line Log with the real app shell; the service is a fake WebSocket.

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LeaderboardPassing } from "@raceoffice/domain";
import { App } from "../App";
import { FakeSocket, installFakes, race } from "./fakes";

function renderAt(route: string) {
  render(
    <MemoryRouter initialEntries={[route]}>
      <App />
    </MemoryRouter>,
  );
}

const socket = async (path: string) => {
  await waitFor(() => expect(FakeSocket.find(path)).toBeDefined());
  return FakeSocket.find(path)!;
};

const passing = (overrides: Partial<LeaderboardPassing> = {}): LeaderboardPassing => ({
  seq: 1,
  raceId: 12,
  regNumber: "17",
  number: "17",
  firstName: "Max",
  lastName: "Muster (GER)",
  timeOfDay: "14:03:10",
  elapsedTime: "4:00",
  crossingMs: 251_532,
  lapTime: "0:21.310",
  totalTime: "4:11.532",
  lap: 7,
  position: 1,
  ...overrides,
});

beforeEach(() => {
  localStorage.clear();
  installFakes();
});
afterEach(() => vi.unstubAllGlobals());

describe("start signal", () => {
  it("shows the start line-up during PURPLE, START right after the start and FINISH at the end", async () => {
    renderAt("/start-signal");
    const ws = await socket("/ws/race/current");
    ws.emit({ type: "snapshot", raceId: 12, rev: 1, data: race({ flagStatus: "PURPLE", elapsedTime: "0:00" }) });

    const grid = await screen.findByLabelText("Startaufstellung");
    expect(within(grid).getAllByText(/^\d+$/).map((e) => e.textContent)).toEqual(["5", "17", "23"]);
    expect(screen.getByRole("heading", { name: "Elimination U17m" })).toBeInTheDocument();

    ws.emit({ type: "snapshot", raceId: 12, rev: 2, data: race({ flagStatus: "GREEN", elapsedTime: "0:02" }) });
    expect(await screen.findByText("START")).toBeInTheDocument();
    expect(screen.getByLabelText("Rennzeit")).toHaveTextContent("0:02");

    ws.emit({ type: "snapshot", raceId: 12, rev: 3, data: race({ flagStatus: "GREEN", elapsedTime: "0:30" }) });
    await waitFor(() => expect(screen.queryByText("START")).not.toBeInTheDocument());

    ws.emit({ type: "snapshot", raceId: 12, rev: 4, data: race({ flagStatus: "FINISH" }) });
    expect(await screen.findByRole("region", { name: "Startsignal FINISH" })).toBeInTheDocument();
    expect(screen.getByText("FINISH")).toBeInTheDocument();
  });
});

describe("lap counter", () => {
  it("shows laps to go, switches only after the delay and announces the last lap", async () => {
    renderAt("/lap-counter?delay=1");
    const ws = await socket("/ws/race/current");
    ws.emit({ type: "snapshot", raceId: 12, rev: 1, data: race({ lapsToGo: 2, lapsComplete: 18 }) });
    // The first value appears immediately.
    expect(await screen.findByLabelText("Runden noch")).toHaveTextContent("2");

    ws.emit({ type: "snapshot", raceId: 12, rev: 2, data: race({ lapsToGo: 1, lapsComplete: 19 }) });
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.getByLabelText("Runden noch")).toHaveTextContent("2");
    await waitFor(() => expect(screen.getByLabelText("Runden noch")).toHaveTextContent("1"), { timeout: 2000 });
    expect(screen.getByText("LAST LAP")).toBeInTheDocument();
  });

  it("counts completed laps with ?mode=up and shows FINISH", async () => {
    renderAt("/lap-counter?mode=up&delay=0");
    const ws = await socket("/ws/race/current");
    ws.emit({ type: "snapshot", raceId: 12, rev: 1, data: race() });
    expect(await screen.findByLabelText("Runden gefahren")).toHaveTextContent("7");
    ws.emit({ type: "snapshot", raceId: 12, rev: 2, data: race({ flagStatus: "FINISH" }) });
    expect(await screen.findByText("FINISH")).toBeInTheDocument();
  });
});

describe("finish line log", () => {
  it("lists passings newest first, applies updates and marks photo-finish corrections", async () => {
    renderAt("/finish-line-log");
    const ws = await socket("/ws/race/current/passings");
    ws.emit({
      type: "passings",
      raceId: 12,
      passings: [passing({ seq: 1, lapTime: "0:00", lap: 1 }), passing({ seq: 2, number: "23", firstName: "Tim", lastName: "Beispiel (NED)", position: 2 })],
    });
    const table = await screen.findByRole("table", { name: "Zieldurchfahrten" });
    const rows = () => within(table).getAllByRole("row").slice(1);
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(rows()[0]).toHaveTextContent("Beispiel, Tim");
    expect(rows()[1]).toHaveTextContent("–"); // first crossing has no lap time

    // New passing without position yet, then the update from the following $G.
    ws.emit({ type: "passing", raceId: 12, passing: passing({ seq: 3, position: null, lap: null, totalTime: "4:32.800" }) });
    await waitFor(() => expect(rows()).toHaveLength(3));
    ws.emit({
      type: "passing",
      raceId: 12,
      passing: passing({ seq: 3, position: 1, lap: 8, totalTime: "4:32.752", correctionMs: -48 }),
    });
    await waitFor(() => expect(rows()[0]).toHaveTextContent("4:32.752"));
    expect(rows()).toHaveLength(3);
    expect(within(rows()[0]!).getByLabelText("Zielfoto-Korrektur")).toBeInTheDocument();

    // Another race: new snapshot replaces the list.
    ws.emit({ type: "passings", raceId: null, passings: [] });
    expect(await screen.findByText("Kein aktives Rennen")).toBeInTheDocument();
  });
});

describe("finish line log order", () => {
  it("sorts by crossing time, not by arrival (Orbits sends groups in batches)", async () => {
    renderAt("/finish-line-log");
    const ws = await socket("/ws/race/current/passings");
    ws.emit({ type: "passings", raceId: 12, passings: [] });
    const arrivals: Array<[number, string, number]> = [
      [1, "761", 73_490],
      [2, "865", 73_335],
      [3, "788", 73_548],
      [4, "868", 73_461],
    ];
    for (const [seq, number, crossingMs] of arrivals) {
      ws.emit({ type: "passing", raceId: 12, passing: passing({ seq, number, regNumber: number, crossingMs }) });
    }
    const table = await screen.findByRole("table", { name: "Zieldurchfahrten" });
    await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(5));
    // Newest (latest crossing) on top.
    const numbers = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((r) => within(r).getAllByRole("cell")[1]!.textContent);
    expect(numbers).toEqual(["788", "761", "868", "865"]);
  });
});

describe("finish line log settings", () => {
  const headers = () =>
    within(screen.getByRole("table", { name: "Zieldurchfahrten" }))
      .getAllByRole("columnheader")
      .map((h) => h.textContent);

  it("switches to the compact view and takes a typed row height", async () => {
    const user = userEvent.setup();
    renderAt("/finish-line-log");
    const ws = await socket("/ws/race/current/passings");
    ws.emit({ type: "passings", raceId: 12, passings: [passing()] });
    await screen.findByText("Muster, Max");
    expect(headers()).toEqual(["Zeit", "#", "Name", "Runde", "Rundenzeit", "Gesamt", "Pos"]);

    await user.click(screen.getByRole("button", { name: "Kompakt" }));
    expect(headers()).toEqual(["#", "Name", "Runde", "Platz"]);

    const input = screen.getByRole("spinbutton", { name: "Zeilenhöhe (px)" });
    await user.clear(input);
    await user.type(input, "44");
    await waitFor(() => expect(JSON.parse(localStorage.getItem("leaderboard.finishLog")!)).toMatchObject({ rowHeight: 44, compact: true }));
    // Out of range: marked, not stored.
    await user.clear(input);
    await user.type(input, "5");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(JSON.parse(localStorage.getItem("leaderboard.finishLog")!)).toMatchObject({ rowHeight: 44 });
  });

  it("takes compact view and row height from the URL in kiosk mode", async () => {
    renderAt("/finish-line-log?kiosk=1&compact=1&rowHeight=48");
    const ws = await socket("/ws/race/current/passings");
    ws.emit({ type: "passings", raceId: 12, passings: [passing()] });
    await screen.findByText("Muster, Max");
    expect(headers()).toEqual(["#", "Name", "Runde", "Platz"]);
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });
});
