// Active setup: chosen in the timing Control Center (timingConnection.activeSetupId); the
// LiveTracking measurement uses it (its session setup is set on activation). One place to choose.

import {
  getSetupDecoderIds,
  makeLiveTrackingListDocId,
  makeLiveTrackingSessionDocId,
  makeLiveTrackingSetupDocId,
  TIMING_CONNECTION_DOC_ID,
  type LiveTrackingListDocument,
  type LiveTrackingSessionDocument,
  type LiveTrackingSetupDocument,
  type TimingConnectionDocument,
} from "@raceoffice/domain";

import { useRealtimeDoc } from "../realtime/useRealtimeDoc";
import { nowIso } from "./timingShared";

export function useActiveSetup() {
  const { data: connection, update: updateConnection } = useRealtimeDoc<TimingConnectionDocument>(TIMING_CONNECTION_DOC_ID);
  const { data: session, update: updateSession } = useRealtimeDoc<LiveTrackingSessionDocument>(makeLiveTrackingSessionDocId());
  const { data: list } = useRealtimeDoc<LiveTrackingListDocument>(makeLiveTrackingListDocId());

  // Older connection documents have no active setup yet: the session setup is it.
  const activeSetupId = String(connection?.activeSetupId ?? session?.setupId ?? "").trim();
  const { data: setup } = useRealtimeDoc<LiveTrackingSetupDocument>(activeSetupId ? makeLiveTrackingSetupDocId(activeSetupId) : null);
  const measurementRunning = session?.state === "running";
  const entry = list?.setups.find((s) => s.setupId === activeSetupId) ?? null;

  /** Activates a setup; not while a measurement runs (it would change under the measurement). */
  const activate = (setupId: string) => {
    if (measurementRunning) return;
    updateConnection((prev) => ({ ...prev, activeSetupId: setupId || null, updatedAt: nowIso() }));
    updateSession((prev) => (prev.setupId === setupId ? prev : { ...prev, setupId, updatedAt: nowIso() }));
  };

  return {
    activeSetupId,
    setup,
    name: entry?.name || setup?.name || activeSetupId,
    setups: list?.setups ?? [],
    decoderIds: setup ? getSetupDecoderIds(setup) : [],
    measurementRunning,
    activate,
  };
}
