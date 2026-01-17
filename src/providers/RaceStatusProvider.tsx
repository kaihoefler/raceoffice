import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

export type RaceStatusFlag = "GREEN" | "Purple" | "FINISH" | string;

export type RaceStatusCompetitor = {
  number: string; // bib
  position: number;
  lapsComplete: number;
  firstName: string;
  lastName: string;
  totalTime: string; // e.g. "0:15" or "0:15.032"
};

export type RaceStatusRace = {
  raceName: string;
  raceID: number;
  flagStatus: RaceStatusFlag;
  elapsedTime?: string;
  timeOfDay?: string;
  lapsComplete?: number;
  lapsToGo?: number;
  competitors: RaceStatusCompetitor[];
};

export type RaceStatusState = {
  status: "idle" | "loading" | "ok" | "error" | "paused";
  error: string | null;
  updatedAt: number | null;
  currentRace: RaceStatusRace | null;
  url: string;
  pollIntervalMs: number;
  paused: boolean;
};

export type RaceStatusContextValue = RaceStatusState & {
  setUrl: (nextUrl: string) => void;
  setPollIntervalMs: (nextMs: number) => void;
  setPaused: (paused: boolean) => void;
};

const RaceStatusContext = createContext<RaceStatusContextValue | null>(null);


type Props = {
  children: React.ReactNode;
  /** Override the REST endpoint. Default: VITE_RACE_STATUS_URL or http://localhost:8080/races?filter=current */
  url?: string;
  pollIntervalMs?: number;
};

function pickCurrentRace(payload: unknown): RaceStatusRace | null {
  const arr = Array.isArray(payload) ? (payload as any[]) : [];
  if (!arr.length) return null;

  // Prefer the first entry that actually has a flagStatus
  for (const item of arr) {
    const flag = String(item?.flagStatus ?? "");
    if (flag.trim()) return item as RaceStatusRace;
  }

  return null;
}

export function RaceStatusProvider({ children, url, pollIntervalMs = 1000 }: Props) {
  const defaultUrl =
    url ??
    (import.meta as any).env?.VITE_RACE_STATUS_URL ??
    "http://localhost:8080/races?filter=current";

  const [state, setState] = useState<RaceStatusState>({
    status: "loading",
    error: null,
    updatedAt: null,
    currentRace: null,
    url: defaultUrl,
    pollIntervalMs,
    paused: false,
  });

  const inFlightRef = useRef<AbortController | null>(null);

  const setUrl = (nextUrl: string) => {
    const v = String(nextUrl ?? "").trim();
    if (!v) return;
    setState((prev) => ({ ...prev, url: v }));
  };

  const setPollIntervalMs = (nextMs: number) => {
    const n = Number(nextMs);
    if (!Number.isFinite(n)) return;
    const clamped = Math.max(250, Math.min(60000, Math.floor(n)));
    setState((prev) => ({ ...prev, pollIntervalMs: clamped }));
  };

  const setPaused = (paused: boolean) => {
    setState((prev) => ({
      ...prev,
      paused,
      status: paused ? "paused" : prev.status,
      error: paused ? null : prev.error,
    }));
  };

  const resolvedUrl = state.url;
  const resolvedPollMs = state.pollIntervalMs;
  const paused = state.paused;

  useEffect(() => {
    let mounted = true;

    async function pollOnce() {
      if (!mounted) return;
      if (paused) return;

      // Avoid overlapping requests
      if (inFlightRef.current) return;
      const ac = new AbortController();
      inFlightRef.current = ac;

            try {
        const res = await fetch(resolvedUrl, { signal: ac.signal, headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const json = (await res.json()) as unknown;
        const currentRace = pickCurrentRace(json);

        // Ignore payload when no race is active (flagStatus empty)
        const flag = String((currentRace as any)?.flagStatus ?? "");
        const activeRace = flag.trim() ? currentRace : null;

        if (!mounted) return;
        setState((prev) => ({
          ...prev,
          status: "ok",
          error: null,
          updatedAt: Date.now(),
          currentRace: activeRace,
        }));
      } catch (e: any) {
        if (!mounted) return;
        if (e?.name === "AbortError") return;

        setState((prev) => ({
          ...prev,
          status: prev.currentRace ? "ok" : "error",
          error: String(e?.message ?? e),
          updatedAt: Date.now(),
        }));
      } finally {
        inFlightRef.current = null;
      }
    }

    // When paused: stop polling and abort in-flight request.
    if (paused) {
      inFlightRef.current?.abort();
      inFlightRef.current = null;

      setState((prev) => ({
        ...prev,
        status: "paused",
        error: null,
      }));

      return () => {
        mounted = false;
      };
    }

    // Initial + interval
    setState((prev) => ({ ...prev, status: "loading", error: null }));
    pollOnce();
    const t = setInterval(pollOnce, resolvedPollMs);

    return () => {
      mounted = false;
      clearInterval(t);
      inFlightRef.current?.abort();
      inFlightRef.current = null;
    };
  }, [resolvedUrl, resolvedPollMs, paused]);

  const value = useMemo(() => ({ ...state, setUrl, setPollIntervalMs, setPaused }), [state]);
  return <RaceStatusContext.Provider value={value}>{children}</RaceStatusContext.Provider>;
}

export function useRaceStatus() {
  const ctx = useContext(RaceStatusContext);
  if (!ctx) throw new Error("useRaceStatus must be used within RaceStatusProvider");
  return ctx;
}

