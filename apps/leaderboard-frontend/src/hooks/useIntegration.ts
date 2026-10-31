// useIntegration: leaderboard integration of the RaceOffice server (managed service process).
//
// Only behind RaceOffice (/leaderboard/ui/); standalone there is nothing to start and the hook
// stays idle. Polls the status every few seconds and triggers an immediate reconnect of the
// service connections as soon as the service becomes available.

import { useCallback, useEffect, useRef, useState } from "react";
import { integrationApi, integrationBase, requestReconnect, type IntegrationStatus } from "../api";

export const INTEGRATION_POLL_MS = 3000;

export type Integration = {
  /** Null standalone or while unknown. */
  status: IntegrationStatus | null;
  starting: boolean;
  error: string | null;
  start: () => Promise<void>;
};

export function useIntegration(): Integration {
  const base = integrationBase();
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wasAvailable = useRef<boolean | null>(null);

  const load = useCallback(async () => {
    if (!base) return;
    let next: IntegrationStatus | null = null;
    try {
      next = await integrationApi.status(base);
    } catch {
      next = null;
    }
    setStatus(next);
    const available = next?.available ?? null;
    if (available && wasAvailable.current === false) requestReconnect();
    wasAvailable.current = available;
  }, [base]);

  useEffect(() => {
    if (!base) return;
    void load();
    const timer = setInterval(() => void load(), INTEGRATION_POLL_MS);
    return () => clearInterval(timer);
  }, [base, load]);

  const start = useCallback(async () => {
    if (!base) return;
    setStarting(true);
    setError(null);
    try {
      const result = await integrationApi.start(base);
      if (!result.ok) setError(result.message ?? "Start fehlgeschlagen");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStarting(false);
      await load();
    }
  }, [base, load]);

  return { status, starting, error, start };
}
