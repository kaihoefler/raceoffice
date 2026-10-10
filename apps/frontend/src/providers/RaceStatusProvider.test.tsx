// RaceStatusProvider: the transport layer of the live feed (polling, errors, backoff, timeout,
// pause, URL change). Time is the subject here, so these tests use fake timers and move the
// clock explicitly; the timing system is the race status mock behind a stubbed fetch.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildRace, createFetchStub, RaceStatusFeed, startField } from "@raceoffice/race-status-mock";
import { TEST_RACE_STATUS_URL } from "@raceoffice/test-utils";

import { RaceStatusProvider, useRaceStatus } from "./RaceStatusProvider";

const POLL_MS = 1000;
const race = (name: string) => buildRace({ raceName: name, flag: "GREEN", competitors: startField([11, 12]) });

/** Shows the provider state and offers its controls. */
function Probe() {
  const s = useRaceStatus();
  return (
    <>
      <output aria-label="state">
        {JSON.stringify({
          status: s.status,
          error: s.error,
          errorCount: s.errorCount,
          interval: s.effectivePollIntervalMs,
          race: s.currentRace?.raceName ?? null,
          updatedAt: s.updatedAt,
        })}
      </output>
      <button onClick={() => s.setPaused(!s.paused)}>toggle pause</button>
      <button onClick={() => s.setUrl(`${TEST_RACE_STATUS_URL}&source=backup`)}>switch url</button>
    </>
  );
}

const state = () => JSON.parse(screen.getByRole("status", { name: "state" }).textContent!) as {
  status: string;
  error: string | null;
  errorCount: number;
  interval: number;
  race: string | null;
  updatedAt: number | null;
};

/** Moves the fake clock and lets the resulting fetches and renders settle. */
const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

let feed: RaceStatusFeed;
let requests: string[];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  feed = new RaceStatusFeed();
  requests = [];
  const stub = createFetchStub(feed, { matches: (url) => url.startsWith(TEST_RACE_STATUS_URL) });
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(String(input));
    return stub(input, init);
  });
});

afterEach(() => {
  vi.useRealTimers();
});

async function renderProvider() {
  render(
    <RaceStatusProvider url={TEST_RACE_STATUS_URL} pollIntervalMs={POLL_MS}>
      <Probe />
    </RaceStatusProvider>,
  );
  await tick(0);
}

describe("RaceStatusProvider", () => {
  it("polls right away and then once per interval", async () => {
    feed.set(race("Heat 1"));
    await renderProvider();
    expect(requests).toHaveLength(1);
    expect(state()).toMatchObject({ status: "ok", race: "Heat 1", errorCount: 0 });

    await tick(3 * POLL_MS);
    expect(requests).toHaveLength(4);

    feed.set(race("Heat 2"));
    await tick(POLL_MS);
    expect(state().race).toBe("Heat 2");
  });

  it("reports no race while the timing system has no active race", async () => {
    feed.set(null);
    await renderProvider();
    expect(state()).toMatchObject({ status: "ok", race: null });
  });

  it("keeps the last race on errors, counts them, and does not refresh the contact time", async () => {
    feed.set(race("Heat 1"));
    await renderProvider();
    const lastContact = state().updatedAt;

    feed.setResponse({ kind: "httpError", status: 500 });
    await tick(POLL_MS);
    expect(state()).toMatchObject({ status: "ok", race: "Heat 1", error: "HTTP 500", errorCount: 1, updatedAt: lastContact });

    feed.setResponse({ kind: "malformedJson" });
    await tick(POLL_MS);
    expect(state()).toMatchObject({ race: "Heat 1", errorCount: 2, updatedAt: lastContact });

    feed.set(race("Heat 1"));
    await tick(POLL_MS);
    expect(state()).toMatchObject({ status: "ok", error: null, errorCount: 0 });
    expect(state().updatedAt).toBeGreaterThan(lastContact!);
  });

  it("is in error state when the first requests fail, and backs off tenfold after 10 errors", async () => {
    feed.setResponse({ kind: "httpError", status: 503 });
    await renderProvider();
    expect(state()).toMatchObject({ status: "error", errorCount: 1, interval: POLL_MS });

    await tick(9 * POLL_MS);
    expect(state().errorCount).toBeGreaterThanOrEqual(10);
    expect(state().interval).toBe(10 * POLL_MS);

    // Slowed down: no request for almost the long interval.
    const before = requests.length;
    await tick(10 * POLL_MS - 1);
    expect(requests).toHaveLength(before);
    await tick(1);
    expect(requests).toHaveLength(before + 1);

    // Recovery switches back to the normal interval.
    feed.set(race("Heat 1"));
    await tick(10 * POLL_MS);
    expect(state()).toMatchObject({ status: "ok", errorCount: 0, interval: POLL_MS, race: "Heat 1" });
    const recovered = requests.length;
    await tick(POLL_MS);
    expect(requests).toHaveLength(recovered + 1);
  });

  it("gives up on a hanging request after the timeout and polls again afterwards", async () => {
    feed.set(race("Heat 1"));
    await renderProvider();

    feed.setResponse({ kind: "hang" });
    await tick(POLL_MS);
    const hanging = requests.length;

    // While the request hangs, no further requests are started.
    await tick(3 * POLL_MS - 1);
    expect(requests).toHaveLength(hanging);
    expect(state().errorCount).toBe(0);

    // Timeout = 3 x interval (at least 2 s): counts as an error, the last race stays.
    await tick(1);
    expect(state()).toMatchObject({ error: "Timeout after 3000 ms", errorCount: 1, race: "Heat 1" });

    // The poll due at the same instant has started and hangs as well; once the timing system
    // answers again, the feed recovers at the latest after that request has timed out too.
    expect(requests).toHaveLength(hanging + 1);
    feed.set(race("Heat 2"));
    await tick(3 * POLL_MS + POLL_MS);
    expect(state()).toMatchObject({ status: "ok", errorCount: 0, race: "Heat 2" });
  });

  it("stops polling while paused and resumes right away", async () => {
    feed.set(race("Heat 1"));
    await renderProvider();

    fireEvent.click(screen.getByRole("button", { name: "toggle pause" }));
    expect(state().status).toBe("paused");
    const paused = requests.length;
    await tick(5 * POLL_MS);
    expect(requests).toHaveLength(paused);

    fireEvent.click(screen.getByRole("button", { name: "toggle pause" }));
    await tick(0);
    expect(requests).toHaveLength(paused + 1);
    expect(state().status).toBe("ok");
  });

  it("polls the new URL after a URL change", async () => {
    feed.set(race("Heat 1"));
    await renderProvider();

    fireEvent.click(screen.getByRole("button", { name: "switch url" }));
    await tick(POLL_MS);
    expect(requests.at(-1)).toBe(`${TEST_RACE_STATUS_URL}&source=backup`);
  });
});
