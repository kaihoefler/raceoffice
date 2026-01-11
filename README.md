# RaceOffice – Architecture Overview

RaceOffice is split into two parts:

- **Frontend SPA** (React + TypeScript + Vite)  
  Uses a **document-based realtime sync** model to read and update application state.
- **Backend server** (`server_own/`) (Fastify + WebSockets + SQLite)  
  Hosts the realtime document protocol and persists documents.

This document explains the core data model, the realtime protocol, and how the client and server interact.

---

## Build, Deploy & Install (Windows Service)

### Prerequisites
- Node.js (recommended: current LTS) + npm
- For service installation on Windows: an elevated (Administrator) shell

### Install dependencies
This repository contains **two** npm projects: the root SPA and the backend in `server_own/`.

```sh
npm install
npm --prefix server_own install
```

### Development
Run backend + frontend in separate terminals.

Backend (Fastify + WS + SQLite):
```sh
npm --prefix server_own run dev
```

Frontend (Vite dev server):
```sh
npm run dev
```

The dev server proxies `/ws`, `/sse` and `/health` to the backend on `http://localhost:8787` (see `vite.config.ts`).

### Production build (server serves the SPA)
The backend serves static files from `server_own/public` (see `server_own/src/index.ts` via `@fastify/static`).

Build everything:

```sh
npm run build:all
```

Run the server (network reachable, port 8787):

```sh
npm --prefix server_own run start -- --host 0.0.0.0 --port 8787 --db "C:\\ProgramData\\RaceOffice\\data\\raceoffice.db"
```

Open:
- UI: `http://<server-host>:8787/`
- Health: `http://<server-host>:8787/health`

### Deploy folder (copy-only deployment)
Create a self-contained deployment folder under `./deploy/`:

```sh
npm run deploy
```

This creates (at least):
- `deploy/server/dist/` (compiled server)
- `deploy/server/public/` (built SPA)
- `deploy/server/node_modules/` (production dependencies)
- `deploy/server/RaceOfficeServer.xml` (WinSW service config; auto-generated if not provided)
- `deploy/DEPLOY-NEXT-STEPS.txt`

Optional (recommended for “copy-only” installs):
- Put a portable Node runtime at `tools/node/node.exe` (will be copied to `deploy/server/node/node.exe`)
- Put WinSW at `tools/winsw/RaceOfficeServer.exe` (and optionally `RaceOfficeServer.xml`)

### Server configuration (CLI / ENV)
Backend configuration (see `server_own/src/index.ts`) is read in this order:

1) CLI args:
- `--db <path>`: SQLite file path
- `--host <host>`: bind address (default `0.0.0.0`)
- `--port <port>`: listen port (default `8787`)

2) Environment variables:
- `RACEOFFICE_DB`, `HOST`, `PORT`

3) Defaults:
- DB defaults to `./data/raceoffice.db` relative to the current working directory

Recommended DB locations:
- Development: `./data/raceoffice.db`
- Windows Service: `C:\\ProgramData\\RaceOffice\\data\\raceoffice.db`

### Install as Windows Service (WinSW)
This project is designed to run as a standard Node process (no single-file EXE required). For Windows Services, use **WinSW**.

Typical service installation (run in an elevated shell) from the deployment folder:

```sh
cd deploy\server
RaceOfficeServer.exe install
RaceOfficeServer.exe start
```

Stop / uninstall:

```sh
RaceOfficeServer.exe stop
RaceOfficeServer.exe uninstall
```

Notes:
- Ensure `C:\\ProgramData\\RaceOffice\\data\\` exists and the service account has read/write permissions.
- The default service XML binds to `0.0.0.0` and uses port `8787`.

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

## 6) Running the project (reference)

Backend (`server_own/package.json`):
- `npm --prefix server_own run dev` starts `tsx watch src/index.ts` (development)
- `npm --prefix server_own run build` compiles TypeScript into `server_own/dist/`
- `npm --prefix server_own run start -- --host 0.0.0.0 --port 8787 --db <path>` runs the server

Frontend (root `package.json`):
- `npm run dev` starts the Vite dev server
- `npm run build` builds the SPA (recommended output dir: `server_own/public`)

Dev proxy setup is configured in `vite.config.ts`.



