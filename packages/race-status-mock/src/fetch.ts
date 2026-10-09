// fetch.ts
//
// In-process transport for component tests: a fetch implementation that answers requests to
// the feed URL from a RaceStatusFeed, and passes every other request on to a fallback.
// Install it with e.g. `vi.stubGlobal("fetch", createFetchStub(feed, { matches }))`.

import type { RaceStatusFeed } from "./feed.js";

export type FetchStubOptions = {
  /** Which requests the timing system mock answers. Default: URLs containing "/races". */
  matches?: (url: string) => boolean;
  /** Handles all other requests. Default: rejects, so unexpected network calls fail loudly. */
  fallback?: typeof fetch;
};

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

export function createFetchStub(feed: RaceStatusFeed, options: FetchStubOptions = {}): typeof fetch {
  const matches = options.matches ?? ((url: string) => url.includes("/races"));
  const fallback =
    options.fallback ??
    ((input: Parameters<typeof fetch>[0]) => Promise.reject(new Error(`Unexpected fetch in test: ${requestUrl(input)}`)));

  return async (input, init) => {
    const url = requestUrl(input);
    if (!matches(url)) return fallback(input, init);

    const signal = init?.signal ?? undefined;
    if (signal?.aborted) throw abortError(signal);

    const response = feed.current();
    feed.markServed();

    switch (response.kind) {
      case "payload":
        return new Response(JSON.stringify(response.body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      case "httpError":
        return new Response(JSON.stringify({ error: "mocked" }), { status: response.status });
      case "malformedJson":
        return new Response("{ this is not json", { status: 200, headers: { "content-type": "application/json" } });
      case "hang":
        // Like a stalled network: settles only when the caller aborts (timeout or cleanup).
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(abortError(signal)), { once: true });
        });
    }
  };
}
