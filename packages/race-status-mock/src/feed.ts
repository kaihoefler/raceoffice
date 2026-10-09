// feed.ts
//
// RaceStatusFeed: the controllable state of a mocked timing system.
//
// Model: a test SETS what the timing system reports next; the mock answers EVERY poll with
// that state until the test sets the next one. Tests therefore describe a race as a few
// meaningful states ("lap 5, rider 12 last", "rider 31 lapped", "finish") instead of
// timing sequences, and never depend on the 1-second polling interval.
//
// The same feed object backs both transports:
// - createFetchStub (fetch.ts)       in-process, for component tests
// - startRaceStatusMockServer        real HTTP server, for E2E and manual testing
// so a scenario written once works in every test layer.

import type { RaceStatusRace } from "@raceoffice/domain";
import { feedPayload } from "./builder.js";

/**
 * What the mocked timing system answers.
 * - payload:       normal response, JSON body (array of races)
 * - httpError:     non-2xx status, e.g. timing system overloaded (500) or misconfigured (404)
 * - malformedJson: 200 with a body that is not JSON (truncated/garbled response)
 * - hang:          never answers (network stall); only the client's timeout/abort ends the request
 */
export type FeedResponse =
  | { kind: "payload"; body: unknown }
  | { kind: "httpError"; status: number }
  | { kind: "malformedJson" }
  | { kind: "hang" };

export class RaceStatusFeed {
  private response: FeedResponse = { kind: "payload", body: [] };
  private served = 0;
  private waiters: Array<() => void> = [];

  /** Sets the race the timing system reports from now on; `null` = no active race. */
  set(race: RaceStatusRace | null): void {
    this.setResponse({ kind: "payload", body: feedPayload(race) });
  }

  /** Sets any response, including failure modes. */
  setResponse(response: FeedResponse): void {
    this.response = response;
    this.served = 0;
  }

  /** The response every poll currently gets. */
  current(): FeedResponse {
    return this.response;
  }

  /** How often the current response has been delivered since it was set. */
  servedSinceSet(): number {
    return this.served;
  }

  /**
   * Resolves once the current response has been delivered at least once, i.e. the client
   * has picked up the state the test set. Resolves immediately if that already happened.
   * For `hang` the delivery is counted when the request arrives.
   */
  waitUntilServed(): Promise<void> {
    if (this.served > 0) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  /** Called by a transport after it delivered (or, for `hang`, accepted) a request. */
  markServed(): void {
    this.served += 1;
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve();
  }
}
