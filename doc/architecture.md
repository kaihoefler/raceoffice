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

### Live status provider model
- The app now uses a **single** live provider: `RaceStatusProvider`.
- `RouterProvider` is mounted directly inside `RaceStatusProvider` (`apps/frontend/src/main.tsx`).
- Components/hooks consume live data directly via `useRaceStatus()`.
- Older split providers (`RaceStatusMetaProvider`, `RaceStatusCompetitorsProvider`, `RaceStatusBibProvider`, `RaceStatusTimeProvider`) were removed to simplify dependency flow.

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

## 4) Server Implementation (`apps/server/src/index.ts`)

> Detailed protocol reference (including unified error payload): see `doc/server.md`.

### Module layout
`index.ts` is the entrypoint. It reads CLI/env config, wires everything together, hosts the WebSocket/SSE realtime protocol and calls `listen()`. Feature logic lives in `apps/server/src/services/`:

| Module | Responsibility |
|---|---|
| `docStore.ts` | `DocStore` class: SQLite file, `docs` table, prepared statements, `loadDoc` (incl. bootstrap defaults) and `saveDoc` |
| `staticServing.ts` | `registerStaticServing(app, { publicDir, serviceEndpoints })`: `@fastify/static`, SPA shells for `/p3test/` and `/livetracking/`, not-found handler (JSON service discovery vs. SPA `index.html`) |
| `currentRaceResultService.ts` | payload for `GET /current_race_result` |
| `liveTrackingWorker*.ts` | worker process lifecycle + its routes |
| `p3*.ts` | P3 test client and decoder discovery routes |

New server features should go into such a module. A module can then be tested on its own: a fresh `Fastify()` instance with `inject()`, or a temporary SQLite file. No full server boot is needed.

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

`index.ts` keeps thin `loadDoc`/`saveDoc` wrappers around a single `DocStore` instance.

### WebSocket endpoint: `/ws/:docId`
When a client connects:
1. The server registers the socket in an in-memory map:
   - `wsClients: Map<docId, Set<socket>>`
2. Immediately sends a snapshot:
   - via `noteSnapshot(socket, docId)`
   - message format:
     ```json doc/architecture.md
     { "type":"snapshot", "docId": "...", "rev": 0, "data": { ... } }
     ```

When a client sends an update:
- expected payload:
  ```json doc/architecture.md
  { "baseRev": number, "patch": Operation[] }
  ```

Server flow:
1. Load current doc (`loadDoc(docId)`)
2. Reject if `current.rev !== baseRev`:
   - responds with the unified error format, followed by a fresh snapshot:
     ```json doc/architecture.md
     { "type":"error", "docId":"...", "code":"rev_mismatch", "message":"Client baseRev is stale", "rev": 13, "retryable": true }
     ```
3. Apply patch:
   - `applyPatch(structuredClone(current.data), patch, true, true)`
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
| Worker | `apps/livetracking-worker/src/**/*.test.ts` | AMM parsing, session loop status check, AMMC integration (only with binaries in `tools/ammc/`) |
| Frontend logic | `apps/frontend`, `apps/livetracking-frontend` `src/**/*.test.ts` | pure helpers (no component rendering yet) |

Conventions:
- Test logic as pure functions (preferably in `packages/domain`) rather than through the UI.
- Make server parts testable by extracting them into `services/` modules; don't boot `index.ts` in tests.
- Regression tests for an upgrade are written **before** the version bump, run green on the old version, then on the new one.

### Gates
- Local: `npm run verify` (typecheck → lint → `test:all` → `build:all`).
- CI: `.github/workflows/ci.yml` runs the same checks on every push to `main` and every pull request, Dependabot PRs included. Details: `doc/build-and-deploy.md` → "Continuous Integration & Releases".

### Known gaps (planned)
- The WebSocket/SSE patch protocol in `index.ts` has no automated tests yet. This needs a `buildApp()` extraction so a test can start the server on a random port.
- No component tests for the React frontends (no jsdom/Testing Library yet) and no browser E2E tests. MUI upgrades are therefore only verified by `typecheck` and `build`.
- The release workflow does not yet smoke-test the packaged ZIP.
