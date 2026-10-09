import { pickCurrentRace } from "@raceoffice/domain";
import { describe, expect, it } from "vitest";
import { buildRace, competitor, createFetchStub, RaceStatusFeed, startField } from "../src/index";

const FEED_URL = "http://timing.test/races?filter=current";

describe("builder", () => {
  it("builds a feed state the frontend can read", () => {
    const race = buildRace({ lapsComplete: 3, competitors: startField([12, 7], { laps: 3 }) });

    expect(pickCurrentRace([race])).toEqual(race);
    expect(race.competitors).toEqual([
      { number: "12", position: 1, lapsComplete: 3, firstName: "Rider", lastName: "12", totalTime: "0:00" },
      { number: "7", position: 2, lapsComplete: 3, firstName: "Rider", lastName: "7", totalTime: "0:00" },
    ]);
  });

  it("allows an inactive race (empty flag)", () => {
    expect(pickCurrentRace([buildRace({ flag: "", competitors: [competitor(1)] })])).toBeNull();
  });
});

describe("RaceStatusFeed + fetch stub", () => {
  it("answers every poll with the state set last, until the next one is set", async () => {
    const feed = new RaceStatusFeed();
    const fetchStub = createFetchStub(feed);

    feed.set(buildRace({ lapsComplete: 5 }));
    for (let i = 0; i < 3; i++) {
      const body = await (await fetchStub(FEED_URL)).json();
      expect(pickCurrentRace(body)?.lapsComplete).toBe(5);
    }
    expect(feed.servedSinceSet()).toBe(3);

    feed.set(buildRace({ lapsComplete: 6 }));
    expect(feed.servedSinceSet()).toBe(0);
    expect(pickCurrentRace(await (await fetchStub(FEED_URL)).json())?.lapsComplete).toBe(6);
  });

  it("reports no active race until something is set", async () => {
    const fetchStub = createFetchStub(new RaceStatusFeed());
    expect(await (await fetchStub(FEED_URL)).json()).toEqual([]);
  });

  it("waitUntilServed resolves once the client picked up the new state", async () => {
    const feed = new RaceStatusFeed();
    const fetchStub = createFetchStub(feed);
    feed.set(buildRace());

    let served = false;
    const waiting = feed.waitUntilServed().then(() => (served = true));
    await Promise.resolve();
    expect(served).toBe(false);

    await fetchStub(FEED_URL);
    await waiting;
    expect(served).toBe(true);
  });

  it("simulates HTTP errors and malformed JSON", async () => {
    const feed = new RaceStatusFeed();
    const fetchStub = createFetchStub(feed);

    feed.setResponse({ kind: "httpError", status: 503 });
    expect((await fetchStub(FEED_URL)).status).toBe(503);

    feed.setResponse({ kind: "malformedJson" });
    await expect((await fetchStub(FEED_URL)).json()).rejects.toThrow();
  });

  it("simulates a stalled request that only ends when the caller aborts", async () => {
    const feed = new RaceStatusFeed();
    feed.setResponse({ kind: "hang" });
    const fetchStub = createFetchStub(feed);

    const ac = new AbortController();
    const pending = fetchStub(FEED_URL, { signal: ac.signal });
    await feed.waitUntilServed();

    ac.abort(new DOMException("timed out", "TimeoutError"));
    await expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("rejects unexpected requests unless a fallback is given", async () => {
    const feed = new RaceStatusFeed();
    await expect(createFetchStub(feed)("http://other.test/api")).rejects.toThrow(/Unexpected fetch/);

    const fallback = async () => new Response("from fallback");
    expect(await (await createFetchStub(feed, { fallback })("http://other.test/api")).text()).toBe("from fallback");
  });
});
