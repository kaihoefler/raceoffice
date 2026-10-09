// liveFeed.ts
//
// Live race status feed in component tests: the page's RaceStatusProvider polls a mocked
// timing system (RaceStatusFeed from @raceoffice/race-status-mock) through a stubbed fetch.
//
// Tests render with a short poll interval (TEST_POLL_INTERVAL_MS) and real timers, and move
// the race forward with feedStep: set the next state, wait until the page has picked it up.
// No fake timers needed; extra polls are harmless because the feed keeps answering with the
// state set last.

import { vi } from "vitest";
import type { RaceStatusRace } from "@raceoffice/domain";
import { createFetchStub, RaceStatusFeed } from "@raceoffice/race-status-mock";

/** Feed URL used in tests (never reaches the network). */
export const TEST_RACE_STATUS_URL = "http://timing.test/races?filter=current";

/** Poll interval in tests: a feed step takes a few milliseconds instead of a second. */
export const TEST_POLL_INTERVAL_MS = 20;

/**
 * Stubs the global fetch: requests to TEST_RACE_STATUS_URL are answered by `feed`, all other
 * requests by `fallback` (default: rejected, so unexpected network calls fail loudly).
 */
export function installRaceStatusFeed(
  feed: RaceStatusFeed = new RaceStatusFeed(),
  fallback?: typeof fetch,
): RaceStatusFeed {
  vi.stubGlobal(
    "fetch",
    createFetchStub(feed, { matches: (url) => url.startsWith(TEST_RACE_STATUS_URL), ...(fallback ? { fallback } : {}) }),
  );
  return feed;
}

/**
 * Next state of the race: the timing system reports `race` from now on. Resolves once the
 * page has polled it; assert the UI reaction with findBy... or waitFor afterwards.
 */
export async function feedStep(feed: RaceStatusFeed, race: RaceStatusRace | null): Promise<void> {
  feed.set(race);
  await feed.waitUntilServed();
}
