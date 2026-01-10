# RaceOffice – Architecture Overview

RaceOffice is split into two parts:

- **Frontend SPA** (React + TypeScript + Vite)  
  Uses a **document-based realtime sync** model to read and update application state.
- **Backend server** (`server_own/`) (Fastify + WebSockets + SQLite)  
  Hosts the realtime document protocol and persists documents.

This document explains the core data model, the realtime protocol, and how the client and server interact.

---

## 1) Frontend (React SPA)

### UI
- Material UI theme configuration lives in `src/theme.ts` (`createTheme(...)`).

### Domain types
The SPA uses TypeScript types for the domain model:

- `src/types/event.ts`
  - `Event`: lightweight entity (in the *EventList* it contains only `id`, `slug`, `name`)
  - `FullEvent`: full entity (adds `races`, `athletes`, `ageGroups`)
  - `EventList`: container document with:
    - `activeEventId: string | null`
    - `events: Event[]`

- `src/types/agegroup.ts`
  - `AgeGroup` includes `id`, `name`, `gender`, `slug`, `eventId`

- `src/types/athlete.ts`
  - `Athlete` includes `id`, `firstName`, `lastName`, `bib`, `ageGroupId`, `nation`

### Realtime connection state (optional UI/debug)
`src/realtime/RealtimeConnectionProvider.tsx` tracks connection status per document:
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
On the server, `eventList` is bootstrapped with an initial state (see `server_own/src/index.ts`):

```ts
id === "eventList"
  ? { rev: 0, data: { activeEventId: null, events: [] } }
  : { rev: 0, data: {} };
```

This makes `eventList` the main entry point for:
- the list of events (`events`)
- which event is currently active (`activeEventId`)

### Lightweight vs full documents
From `src/types/event.ts`:
- `EventList.events` holds **lightweight `Event` objects** (`id`, `slug`, `name`)
- More detailed event data lives in `FullEvent` (adds `races`, `athletes`, `ageGroups`)

This pattern avoids loading everything upfront and keeps the list view small and fast.

---

## 3) Client Realtime Implementation (`src/realtime/useRealtimeDoc.ts`)

`useRealtimeDoc<T>(docId: string | null)` is the main client hook for realtime documents.

### Connection lifecycle
- If `docId` is `null`: the hook stays **disconnected** (no socket is opened).
- Otherwise:
  - opens a WebSocket to: `GET /ws/:docId`
  - switches status: `"connecting"` → `"connected"` on open
  - sets `"error"` on WS error
  - sets `"disconnected"` on close

### Snapshot + patch protocol
The hook expects two incoming message shapes:

- Snapshot:
  ```ts
  { type: "snapshot", docId, rev, data }
  ```
  This sets local `data` and updates `revRef`.

- Patch broadcast:
  ```ts
  { docId, rev, patch: Operation[] }
  ```
  The hook applies the patch using `fast-json-patch`:
  - `applyPatch(structuredClone(prev), patch, true, true)`

### Updates from client to server (no optimistic updates)
`update(fn)`:
- uses a ref (`dataRef`) to access the latest snapshot state
- computes a JSON patch with `compare(prev, next)`
- sends to server:
  ```json
  { "baseRev": currentRevision, "patch": [...] }
  ```
- The UI state updates only when the server broadcasts the patch back.

### Stale-socket protection (important)
The hook guards all socket event handlers using:

```ts
const isCurrent = () => wsRef.current === ws;
```

This prevents stale WebSocket events from earlier connections (common in development / StrictMode) from overwriting current state.

---

## 4) Server Implementation (`server_own/src/index.ts`)

### Tech stack
From `server_own/package.json` and code:
- Fastify 5
- `@fastify/websocket`
- SQLite persistence (`better-sqlite3`)
- Patch application via `fast-json-patch`
- CORS enabled for dev (`@fastify/cors`)
- SSE plugin registered (`fastify-sse-v2`) in addition to WebSockets

### Persistence model
SQLite table `docs`:

```sql
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

The server provides:
- `loadDoc(id)` → `{rev, data}`
- `saveDoc(id, doc)` → upsert into sqlite

### WebSocket endpoint: `/ws/:docId`
When a client connects:
1. The server registers the socket in an in-memory map:
   - `wsClients: Map<docId, Set<socket>>`
2. Immediately sends a snapshot:
   - via `noteSnapshot(socket, docId)`
   - message format:
     ```json
     { "type":"snapshot", "docId": "...", "rev": 0, "data": { ... } }
     ```

When a client sends an update:
- expected payload:
  ```json
  { "baseRev": number, "patch": Operation[] }
  ```

Server flow:
1. Load current doc (`loadDoc(docId)`)
2. Reject if `current.rev !== baseRev`:
   - responds:
     ```json
     { "error":"rev_mismatch", "rev": current.rev }
     ```
3. Apply patch:
   - `applyPatch(structuredClone(current.data), patch, true, true)`
4. Persist next doc:
   - `rev` increments by 1
5. Broadcast patch to all subscribers:
   - `broadcastPatch(docId, next.rev, patch)`
6. Respond to sender:
   ```json
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
- Server uses a strict **revision check** (`rev_mismatch`) to prevent applying patches to stale states.
- Client TODO in `src/realtime/useRealtimeDoc.ts` mentions implementing rev mismatch handling (e.g. re-fetch snapshot / reconnect).

Practical next steps (recommended):
- On receiving `{ error: "rev_mismatch", rev: ... }`, client should:
  - request a fresh snapshot (or reconnect)
  - optionally show a conflict state in the UI
- Add validation of patches / schema per document type (especially for multi-client editing).

---

## 6) Running the project (conceptually)

Backend (`server_own/package.json`):
- `npm run dev` starts `tsx watch src/index.ts` (development)
- `npm run build` compiles TypeScript
- `npm start` runs `dist/index.js`

Frontend (root project uses Vite; see root `README.md` template):
- run Vite dev server, which connects to backend via `/ws/:docId` (WebSockets).

> To document the exact dev proxy setup (e.g. Vite proxy to port 8787), I would need to see `vite.config.ts` (not shown here).

