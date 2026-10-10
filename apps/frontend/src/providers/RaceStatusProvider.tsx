// src/providers/RaceStatusProvider.tsx
//
// RaceStatusProvider
// ------------------
// Zweck:
// - Pollt periodisch einen REST-Endpunkt, der Live-Rennstatus liefert
// - Extrahiert daraus ein "currentRace" (das aktuell aktive Rennen)
// - Stellt Status/Fehler/Metadaten + Steuerfunktionen per React Context bereit
//
// Wichtige Eigenschaften:
// - Verhindert parallele Requests (inFlightRef)
// - Kann pausiert werden (paused)
// - Exponentielles/defensives Verhalten bei Ausfällen: nach 10 Fehlern Polling um Faktor 10 verlangsamen
// - updatedAt wird NUR bei erfolgreichem Update gesetzt (Signal für "zuletzt erfolgreich verbunden")
// - Request-Timeout (3x Poll-Intervall, mind. 2 s): eine hängende Anfrage zählt als Fehler
//   und blockiert das Polling nicht dauerhaft
//
// Abgrenzung (bitte beibehalten):
// - Dieser Provider ist reine Transportschicht: Abfrage, Fehler, Backoff, Pause.
//   Er liefert das rohe `currentRace` und enthält KEINE fachlichen Scoring-Regeln.
// - Vertrag des Feeds (Typen, pickCurrentRace): @raceoffice/domain, raceStatusFeed.ts
// - Fachliche Auswertung (Runde, Ausscheidung, Überrundung, Zielreihenfolge):
//   src/domain/liveScoring.ts, angebunden über pages/scoring/ScoringViewModel.tsx

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { pickCurrentRace, type RaceStatusRace } from "@raceoffice/domain";

/**
 * Interner State des Providers.
 * `status` beschreibt den UI-Zustand:
 * - idle: (derzeit nicht verwendet, aber möglich)
 * - loading: initial / beim Start eines neuen Poll-Zyklus
 * - ok: letzte Anfrage war ok ODER wir zeigen weiterhin den letzten gültigen Stand
 * - error: keine gültigen Daten + letzte Anfrage schlug fehl
 * - paused: Polling durch UI/Consumer pausiert
 */
export type RaceStatusState = {
  status: "idle" | "loading" | "ok" | "error" | "paused";
  error: string | null;

  /** Timestamp (ms) of the last SUCCESSFUL update */
  updatedAt: number | null;

  /** Aktuell als "active" identifiziertes Rennen (oder null wenn keines aktiv) */
  currentRace: RaceStatusRace | null;

  /** Aktuell verwendete URL für den Poll */
  url: string;

  /** Base poll interval (ms) configured by the user */
  pollIntervalMs: number;

  /** Wenn true, werden keine Requests abgesetzt */
  paused: boolean;

  /** How many requests failed in sequence (resets to 0 on successful fetch) */
  errorCount: number;
};

/**
 * Public Context Value:
 * - enthält den kompletten State
 * - plus berechnetes effectivePollIntervalMs
 * - plus Setter-Funktionen
 */
export type RaceStatusContextValue = RaceStatusState & {
  /** Actual poll interval currently used (may be increased after repeated failures) */
  effectivePollIntervalMs: number;
  setUrl: (nextUrl: string) => void;
  setPollIntervalMs: (nextMs: number) => void;
  setPaused: (paused: boolean) => void;
};

/** Context wird initial mit null erstellt; Zugriff nur über useRaceStatus() erlaubt. */
const RaceStatusContext = createContext<RaceStatusContextValue | null>(null);

/**
 * Provider-Props:
 * - url optional: erlaubt Override (z.B. Tests/Dev)
 * - pollIntervalMs optional: initiale Pollrate
 */
type Props = {
  children: React.ReactNode;
  /** Override the REST endpoint. Default: VITE_RACE_STATUS_URL or http://localhost:8080/races?filter=current */
  url?: string;
  pollIntervalMs?: number;
};

/**
 * How often an unchanged successful poll still refreshes `updatedAt` (and re-renders consumers).
 * Must stay well below the 3 s "no response" threshold of LiveRaceStatus.
 */
const UPDATED_AT_REFRESH_MS = 1000;

export function RaceStatusProvider({ children, url, pollIntervalMs = 1000 }: Props) {
  /**
   * Bestimmt die URL:
   * - Prop-Override hat Priorität
   * - sonst Environment (VITE_RACE_STATUS_URL)
   * - sonst Default localhost
   */
  const defaultUrl =
    url ??
    (import.meta as any).env?.VITE_RACE_STATUS_URL ??
    "http://localhost:8080/races?filter=current";

  /**
   * Initialer State:
   * - status "loading": wir starten direkt mit dem Polling
   * - updatedAt null: noch kein erfolgreiches Update
   * - errorCount 0: noch keine Fehler
   */
  const [state, setState] = useState<RaceStatusState>({
    status: "loading",
    error: null,
    updatedAt: null,
    currentRace: null,
    url: defaultUrl,
    pollIntervalMs,
    paused: false,
    errorCount: 0,
  });

  /**
   * inFlightRef verhindert überlappende Requests:
   * - sobald ein Request läuft, ist es nicht null
   * - beim Ende (finally) wird es wieder null
   */
  const inFlightRef = useRef<AbortController | null>(null);

  /**
   * Setter: URL setzen
   * - trim + Guard, damit nicht leer gesetzt werden kann
   */
  const setUrl = (nextUrl: string) => {
    const v = String(nextUrl ?? "").trim();
    if (!v) return;
    setState((prev) => ({ ...prev, url: v }));
  };

  /**
   * Setter: Poll-Intervall setzen (ms)
   * - clamp: min 250ms, max 60s
   * - floor: Ganzzahl
   */
  const setPollIntervalMs = (nextMs: number) => {
    const n = Number(nextMs);
    if (!Number.isFinite(n)) return;
    const clamped = Math.max(250, Math.min(60000, Math.floor(n)));
    setState((prev) => ({ ...prev, pollIntervalMs: clamped }));
  };

  /**
   * Setter: Pause toggeln
   * - Wenn pausiert: status=paused und error wird geleert
   * - Wenn resume: status bleibt zunächst wie vorher (wird im Effect auf loading gesetzt)
   */
  const setPaused = (paused: boolean) => {
    setState((prev) => ({
      ...prev,
      paused,
      status: paused ? "paused" : prev.status,
      error: paused ? null : prev.error,
    }));
  };

  // Aus dem State extrahierte Werte, damit useEffect Dependencies stabil/lesbar bleiben.
  const resolvedUrl = state.url;
  const paused = state.paused;

  /**
   * effectivePollIntervalMs:
   * - Normal: pollIntervalMs
   * - Nach >= 10 aufeinanderfolgenden Fehlern: poll langsamer (Faktor 10), max. 60s
   * Motivation:
   * - schont Backend/Netzwerk bei Ausfällen
   * - UI bleibt trotzdem "online" sobald wieder erreichbar (Fehlerzähler reset bei Erfolg)
   */
  const effectivePollIntervalMs = useMemo(() => {
    const base = state.pollIntervalMs;
    if (state.errorCount >= 10 && state.errorCount > 0) return Math.min(60000, base * 10);
    return base;
  }, [state.pollIntervalMs, state.errorCount]);

  /**
   * Polling-Effect:
   * - startet initial sofort
   * - wiederholt sich im Intervall effectivePollIntervalMs
   * - reagiert auf url / interval / paused
   *
   * Cleanup:
   * - clearInterval
   * - abort in-flight request
   */
  useEffect(() => {
    let mounted = true;

    async function pollOnce() {
      if (!mounted) return;
      if (paused) return;

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
        const res = await fetch(resolvedUrl, { signal: ac.signal, headers: { Accept: "application/json" } });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        // Payload kann beliebig sein; wir normalisieren es über pickCurrentRace(...)
        const json = (await res.json()) as unknown;
        const currentRace = pickCurrentRace(json);

        // Ignore payload when no race is active (flagStatus empty)
        const flag = String((currentRace as any)?.flagStatus ?? "");
        const activeRace = flag.trim() ? currentRace : null;

        if (!mounted) return;

        // Erfolgsfall: status ok, Fehler zurückgesetzt, updatedAt = letzter erfolgreicher Kontakt,
        // currentRace = aktives Rennen (oder null).
        //
        // Unveränderte Antworten lösen KEIN Re-Render aus: die ganze Scoring-Seite hängt an diesem
        // Context und würde sonst bei jedem Poll neu rendern. Nur updatedAt wird spätestens alle
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
      } catch (e: any) {
        if (!mounted) return;
        if (e?.name === "AbortError") return;

        // Fehlerfall:
        // - updatedAt NICHT aktualisieren (wichtig für UI, um stale/offline zu erkennen)
        // - status bleibt "ok" wenn wir noch einen letzten gültigen currentRace haben
        //   (UI kann dann weiterhin die letzte bekannte Anzeige zeigen)
        // - ansonsten status="error"
        setState((prev) => ({
          ...prev,
          status: prev.currentRace ? "ok" : "error",
          error: String(e?.message ?? e),
          errorCount: (prev.errorCount ?? 0) + 1,
        }));
      } finally {
        // Mark request as finished
        clearTimeout(timeout);
        inFlightRef.current = null;
      }
    }

    // Wenn pausiert:
    // - laufenden Request abbrechen
    // - status=paused setzen
    // - Effekt frühzeitig beenden (kein Interval)
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

    // Start: UI auf loading setzen und sofort einmal pollen.
    setState((prev) => ({ ...prev, status: "loading", error: null }));
    pollOnce();

    // Wiederholung im Intervall
    const t = setInterval(pollOnce, effectivePollIntervalMs);

    return () => {
      mounted = false;
      clearInterval(t);
      inFlightRef.current?.abort();
      inFlightRef.current = null;
    };
  }, [resolvedUrl, effectivePollIntervalMs, paused]);

  /**
   * Context Value:
   * - State + computed effectivePollIntervalMs
   * - Setter-Funktionen
   * useMemo verhindert unnötige Re-Renders der Consumer.
   */
  const value = useMemo(
    () => ({
      ...state,
      effectivePollIntervalMs,
      setUrl,
      setPollIntervalMs,
      setPaused,
    }),
    [state, effectivePollIntervalMs],
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