// Behind RaceOffice the UI is served by the RaceOffice server even while the managed service is
// stopped; the app offers to start it and reconnects right after.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { integrationBase } from "../api";
import { FakeSocket, installFakes, type FetchCall } from "./fakes";

let running = false;
let calls: FetchCall[];

const integrationStatus = () => ({
  ok: true,
  mode: "managed",
  available: running,
  process: { state: running ? "running" : "stopped", lastError: null },
});

beforeEach(() => {
  localStorage.clear();
  running = false;
  globalThis.history.pushState({}, "", "/leaderboard/ui/");
  calls = installFakes({
    "GET /leaderboard-service/status": () => Response.json(integrationStatus()),
    "POST /leaderboard-service/start": () => {
      running = true;
      return Response.json({ ok: true });
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.history.pushState({}, "", "/");
});

describe("service offline", () => {
  it("derives the RaceOffice control path from the page location", () => {
    expect(integrationBase("/leaderboard/ui/")).toBe("/leaderboard-service/");
    expect(integrationBase("/ui/")).toBeNull();
  });

  it("offers to start the stopped service and reconnects immediately afterwards", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/control"]}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/Der Leaderboard-Service läuft nicht/)).toBeInTheDocument();

    // The status socket fails while the service is down (the proxy closes it).
    await waitFor(() => expect(FakeSocket.find("/leaderboard/ws/status")).toBeDefined());
    FakeSocket.find("/leaderboard/ws/status")!.drop();
    const socketsBefore = FakeSocket.all.length;

    await user.click(screen.getByRole("button", { name: "Service starten" }));
    expect(calls.some((c) => c.method === "POST" && c.url === "/leaderboard-service/start")).toBe(true);
    await waitFor(() => expect(screen.queryByText(/Der Leaderboard-Service läuft nicht/)).not.toBeInTheDocument());
    // Reconnected without waiting for the backoff.
    await waitFor(() => expect(FakeSocket.all.length).toBeGreaterThan(socketsBefore), { timeout: 500 });
  });

  it("does not show the banner for a running service", async () => {
    running = true;
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() => expect(calls.some((c) => c.url === "/leaderboard-service/status")).toBe(true));
    expect(screen.queryByText(/Der Leaderboard-Service läuft nicht/)).not.toBeInTheDocument();
  });
});
