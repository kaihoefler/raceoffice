# Server Protocol (Realtime + Persistence)

This document describes how clients should use the backend in `apps/server/`.

## Overview

The server provides:
- HTTP health endpoint
- WebSocket realtime endpoint (read + write)
- SSE endpoint (read-only stream)
- SQLite persistence for document state

Document model:
- each document has `id`, `rev`, `data`
- writes are optimistic-concurrency controlled by `baseRev`

---

## Endpoints

### `GET /health`
Returns:
- `{ "ok": true }`

### `GET /ws/:docId` (WebSocket)
Primary realtime endpoint used by the frontend.

On connect:
- server registers socket in subscription set
- server sends a full snapshot immediately

Client can:
- receive snapshots and patches
- submit patches with `baseRev`

### `GET /sse/:docId` (Server-Sent Events)
Read-only stream for subscribers that do not write.

On connect:
- server registers SSE client
- server sends an initial snapshot event

---

## WebSocket Message Formats

## Server -> Client

### Snapshot
```json
{
  "type": "snapshot",
  "docId": "Event-...",
  "rev": 12,
  "data": { "...": "..." }
}
```

### Patch broadcast
```json
{
  "docId": "Event-...",
  "rev": 13,
  "patch": [
    { "op": "replace", "path": "/x", "value": 1 }
  ]
}
```

### Unified error message
```json
{
  "type": "error",
  "docId": "Event-...",
  "code": "rev_mismatch",
  "message": "Client baseRev is stale",
  "rev": 13,
  "retryable": true
}
```

Fields:
- `type`: always `"error"`
- `code`: machine-readable error code
- `message`: human-readable detail
- `rev` (optional): current server revision, if available
- `retryable` (optional): whether client can retry after re-sync

### Write ack
```json
{ "ok": true, "rev": 13 }
```

---

## Client -> Server (WebSocket)

### Patch write request
```json
{
  "baseRev": 12,
  "patch": [
    { "op": "replace", "path": "/x", "value": 1 }
  ]
}
```

Validation:
- `baseRev` must be a number
- `patch` must be an array of JSON-Patch operations

---

## Error Codes

Current codes sent as `type: "error"`:

- `invalid_json`
  - incoming WS message could not be parsed
- `invalid_payload`
  - payload does not match `{ baseRev:number, patch: Operation[] }`
- `rev_mismatch`
  - client is writing against an outdated revision
  - server also sends a fresh snapshot to re-sync the sender
- `patch_failed`
  - patch execution produced no `newDocument`
  - server also sends a fresh snapshot to re-sync the sender
- `patch_apply_failed`
  - exception while applying/processing patch
  - server does **not** crash
  - server also sends a fresh snapshot to re-sync the sender
- `internal_error`
  - reserved for generic internal failures

---

## Consistency and Failure Handling

Server guarantees:
- patch is applied only if `current.rev === baseRev`
- on successful write:
  1. patch is applied to current data
  2. new document persisted with `rev + 1`
  3. patch broadcast to subscribers
- on failure:
  - write is rejected
  - no partial persistence
  - no invalid broadcast
  - sender receives unified error message

This prevents server crashes from invalid patch operations and keeps other clients consistent.

---

## Recommended Client Behavior

When receiving `type: "error"`:

1. If `code === "rev_mismatch"`:
   - reconnect or request fresh snapshot
   - retry user action after local state is re-synced

2. If `code === "patch_apply_failed"` or `code === "patch_failed"`:
   - treat local state as stale
   - accept incoming snapshot from server
   - optionally show toast/error UI

3. For `invalid_json` / `invalid_payload`:
   - treat as client bug
   - log and surface diagnostics

---

## Notes

- The frontend currently supports both old and new error formats for compatibility.
- Preferred format is the unified `type: "error"` structure above.
