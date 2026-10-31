/**
 * timing/connection
 * -----------------
 * Which physical decoders the timing worker should be connected to.
 *
 * Domain rule (doc/timing-architecture.md, 5.1): nothing connects automatically. Decoders
 * accept only a few connections (often next to a timing software), so connecting is always an
 * explicit operator action. The wish is stored here and survives worker restarts.
 *
 * Transition (phase 1): the LiveTracking session in state `running` additionally connects the
 * decoders of its setup, so the existing control page keeps working until it gets an own
 * "connect" button.
 */

export type TimingConnectionDocument = {
  kind: "timingConnection";
  version: 1;
  /** Decoders to connect (register ids). Every other decoder is disconnected. */
  connectedDecoderIds: string[];
  /**
   * Setup activated in the Control Center: its decoders are offered for connecting, and the
   * LiveTracking measurement uses it (one place to choose). Absent in older documents.
   */
  activeSetupId?: string | null;
  updatedAt: string | null;
};

export function createTimingConnectionDocument(): TimingConnectionDocument {
  return { kind: "timingConnection", version: 1, connectedDecoderIds: [], updatedAt: null };
}

export function isTimingConnectionDocument(value: unknown): value is TimingConnectionDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const doc = value as Record<string, unknown>;
  return (
    doc.kind === "timingConnection" &&
    doc.version === 1 &&
    Array.isArray(doc.connectedDecoderIds) &&
    doc.connectedDecoderIds.every((id) => typeof id === "string") &&
    (doc.activeSetupId === undefined || doc.activeSetupId === null || typeof doc.activeSetupId === "string")
  );
}

/**
 * Connection wish for the decoders of a setup: `add` connects them in addition, `only` connects
 * exactly them (other decoders are disconnected).
 */
export function connectTimingDecoders(
  doc: TimingConnectionDocument,
  decoderIds: readonly string[],
  mode: "add" | "only",
  updatedAt: string,
): TimingConnectionDocument {
  const next = mode === "only" ? [...new Set(decoderIds)] : [...new Set([...doc.connectedDecoderIds, ...decoderIds])];
  if (JSON.stringify(next) === JSON.stringify(doc.connectedDecoderIds)) return doc;
  return { ...doc, connectedDecoderIds: next, updatedAt };
}

/** Returns the document with the decoder (dis)connected; unchanged if already so. */
export function setTimingDecoderConnected(
  doc: TimingConnectionDocument,
  decoderId: string,
  connected: boolean,
  updatedAt: string,
): TimingConnectionDocument {
  const has = doc.connectedDecoderIds.includes(decoderId);
  if (has === connected) return doc;
  const connectedDecoderIds = connected
    ? [...doc.connectedDecoderIds, decoderId]
    : doc.connectedDecoderIds.filter((id) => id !== decoderId);
  return { ...doc, connectedDecoderIds, updatedAt };
}
