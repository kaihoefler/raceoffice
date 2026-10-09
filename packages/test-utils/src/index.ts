// @raceoffice/test-utils
//
// Shared helpers for frontend component tests (Vitest + Testing Library + jsdom):
// - fakeRealtime.ts  in-memory realtime server behind a fake global WebSocket
// - liveFeed.ts      mocked timing system feed (fetch stub) and feedStep
// - setup.ts         test setup ("@raceoffice/test-utils/setup")
//
// App-specific rendering (provider tree, routes) lives in each app: src/test/renderApp.tsx.

export { FakeRealtimeServer, FakeWebSocket, installFakeRealtime } from "./fakeRealtime.js";
export { feedStep, installRaceStatusFeed, TEST_POLL_INTERVAL_MS, TEST_RACE_STATUS_URL } from "./liveFeed.js";
