// src/providers/RaceStatusProvider.tsx
//
// RaceStatusProvider
// ------------------
// Zweck:
// - Holt den Live-Rennstatus der Zeitnahme und extrahiert daraus das "currentRace"
// - Stellt Status/Fehler/Metadaten + Steuerfunktionen per React Context bereit
//
// Quellen (doc/leaderboard-integration/05-worker-und-steuerung.md):
// - "auto" (Default): Leaderboard-Service über den RaceOffice-Server (/leaderboard/…, WebSocket),
//   sobald dieser verfügbar ist; sonst die klassische URL der Java-App per Polling – ohne Service
//   bleibt das Verhalten also wie bisher.
// - "service": immer der Leaderboard-Service (WebSocket, bei Abbruch Polling als Fallback)
// - "java": Notfall – Java-RMonitorLeaderboard direkt per Polling (Default http://localhost:8080/…)
// - "custom": eigene URL per Polling (auch wenn der Provider eine feste `url` bekommt, z. B. in Tests)
// Die Auswahl wird im Browser gespeichert (localStorage).
//
// Wichtige Eigenschaften:
// - Polling: keine parallelen Requests, Pause, nach 10 Fehlern Faktor 10 langsamer,
//   Request-Timeout (3x Intervall, mind. 2 s)
// - WebSocket: Snapshot + JSON-Patch; jeder $F-Heartbeat erzeugt eine Nachricht, daher bleibt
//   die "> 3 s ohne Update = stale"-Regel in LiveRaceStatus gültig. Bricht der WebSocket ab,
//   übernimmt Polling, bis er wieder steht.
// - updatedAt wird NUR bei erfolgreichem Update gesetzt (Signal für "zuletzt erfolgreich verbunden")
//
// Abgrenzung (bitte beibehalten):
// - Dieser Provider ist reine Transportschicht: Abfrage, Fehler, Backoff, Pause.
//   Er liefert das rohe `currentRace` und enthält KEINE fachlichen Scoring-Regeln.
// - Vertrag des Feeds (Typen, pickCurrentRace): @raceoffice/domain, raceStatusFeed.ts
// - Fachliche Auswertung (Runde, Ausscheidung, Überrundung, Zielreihenfolge):
//   src/domain/liveScoring.ts, angebunden über pages/scoring/ScoringViewModel.tsx

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import fastJsonPatch from "fast-json-patch";
import {
  pickCurrentRace,
  type LeaderboardServiceStatus,
  type LeaderboardWsMessage,
  type RaceStatusRace,
} from "@raceoffice/domain";

export type LiveSource = "auto" | "service" | "java" | "custom";

/** Status of the leaderboard integration as reported by the RaceOffice server. */
export type LeaderboardIntegrationStatus = {
  mode: "managed" | "external" | "off";
  externalUrl: string | null;
  available: boolean;
  process: { state: "stopped" | "starting" | "running" | "stopping" | "crashed"; lastError: string | null };
  service: LeaderboardServiceStatus | null;
};

/**
 * Interner State des Providers.
 * `status` beschreibt den UI-Zustand:
 * - loading: initial / beim Start eines neuen Zyklus
 * - ok: letzte Anfrage war ok ODER wir zeigen weiterhin den letzten gültigen Stand
 * - error: keine gültigen Daten + letzte Anfrage schlug fehl
 * - paused: durch UI/Consumer pausiert
 */
export type RaceStatusState = {
  status: "idle" | "loading" | "ok" | "error" | "paused";
  error: string | null;

  /** Timestamp (ms) of the last SUCCESSFUL update */
  updatedAt: number | null;

  /** Aktuell als "active" identifiziertes Rennen (oder null wenn keines aktiv) */
  currentRace: RaceStatusRace | null;

  /** Gewählte Quelle */
  source: LiveSource;

  /** Eigene URL (Quelle "custom") */
  url: string;

  /** URL der Java-App (Quelle "java" bzw. Fallback von "auto") */
  javaUrl: string;

  /** Base poll interval (ms) configured by the user */
  pollIntervalMs: number;

  /** Wenn true, werden keine Requests abgesetzt */
  paused: boolean;

  /** How many requests failed in sequence (resets to 0 on successful fetch) */
  errorCount: number;
};

export type RaceStatusContextValue = RaceStatusState & {
  /** Actual poll interval currently used (may be increased after repeated failures) */
  effectivePollIntervalMs: number;
  /** Tatsächlich genutzter Weg: WebSocket oder Polling */
  transport: "ws" | "poll";
  /** Tatsächlich genutzter Endpunkt (für Anzeige/Tooltips) */
  endpoint: string;
  /** Leaderboard-Integration des RaceOffice-Servers (null = unbekannt/nicht erreichbar) */
  leaderboard: LeaderboardIntegrationStatus | null;
  /** Fragt den Status der Leaderboard-Integration sofort neu ab */
  refreshLeaderboard: () => void;
  setSource: (source: LiveSource) => void;
  setJavaUrl: (url: string) => void;
  /** Setzt eine eigene URL und schaltet auf die Quelle "custom" */
  setUrl: (nextUrl: string) => void;
  setPollIntervalMs: (nextMs: number) => void;
  setPaused: (paused: boolean) => void;
};

const RaceStatusContext = createContext<RaceStatusContextValue | null>(null);

type Props = {
  children: React.ReactNode;
  /** Feste URL (Tests/Dev): Quelle "custom", reines Polling, keine Server-Abfragen. */
  url?: string;
  pollIntervalMs?: number;
};

/**
 * How often an unchanged successful poll still refreshes `updatedAt` (and re-renders consumers).
 * Must stay well below the 3 s "no response" threshold of LiveRaceStatus.
 */
const UPDATED_AT_REFRESH_MS = 1000;

export const SERVICE_REST_PATH = "/leaderboard/races?filter=current";
export const SERVICE_WS_PATH = "/leaderboard/ws/race/current";
const LEADERBOARD_STATUS_PATH = "/leaderboard-service/status";
const LEADERBOARD_STATUS_INTERVAL_MS = 5000;
const STORAGE_KEY = "raceoffice.liveSource";

export const DEFAULT_JAVA_URL: string =
  ((import.meta as any).env?.VITE_RACE_STATUS_URL as string | undefined) ?? "http://localhost:8080/races?filter=current";

type Stored = { source?: LiveSource; url?: string; javaUrl?: string };

function loadStored(): Stored {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Stored) : {};
  } catch {
    return {};
  }
}

function saveStored(value: Stored): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // storage unavailable (private mode): selection is kept for this session only
  }
}

function serviceWsUrl(): string {
  const loc = globalThis.location;
  if (!loc?.host) return SERVICE_WS_PATH;
  return `${loc.protocol === "https:" ? "wss" : "ws"}://${loc.host}${SERVICE_WS_PATH}`;
}

/** Extracts the active race from a feed payload (array or single race). Empty flag = no active race. */
function activeRaceOf(payload: unknown): RaceStatusRace | null {
  const race = pickCurrentRace(Array.isArray(payload) ? payload : [payload]);
  const flag = String((race as any)?.flagStatus ?? "");
  return flag.trim() ? race : null;
}

export function RaceStatusProvider({ children, url, pollIntervalMs = 1000 }: Props) {
  const fixedUrl = url !== undefined;
  const stored = useMemo<Stored>(() => (fixedUrl ? {} : loadStored()), [fixedUrl]);

  const [state, setState] = useState<RaceStatusState>(() => ({
    status: "loading",
    error: null,
    updatedAt: null,
    currentRace: null,
    source: fixedUrl ? "custom" : (stored.source ?? "auto"),
    url: url ?? stored.url ?? DEFAULT_JAVA_URL,
    javaUrl: stored.javaUrl ?? DEFAULT_JAVA_URL,
    pollIntervalMs,
    paused: false,
    errorCount: 0,
  }));

  const [leaderboard, setLeaderboard] = useState<LeaderboardIntegrationStatus | null>(null);
  const [leaderboardRefresh, setLeaderboardRefresh] = useState(0);
  /** True while the WebSocket is down and polling has to take over. */
  const [wsDown, setWsDown] = useState(false);

  const inFlightRef = useRef<AbortController | null>(null);

  // --- persistence of the selection (not with a fixed url)
  useEffect(() => {
    if (fixedUrl) return;
    saveStored({ source: state.source, url: state.url, javaUrl: state.javaUrl });
  }, [fixedUrl, state.source, state.url, state.javaUrl]);

  // --- setters
  const setUrl = useCallback((nextUrl: string) => {
    const v = String(nextUrl ?? "").trim();
    if (!v) return;
    setState((prev) => ({ ...prev, url: v, source: "custom" }));
  }, []);

  const setJavaUrl = useCallback((nextUrl: string) => {
    const v = String(nextUrl ?? "").trim();
    if (!v) return;
    setState((prev) => ({ ...prev, javaUrl: v }));
  }, []);

  const setSource = useCallback((source: LiveSource) => {
    setState((prev) => (prev.source === source ? prev : { ...prev, source, currentRace: null, updatedAt: null, errorCount: 0 }));
  }, []);

  const setPollIntervalMs = useCallback((nextMs: number) => {
    const n = Number(nextMs);
    if (!Number.isFinite(n)) return;
    const clamped = Math.max(250, Math.min(60000, Math.floor(n)));
    setState((prev) => ({ ...prev, pollIntervalMs: clamped }));
  }, []);

  const setPaused = useCallback((paused: boolean) => {
    setState((prev) => ({
      ...prev,
      paused,
      status: paused ? "paused" : prev.status,
      error: paused ? null : prev.error,
    }));
  }, []);

  const refreshLeaderboard = useCallback(() => setLeaderboardRefresh((n) => n + 1), []);

  // --- leaderboard integration status (only for auto/service; not with a fixed url)
  const watchLeaderboard = !fixedUrl && (state.source === "auto" || state.source === "service");
  useEffect(() => {
    if (!watchLeaderboard) return;
    let mounted = true;
    const load = async () => {
      try {
        const res = await fetch(LEADERBOARD_STATUS_PATH, { headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as LeaderboardIntegrationStatus;
        if (mounted) setLeaderboard(body);
      } catch {
        if (mounted) setLeaderboard(null);
      }
    };
    void load();
    const t = setInterval(load, LEADERBOARD_STATUS_INTERVAL_MS);
    return () => {
      mounted = false;
      clearInterval(t);
    };
  }, [watchLeaderboard, leaderboardRefresh]);

  // --- effective endpoint
  const serviceAvailable = leaderboard?.available === true;
  const useService = state.source === "service" || (state.source === "auto" && serviceAvailable);
  // Java emergency fallback (external mode) has no WebSocket: poll through the proxy.
  const serviceHasWs = leaderboard?.mode !== "external";
  const transport: "ws" | "poll" = useService && serviceHasWs ? "ws" : "poll";
  const pollUrl =
    state.source === "custom" ? state.url : useService ? SERVICE_REST_PATH : state.javaUrl;
  const endpoint = transport === "ws" ? SERVICE_WS_PATH : pollUrl;
  const paused = state.paused;
  const pollActive = !paused && (transport === "poll" || wsDown);

  const effectivePollIntervalMs = useMemo(() => {
    const base = state.pollIntervalMs;
    if (state.errorCount >= 10 && state.errorCount > 0) return Math.min(60000, base * 10);
    return base;
  }, [state.pollIntervalMs, state.errorCount]);

  /** Common success path of polling and WebSocket. */
  const applyRace = useCallback((activeRace: RaceStatusRace | null) => {
    // Unveränderte Antworten lösen KEIN Re-Render aus: die ganze Scoring-Seite hängt an diesem
    // Context und würde sonst bei jedem Update neu rendern. Nur updatedAt wird spätestens alle
    // UPDATED_AT_REFRESH_MS erneuert, damit die "no response"-Anzeige (> 3 s) korrekt bleibt.
    // Bei unverändertem Inhalt bleibt außerdem das currentRace-Objekt dasselbe (stabile Memos).
    setState((prev) => {
      const now = Date.now();
      const sameRace = JSON.stringify(prev.currentRace) === JSON.stringify(activeRace);
      const wasHealthy = prev.status === "ok" && prev.error === null && prev.errorCount === 0;
      const contactIsFresh = prev.updatedAt != null && now - prev.updatedAt < UPDATED_AT_REFRESH_MS;
      if (sameRace && wasHealthy && contactIsFresh) return prev;
      return {
        ...prev,
        status: "ok",
        error: null,
        errorCount: 0,
        updatedAt: now,
        currentRace: sameRace ? prev.currentRace : activeRace,
      };
    });
  }, []);

  const applyError = useCallback((message: string) => {
    // updatedAt NICHT aktualisieren (wichtig für UI, um stale/offline zu erkennen); status bleibt
    // "ok", solange es einen letzten gültigen Stand gibt.
    setState((prev) => ({
      ...prev,
      status: prev.currentRace ? "ok" : "error",
      error: message,
      errorCount: (prev.errorCount ?? 0) + 1,
    }));
  }, []);

  // --- pause handling
  useEffect(() => {
    if (!paused) return;
    inFlightRef.current?.abort();
    inFlightRef.current = null;
    setState((prev) => ({ ...prev, status: "paused", error: null }));
  }, [paused]);

  // --- polling
  useEffect(() => {
    if (!pollActive) return;
    let mounted = true;

    async function pollOnce() {
      if (!mounted) return;
      // Avoid overlapping requests
      if (inFlightRef.current) return;
      const ac = new AbortController();
      inFlightRef.current = ac;

      // A request the timing system never answers must not stall the feed: polls are skipped
      // while a request is in flight, so without a timeout one hanging request would stop all
      // further updates. The timeout counts as a normal error (errorCount, backoff).
      const timeoutMs = Math.max(2000, effectivePollIntervalMs * 3);
      const timeout = setTimeout(
        () => ac.abort(new DOMException(`Timeout after ${timeoutMs} ms`, "TimeoutError")),
        timeoutMs,
      );

      try {
        const res = await fetch(pollUrl, { signal: ac.signal, headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as unknown;
        if (!mounted) return;
        applyRace(activeRaceOf(json));
      } catch (e: any) {
        if (!mounted) return;
        if (e?.name === "AbortError") return;
        applyError(String(e?.message ?? e));
      } finally {
        clearTimeout(timeout);
        inFlightRef.current = null;
      }
    }

    setState((prev) => ({ ...prev, status: "loading", error: null }));
    void pollOnce();
    const t = setInterval(pollOnce, effectivePollIntervalMs);

    return () => {
      mounted = false;
      clearInterval(t);
      inFlightRef.current?.abort();
      inFlightRef.current = null;
    };
  }, [pollActive, pollUrl, effectivePollIntervalMs, applyRace, applyError]);

  // --- WebSocket (leaderboard service)
  useEffect(() => {
    if (transport !== "ws" || paused) {
      setWsDown(false);
      return;
    }
    let disposed = false;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let backoffMs = 1000;
    let data: unknown = null;
    let rev: number | null = null;

    const connect = () => {
      if (disposed) return;
      try {
        socket = new WebSocket(serviceWsUrl());
      } catch {
        scheduleRetry();
        return;
      }
      const ws = socket;
      ws.onopen = () => {
        backoffMs = 1000;
      };
      ws.onmessage = (event) => {
        let msg: LeaderboardWsMessage;
        try {
          msg = JSON.parse(String(event.data)) as LeaderboardWsMessage;
        } catch {
          return;
        }
        if (msg.type === "snapshot") {
          data = msg.data;
          rev = msg.rev;
        } else if (msg.type === "patch") {
          if (rev === null || msg.baseRev !== rev) {
            // Missed an update: reconnect, the server sends a fresh snapshot.
            ws.close();
            return;
          }
          try {
            data = fastJsonPatch.applyPatch(structuredClone(data), msg.patch, true, false).newDocument;
          } catch {
            ws.close();
            return;
          }
          rev = msg.rev;
        } else {
          return;
        }
        setWsDown(false);
        applyRace(data === null ? null : activeRaceOf(data));
      };
      ws.onerror = () => {
        // onclose follows
      };
      ws.onclose = () => {
        if (disposed) return;
        rev = null;
        setWsDown(true);
        scheduleRetry();
      };
    };

    const scheduleRetry = () => {
      if (disposed || retryTimer) return;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        connect();
      }, backoffMs);
      backoffMs = Math.min(10_000, backoffMs * 2);
    };

    setState((prev) => ({ ...prev, status: prev.currentRace ? prev.status : "loading", error: null }));
    connect();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, [transport, paused, applyRace]);

  const value = useMemo<RaceStatusContextValue>(
    () => ({
      ...state,
      effectivePollIntervalMs,
      transport: transport === "ws" && !wsDown ? "ws" : "poll",
      endpoint: transport === "ws" && wsDown ? `${pollUrl} (WebSocket getrennt)` : endpoint,
      leaderboard,
      refreshLeaderboard,
      setSource,
      setJavaUrl,
      setUrl,
      setPollIntervalMs,
      setPaused,
    }),
    [
      state,
      effectivePollIntervalMs,
      transport,
      wsDown,
      pollUrl,
      endpoint,
      leaderboard,
      refreshLeaderboard,
      setSource,
      setJavaUrl,
      setUrl,
      setPollIntervalMs,
      setPaused,
    ],
  );

  return <RaceStatusContext.Provider value={value}>{children}</RaceStatusContext.Provider>;
}

/**
 * Hook für Consumer:
 * - liefert den Context Value
 * - wirft einen Fehler, wenn außerhalb des Providers genutzt
 */
export function useRaceStatus() {
  const ctx = useContext(RaceStatusContext);
  if (!ctx) throw new Error("useRaceStatus must be used within RaceStatusProvider");
  return ctx;
}
