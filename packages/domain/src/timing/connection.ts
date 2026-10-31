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
    doc.connectedDecoderIds.every((id) => typeof id === "string")
  );
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
