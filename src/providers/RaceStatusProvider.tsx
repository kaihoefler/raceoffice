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

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

/**
 * Flag-Status aus dem Live-System.
 * Hinweis: hier ist "Purple" auffällig gemischt geschrieben; evtl. kommt es so aus dem Backend.
 * `string` erlaubt unbekannte/weitere Flags ohne Type-Änderungen.
 */
export type RaceStatusFlag = "GREEN" | "Purple" | "FINISH" | string;

/**
 * Ein einzelner Fahrer/Starter im Live-Status-Feed.
 * `number` ist der Bib als String (kommt so aus dem Feed), z.B. "12".
 */
export type RaceStatusCompetitor = {
  number: string; // bib
  position: number;
  lapsComplete: number;
  firstName: string;
  lastName: string;
  totalTime: string; // e.g. "0:15" or "0:15.032"
};

/**
 * Live-Rennstatus für ein Rennen.
 * Wird aus dem REST-Feed übernommen.
 */
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
  /** Override the REST endpoint. Default: LIVE_RACE_STATUS_URL or http://localhost:8080/races?filter=current */
  url?: string;
  pollIntervalMs?: number;
};

/**
 * Extrahiert aus dem REST-Payload das "current" race.
 *
 * Erwartung:
 * - payload ist ein Array mit Race-Objekten (Backend liefert Liste)
 * Strategie:
 * - nimm das erste Element, das ein nicht-leeres flagStatus hat
 * - wenn nichts passt: null
 *
 * (Damit kann der Provider auch mit Feeds umgehen, die mehrere Rennen liefern.)
 */
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

        // Erfolgsfall:
        // - status ok
        // - error cleared
        // - errorCount reset
        // - updatedAt setzt "letzter erfolgreicher Kontakt"
        // - currentRace wird aktualisiert (oder null, falls kein aktives Rennen)
        setState((prev) => ({
          ...prev,
          status: "ok",
          error: null,
          errorCount: 0,
          updatedAt: Date.now(),
          currentRace: activeRace,
        }));
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