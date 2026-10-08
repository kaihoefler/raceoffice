import { applyPatch } from "fast-json-patch/index.mjs";
import type { Operation } from "fast-json-patch/index.mjs";
import type { Doc } from "./docStore.js";

/**
 * Canonical websocket error codes returned to patch clients.
 * Keeping explicit codes allows clients to react deterministically.
 */
export type WsErrorCode =
  | "invalid_json"
  | "invalid_payload"
  | "rev_mismatch"
  | "patch_failed"
  | "patch_apply_failed"
  | "internal_error";

export type WsErrorPayload = {
  type: "error";
  docId: string;
  code: WsErrorCode;
  message: string;
  rev?: number | null;
  retryable?: boolean;
};

export type ClientWrite = { baseRev: number; patch: Operation[] };

export type ProtocolRejection = {
  ok: false;
  code: WsErrorCode;
  message: string;
  /** Re-send a snapshot so the client can re-sync (stale or failed write). */
  resync: boolean;
  /** Current server revision to report, if the document was loaded. */
  rev?: number;
  cause?: unknown;
};

/**
 * Parses one raw client frame. Expected shape: `{ baseRev: number, patch: Operation[] }`.
 */
export function parseClientWrite(raw: string): ({ ok: true } & ClientWrite) | ProtocolRejection {
  let msg: any;
  try {
    msg = JSON.parse(raw);
  } catch {
    return { ok: false, code: "invalid_json", message: "Message must be valid JSON", resync: false };
  }

  const { baseRev, patch } = (msg ?? {}) as Partial<ClientWrite>;
  if (!Array.isArray(patch) || typeof baseRev !== "number") {
    return {
      ok: false,
      code: "invalid_payload",
      message: "Payload must contain { baseRev:number, patch: Operation[] }",
      resync: false,
    };
  }

  return { ok: true, baseRev, patch };
}

/**
 * Applies a validated client write to the current document (pure; no persistence/broadcast).
 *
 * Rules:
 * - the write is accepted only if `baseRev === current.rev`
 * - operations are validated by fast-json-patch; invalid/failed ops reject the whole write
 * - an accepted write yields `rev + 1`
 */
export function applyClientWrite(current: Doc, write: ClientWrite): { ok: true; next: Doc } | ProtocolRejection {
  if (current.rev !== write.baseRev) {
    return { ok: false, code: "rev_mismatch", message: "Client baseRev is stale", resync: true, rev: current.rev };
  }

  let newDocument: unknown;
  try {
    newDocument = applyPatch(structuredClone(current.data), write.patch, /*validate*/ true, /*mutate*/ true).newDocument;
  } catch (err) {
    const causeCode = String((err as any)?.name ?? "unknown_error");
    const causeMessage = String((err as any)?.message ?? "Patch processing failed");
    return {
      ok: false,
      code: "patch_apply_failed",
      message: `${causeCode}: ${causeMessage}`,
      resync: true,
      rev: current.rev,
      cause: err,
    };
  }

  if (newDocument === undefined) {
    return {
      ok: false,
      code: "patch_failed",
      message: "Patch did not produce a new document",
      resync: true,
      rev: current.rev,
    };
  }

  return { ok: true, next: { rev: current.rev + 1, data: newDocument } };
}
