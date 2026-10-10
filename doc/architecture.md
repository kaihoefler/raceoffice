# RaceOffice – Architecture Overview

RaceOffice is an npm-workspaces monorepo:

- **Frontend SPAs** (React + TypeScript + Vite + MUI), all built into `apps/server/public` and served by the backend:
  - `apps/frontend/`: main app (events, races, scoring, visualizations), served at `/`
  - `apps/livetracking-frontend/`: LiveTracking setup/control and visualization, served at `/livetracking/`
  - `apps/p3test-frontend/`: P3 decoder diagnostics, served at `/p3test/`

  The two realtime SPAs use a **document-based realtime sync** model to read and update application state.
- **Backend server** (`apps/server/`, Fastify + WebSockets + SQLite)  
  Hosts the realtime document protocol, persists documents and serves the SPAs.
- **LiveTracking worker** (`apps/livetracking-worker/`)  
  Separate Node process started by the server. It reads passings from decoders (AMMC or P3) and writes timing results back through the realtime protocol.
- **Shared packages**
  - `packages/domain/`: types and pure domain logic shared by all apps
  - `packages/p3parser/`: MYLAPS P3 protocol parser and client API

This document focuses on the realtime document model shared by frontend and server.

---

## 1) Frontend (React SPA)

### UI
- Material UI theme configuration lives in `apps/frontend/src/theme.ts` (`createTheme(...)`).

### Live race status feed (timing system)
The timing system exposes the running race (laps, positions, flag, times) as a REST endpoint (default `http://localhost:8080/races?filter=current`, override with `VITE_RACE_STATUS_URL` or in the LiveRaceStatus settings dialog). The browser polls it directly every second; the RaceOffice server is not involved.

The feed drives large parts of scoring:
- lap sync
- P1–P3 prefill in points sprints
- elimination candidates
- lapped riders: riders ≥ 2 laps down are marked in the starter list with "+N Laps"
- DNF suggestions: the group furthest behind, with the DNF lap derived from it
- DNS candidates: riders with 0 laps, prefilled in DNS mode from live lap 2 on
- finish order
- warnings for unknown or missing bibs

It is split into layers so that the scoring rules can be tested without React, network or clock:

| Layer | Where | Responsibility |
|---|---|---|
| Feed contract | `packages/domain/src/raceStatusFeed.ts` | `RaceStatusRace` / `RaceStatusCompetitor` types, `pickCurrentRace(payload)`. Real sample: `examples/race_status.json` |
| Transport | `apps/frontend/src/providers/RaceStatusProvider.tsx` | polling, request timeout (3× interval, min. 2 s), error count, backoff ×10 after 10 errors, pause, URL. Exposes the raw `currentRace` via `useRaceStatus()`. Unchanged responses do not re-render consumers (`updatedAt` is refreshed at most once per second for the "no response" indicator). **No scoring rules.** |
| Scoring rules | `apps/frontend/src/domain/liveScoring.ts` | pure: `deriveLiveScoring(race, currentRace)`, `suggestDnfGroup` + `dnfLapForDeficit` (DNF proposal), `suggestDnsBibs` (DNS proposal), `buildStartersForBibs`, `buildFinishResultsFromLive`. Time display helpers in `domain/liveTime.ts` |
| React adapter | `apps/frontend/src/pages/scoring/ScoringViewModel.tsx` | `useScoringViewModel`: calls `deriveLiveScoring`, keeps Set identities stable, adds UI state (`syncEnabled`) |
| UI | `ScoringLiveColumns`, `LiveRaceStatus`, `PointsScoring`, `EliminationScoring`, `FinishLineScoring` | decide *when* to apply a hint (prefill, lap sync), record the officials' decisions |

Rule of thumb: "what does the feed mean for scoring?" belongs in `liveScoring.ts`; "when does the UI react?" belongs in the components.

Live sync (`LiveRaceStatus`, "Activate Sync"): can be switched on while the flag is GREEN or PURPLE and stays on until the timing system reports another race (or no active race), also after FINISH, so the last sprint, elimination and the finish can still be scored with live prefill. It can always be switched off by hand. While a race is running (GREEN) without sync, the toggle is outlined red.

`RouterProvider` is mounted inside `RaceStatusProvider` (`apps/frontend/src/main.tsx`), so every page can use `useRaceStatus()`. It is the only live provider; older split providers were removed.

Testing the feed: see section 6 (`@raceoffice/race-status-mock`).

### Scoring page render isolation
- `ScoringPage` was split so live subscriptions are localized in `apps/frontend/src/pages/scoring/ScoringLiveColumns.tsx`.
- Non-live columns (activities/standings) stay outside that live-consuming block.
- Goal: reduce unnecessary full-page re-renders on each live polling cycle.

### Shared domain package (`@raceoffice/domain`)
Domain types and pure race logic are centralized in the workspace package `packages/domain` and imported in the SPA via `@raceoffice/domain`.

Examples from the shared package:
- `Event`, `FullEvent`, `EventList`
- `AgeGroup`, `Athlete`, `Race`
- `RaceActivity*` types
- `RaceResult`

Shared pure functions now live there as well, e.g.:
- race results materialization/ranking (`materializeRaceResults`, `recomputeRaceResults`, ...)
- race activities filtering/cleanup (`filterActivitiesByAllowedBibs`, `removeBibFromActivities`)

This keeps client/server domain behavior aligned and avoids duplicated logic in the SPA.

### Realtime connection state (optional UI/debug)
`apps/frontend/src/realtime/RealtimeConnectionProvider.tsx` tracks connection status per document:
- It maintains a map `connections: Record<string, ConnInfo>` keyed by `docId`
- Each entry stores `status`, `error`, and `updatedAt`
- This enables UI indicators (e.g. showing whether a doc is connected, reconnecting, etc.)

---

## 2) Realtime Data Model: “Documents”

The system synchronizes **documents** identified by a string `docId`.

Examples of doc IDs:
- `eventList` (special, initialized with a default schema on the server)
- any other string (server will create an empty document `{}` by default)

### Special document: `eventList`
On first access, the server bootstraps a missing document and persists it immediately at `rev: 0` (see `DocStore.loadDoc` in `apps/server/src/services/docStore.ts`):

```ts doc/architecture.md
id === "eventList"
  ? { rev: 0, data: { activeEventId: null, events: [] } }   // dedicated core default
  : liveTrackingInitial                                       // createInitialLiveTrackingDocument(id)
    ? { rev: 0, data: liveTrackingInitial }                   // typed LiveTracking default
    : { rev: 0, data: {} };                                   // generic fallback
```

This makes `eventList` the main entry point for:
- the list of events (`events`)
- which event is currently active (`activeEventId`)

### Lightweight vs full documents
From `@raceoffice/domain`:
- `EventList.events` holds **lightweight `Event` objects** (`id`, `slug`, `name`)
- More detailed event data lives in `FullEvent` (adds `races`, `athletes`, `ageGroups`)

This pattern avoids loading everything upfront and keeps the list view small and fast.

---

## 3) Client Realtime Implementation (`apps/frontend/src/realtime/useRealtimeDoc.ts`)

`useRealtimeDoc<T>(docId: string | null)` is the main client hook for realtime documents.

### Connection lifecycle
- If `docId` is `null`: the hook stays **disconnected** (no socket is opened).
- Otherwise:
  - opens a WebSocket to: `GET /ws/:docId`
  - switches status: `"connecting"` → `"connected"` on open
  - sets `"error"` on WS error
  - sets `"disconnected"` on close

### Snapshot + patch protocol
The hook expects three incoming message shapes:

- Snapshot:
  ```ts doc/architecture.md
  { type: "snapshot", docId, rev, data }
  ```
  This sets local state and synchronizes both `dataRef` + `revRef` immediately.

- Patch broadcast:
  ```ts doc/architecture.md
  { docId, rev, patch: Operation[] }
  ```
  The hook applies the patch using `fast-json-patch`:
  - `applyPatch(structuredClone(prev), patch, true, true)`

- Unified error:
  ```ts doc/architecture.md
  { type: "error", docId, code, message, rev?, retryable? }
  ```
  - `rev_mismatch` triggers reconnect/resync handling in the client.

### Updates from client to server (no optimistic updates)
`update(fn)`:
- uses a ref (`dataRef`) to access the latest snapshot state
- computes a JSON patch with `compare(prev, next)`
- sends to server:
  ```json doc/architecture.md
  { "baseRev": currentRevision, "patch": [...] }
  ```
- The UI state updates only when the server broadcasts the patch back.

### Stale-socket protection (important)
The hook guards all socket event handlers using:

```ts doc/architecture.md
const isCurrent = () => wsRef.current === ws;
```

This prevents stale WebSocket events from earlier connections (common in development / StrictMode) from overwriting current state.

---

## 4) Server Implementation (`apps/server/src/`)

> Detailed protocol reference (including unified error payload): see `doc/server.md`.

### Module layout
- `index.ts` is a thin entrypoint: it reads CLI/env config (`--port`, `--host`, `--db`, …), calls `buildApp()` and `listen()`.
- `app.ts` exports `buildApp({ dbPath, publicDir, repoRoot, liveTrackingServerUrl, logger? })`. It registers plugins and all routes and returns the Fastify instance without listening. Tests use it directly. `app.close()` stops the worker/P3 client and closes the database.

Feature logic lives in `apps/server/src/services/`:

| Module | Responsibility |
|---|---|
| `realtimeHub.ts` | `RealtimeHub`: per-doc subscriber registries, `/ws/:docId` write pipeline, `/sse/:docId`, patch broadcast, `commitServerDocUpdate` for server-originated changes |
| `docStore.ts` | `DocStore` class: SQLite file, `docs` table, prepared statements, `loadDoc` (incl. bootstrap defaults) and `saveDoc` |
| `staticServing.ts` | `registerStaticServing(app, { publicDir, serviceEndpoints })`: `@fastify/static`, SPA shells for `/p3test/` and `/livetracking/`, not-found handler (JSON service discovery vs. SPA `index.html`) |
| `currentRaceResultService.ts` | payload for `GET /current_race_result` |
| `liveTrackingWorker*.ts` | worker process lifecycle + its routes |
| `p3*.ts` | P3 test client and decoder discovery routes |

New server features should go into such a module. A module can then be tested on its own: a fresh `Fastify()` instance with `inject()`, or a temporary SQLite file. For end-to-end protocol tests, `buildApp()` with a temp database is started on a random port (`listen({ port: 0 })`).

### Tech stack
From `apps/server/package.json` and code:
- Fastify 5
- `@fastify/websocket`
- SQLite persistence (`better-sqlite3`)
- Patch application via `fast-json-patch`
- CORS enabled for dev (`@fastify/cors`)
- SSE plugin registered (`fastify-sse-v2`) in addition to WebSockets

### Persistence model
SQLite table `docs`:

```sql doc/architecture.md
CREATE TABLE IF NOT EXISTS docs (
  id TEXT PRIMARY KEY,
  rev INTEGER NOT NULL,
  json TEXT NOT NULL
);
```

Each document has:
- `id`: document identifier (`docId`)
- `rev`: revision number (monotonically increasing integer)
- `json`: serialized document data

`DocStore` (`apps/server/src/services/docStore.ts`) provides:
- `loadDoc(id)` → `{rev, data}` (bootstraps and persists missing documents, see section 2)
- `saveDoc(id, doc)` → upsert into sqlite (`INSERT … ON CONFLICT(id) DO UPDATE`)

`buildApp()` creates a single `DocStore` instance and shares it with `RealtimeHub` and the HTTP routes.

### WebSocket endpoint: `/ws/:docId` (`RealtimeHub`)
When a client connects:
1. The hub registers the socket in an in-memory map:
   - `wsClients: Map<docId, Set<socket>>`
2. Immediately sends a snapshot:
   - via `sendSnapshot(socket, docId)`
   - message format:
     ```json doc/architecture.md
     { "type":"snapshot", "docId": "...", "rev": 0, "data": { ... } }
     ```

When a client sends an update:
- expected payload:
  ```json doc/architecture.md
  { "baseRev": number, "patch": Operation[] }
  ```

Server flow (validation and patch rules are pure functions in `packages/domain/src/realtimeProtocol.ts`: `parseClientWrite`, `applyClientWrite`, `toErrorFrame`; shared with the fake server of the component tests):
0. Validate the frame (`parseClientWrite`): non-JSON → `invalid_json`; anything but `{ baseRev: number, patch: [] }` (including `null`) → `invalid_payload`
1. Load current doc (`docStore.loadDoc(docId)`)
2. Reject if `current.rev !== baseRev` (`applyClientWrite`):
   - responds with the unified error format, followed by a fresh snapshot:
     ```json doc/architecture.md
     { "type":"error", "docId":"...", "code":"rev_mismatch", "message":"Client baseRev is stale", "rev": 13, "retryable": true }
     ```
3. Apply patch:
   - `applyPatch(structuredClone(current.data), patch, true, true)`
   - an invalid or failing operation (e.g. failed `test`, unresolvable path) rejects the whole write as `patch_apply_failed` with the fast-json-patch cause code as message prefix (e.g. `TEST_OPERATION_FAILED: …`)
4. Persist next doc:
   - `rev` increments by 1
5. Broadcast patch to all subscribers:
   - `broadcastPatch(docId, next.rev, patch)`
6. Respond to sender:
   ```json doc/architecture.md
   { "ok": true, "rev": next.rev }
   ```

### SSE endpoint: `/sse/:docId` (optional)
The server also supports subscribing via Server-Sent Events:
- registers clients in `sseClients: Map<docId, Set<SSEClient>>`
- sends an initial snapshot event
- broadcasts patches as SSE events

This is useful for read-only clients or environments where WS is difficult.

> The current frontend code shown uses WebSockets. If you want SSE support on the client, you’d add a separate client hook (or a fallback strategy).

---

## 5) Concurrency / Conflicts

Current behavior:
- Server uses strict revision checks (`baseRev` vs current `rev`).
- On mismatch or patch errors, server returns a **unified error message** and sends a fresh snapshot to re-sync the sender.
- Client handles `rev_mismatch` by reconnecting and accepting a fresh snapshot.

Practical next steps (recommended):
- Add domain-level schema validation for incoming patches per document type.
- Optionally add retry/backoff strategy for repeated reconnect loops.
- Add telemetry for error codes (`rev_mismatch`, `patch_apply_failed`, …) to monitor multi-client conflict frequency.

---

## 6) Tests & quality gates

Main goal: show reliably after every dependency update (Dependabot) that the application still works.

### Test layers
| Layer | Where | What it guards |
|---|---|---|
| Pure domain logic | `packages/domain/src/**/*.test.ts` | race results/ranking, activities, LiveTracking session/setup/timing engine |
| Protocol parser | `packages/p3parser/test/*.test.mjs` (`node --test` against `dist`) | P3 binary encode/decode (golden bytes) |
| Server modules | `apps/server/test/*.test.ts` | static serving + SPA fallbacks (`fastify.inject()`), `DocStore` against a temp SQLite file, race result export, worker manager (mocked process) |
| Server end-to-end | `apps/server/test/realtimeServer.test.ts` | real `buildApp()` on a random port with real WebSocket/SSE clients: snapshot, ack + broadcast, `rev_mismatch`, invalid frames, failed patches, persistence across restart, server-originated updates, `/current_race_result` |
| Worker | `apps/livetracking-worker/src/**/*.test.ts` | AMM parsing, session loop status check, AMMC integration (only with binaries in `tools/ammc/`) |
| Live scoring rules | `apps/frontend/src/domain/liveScoring.test.ts`, `liveTime.test.ts` | one block per scoring situation: no active race, before start, points race, elimination, lapped riders, unknown/missing bibs, finish order |
| Recorded real races | `apps/frontend/src/domain/liveScoring.recordings.test.ts` | every state of every recording in `packages/race-status-mock/recordings/` must satisfy the invariants; skipped while there are no recordings |
| Feed mock | `packages/race-status-mock/test/*.test.ts` | the mock itself: hold-until-next-set semantics, failure modes, HTTP server + CORS, replay, recordings |
| Protocol rules | `packages/domain/src/realtimeProtocol.test.ts` | frame validation, rev check, JSON-Patch apply, error codes |
| Frontend logic | `apps/frontend`, `apps/livetracking-frontend` `src/**/*.test.ts` | other pure helpers |
| Frontend components | `apps/*/src/**/*.test.tsx` (jsdom + Testing Library) | real pages with the real provider tree via `src/test/renderApp.tsx`; realtime documents from a fake server, live feed from the race status mock |

Conventions:
- Test logic as pure functions (preferably in `packages/domain`) rather than through the UI.
- Make server parts testable by extracting them into `services/` modules. Tests use `buildApp()`; they never import `index.ts`, which starts listening.
- `apps/server/test/helpers/realtimeClient.ts` (`connectDoc(baseUrl, docId)`) is the reusable protocol client for tests (Node's global `WebSocket`, no extra dependency).
- Regression tests for an upgrade are written **before** the version bump, run green on the old version, then on the new one.

### Mocking the live race status feed (`@raceoffice/race-status-mock`)
Model: a test **sets** what the timing system reports next. The mock answers **every** poll with that state until the next one is set. Tests describe a race as the few states their case needs and never depend on the 1-second polling.

- Feed states come from the builder (`buildRace`, `competitor`, `startField`) or from recorded real races (`findRace(loadRecording(file), …)`).
- `RaceStatusFeed`:
  - `set(race | null)` sets the next state; `setResponse(...)` sets a failure mode instead: `httpError`, `malformedJson` or `hang`.
  - `waitUntilServed()` waits until the client has picked up the state set last.
- Transports, all backed by the same feed:
  - `createFetchStub(feed)`: in-process, for component tests.
  - `startRaceStatusMockServer()` / `HttpRaceStatusFeed`: real HTTP with CORS, for E2E.
  - `npm run mock:race-status -- [--recording <file>]`: manual testing without a timing system, on port 8080 = the frontend's default URL.
- `npm run record:race-status -- --url <feed> --out <file> [--anonymize]` records a real race (changed states only). See `packages/race-status-mock/recordings/README.md`.

### Component tests (frontends)
- Run in jsdom with Testing Library; setup: `@raceoffice/test-utils/setup` (jest-dom matchers, cleanup, browser API stubs MUI needs).
- `renderApp({ route, docs, feed })` in `apps/*/src/test/renderApp.tsx` renders the real provider tree (`src/AppProviders.tsx`, also used by `main.tsx`) and the real routes (`src/router.tsx` exports `routes`) at a URL.
- Realtime documents: `installFakeRealtime()` (`@raceoffice/test-utils`) replaces the global WebSocket with an in-memory server that applies the same protocol rules and bootstrap defaults (`initialDocumentData`) as the real server. Seed documents via `docs` (fixtures in `apps/frontend/src/test/fixtures.ts`), push server-side changes with `server.update(...)`.
- Live feed: the provider polls the race status mock every 20 ms with real timers; `await feedStep(feed, nextState)` moves the race on. Fake timers only where time itself is tested (timeout, backoff, stale indicator).
- Query by role/label/visible text, use `userEvent`, no snapshots, no `.Mui*` class selectors, so tests survive MUI upgrades.
- What exists:
  - Route smoke tests (`src/test/routes.test.tsx` in both apps): every route renders its page, and nothing is logged via `console.error`. React and MUI report rendering errors and deprecations there, so an upgrade that only warns already fails the test.
  - Scenario tests (`apps/frontend/src/test/scenarios/`): a recorded real race, scored state by state as agreed with the race office (elimination and points interpretation). Each has a Markdown table next to it that is the source of truth.
  - Component tests next to the component or page (`*.test.tsx`): the live sync toggle and connection settings, `PointsBibField` (the MUI Autocomplete contract), manual finish entry, the race list with its filters and the race editor, inline starter editing, the LiveTracking setup editor.
- MUI API style: text field attributes go through `slotProps` (`htmlInput`, `input`, `inputLabel`), not the deprecated `inputProps`/`InputProps`/`InputLabelProps`; a `Select` gets a `labelId` so its accessible name is its label.

### Gates
- Local: `npm run verify` (typecheck → lint → `test:all` → `build:all`).
- CI: `.github/workflows/ci.yml` runs the same checks on every push to `main` and every pull request, Dependabot PRs included. Details: `doc/build-and-deploy.md` → "Continuous Integration & Releases".

### Known gaps (planned)
- `RaceStatusProvider` timing behaviour (request timeout, backoff after errors, stale indicator) has no test yet; it needs fake timers.
- No browser E2E tests (Playwright with the race status mock HTTP server is planned).
- The release workflow does not yet smoke-test the packaged ZIP.
