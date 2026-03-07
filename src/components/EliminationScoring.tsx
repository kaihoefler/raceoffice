// src/components/EliminationScoring.tsx
//
// UI for recording elimination-related race activities:
// - Elim: elimination activity per lap with multiple bibs
// - DNS/DSQ: one activity per bib (optionally appended atomically for non-optimistic backend)
//
// Optional live-sync helpers (controlled by the page):
// - sync lap number from live feed
// - prefill last eligible bib(s) from live ranking (for 1- or 2-elim workflows)
// - DNS helper: insert all bibs that still have 0 laps in the live feed

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";

import { createFilterOptions } from "@mui/material/useAutocomplete";

import PointsBibField, { type AthleteFilterOptions } from "./PointsBibField";
import ScoringStarterList from "./ScoringStarterList";

import type { Athlete } from "../types/athlete";
import type { Race } from "../types/race";
import type {
  RaceActivity,
  RaceActivityDisqualfication,
  RaceActivityDns,
  RaceActivityElimination,
} from "../types/raceactivities";

/**
 * Which "activity type" is currently being recorded.
 * - elim1/elim2 => RaceActivityElimination (single activity; 1 or 2 bibs)
 * - DNS/DSQ => multiple activities (one per bib)
 */
export type EliminationMode = "elim1" | "elim2" | "DNS" | "DSQ";

type Props = {
  /** Active race (comes from the page) */
  race: Race;
  /** Use e.g. race.id so the component resets when switching races */
  resetKey?: string;

  /** Add a new activity to the race */
  onAddRaceActivity: (activity: RaceActivity) => void;
  /** Optional: add multiple activities atomically (important for non-optimistic backend). */
  onAddRaceActivities?: (activities: RaceActivity[]) => void;

  /** Optional: when a bib is not in starters, ask to create it (same flow as PointsScoring). */
  onCreateStarters?: (bibs: number[]) => Promise<void> | void;
  onDeleteStarter?: (starter: Athlete) => void;
  missingInLiveBibs?: Set<number>;

  /** If true, EliminationScoring can react to live lap changes + prefill last-place bib. */
  syncEnabled?: boolean;
  /** Live lap count (typically RaceStatusRace.lapsComplete). */
  liveLapCount?: number | null;
  /**
   * Last eligible bibs in live ranking (worst positions).
   * Used to prefill Elim inputs when sync is enabled.
   */
  liveLastEligibleBibs?: { lastBib: number | null; secondLastBib: number | null };

  /** Bibs with 0 lapsComplete in live feed (typically DNS candidates). */
  liveZeroLapBibs?: number[];
};

function athleteLabel(a: Athlete) {
  return `${a.bib ?? ""} - ${(a.lastName ?? "").trim()} ${(a.firstName ?? "").trim()}`.trim();
}

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/**
 * Parse a bib input into a positive integer.
 * Returns null for empty/invalid input.
 */
function bibToInt(input: string): number | null {
  const v = String(input ?? "").trim();
  if (!v) return null;
  if (!/^[0-9]+$/.test(v)) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  return i > 0 ? i : null;
}

/** Build a RaceActivityElimination for the given lap and bib list. */
function toEliminationActivity(lap: number, bibs: number[]): RaceActivityElimination {
  return {
    id: newId(),
    createdAt: new Date().toISOString(),
    type: "elimination",
    data: {
      lap,
      isDeleted: false,
      results: bibs.map((bib) => ({ bib })),
      history: [],
    },
  };
}

function toDnsActivity(bib: number): RaceActivityDns {
  return {
    id: newId(),
    createdAt: new Date().toISOString(),
    type: "DNS",
    data: {
      isDeleted: false,
      bib,
      history: [],
    },
  };
}

function toDsqActivity(bib: number): RaceActivityDisqualfication {
  return {
    id: newId(),
    createdAt: new Date().toISOString(),
    type: "DSQ",
    data: {
      isDeleted: false,
      bib,
      history: [],
    },
  };
}

export default function EliminationScoring({
  race,
  resetKey,
  onAddRaceActivity,
  onAddRaceActivities,
  onCreateStarters,
  onDeleteStarter,
  missingInLiveBibs,
  syncEnabled = false,
  liveLapCount = null,
  liveLastEligibleBibs = { lastBib: null, secondLastBib: null },
  liveZeroLapBibs = [],
}: Props) {
  // ---------------------------------------------------------------------------
  // Derived data: starters + lookup maps
  // ---------------------------------------------------------------------------
  const starters = useMemo(() => {
    const s = race.raceStarters ?? [];
    return [...s].sort((a, b) => {
      const ai = a.bib ?? Number.MAX_SAFE_INTEGER;
      const bi = b.bib ?? Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return (a.lastName ?? "").localeCompare(b.lastName ?? "", undefined, { sensitivity: "base" });
    });
  }, [race.raceStarters]);

  const starterByBib = useMemo(() => {
    const m = new Map<number, Athlete>();
    for (const a of starters) {
      if (a.bib != null) m.set(a.bib, a);
    }
    return m;
  }, [starters]);

  // ---------------------------------------------------------------------------
  // Local UI state
  // ---------------------------------------------------------------------------
  const [mode, setMode] = useState<EliminationMode>("elim1");
  const [lap, setLap] = useState<number>(1);

  // "Elim" input modes are fixed-size (either 1 bib or 2 bibs).
  const isElim1 = mode === "elim1";
  const isElim2 = mode === "elim2";
  const isFixedElimMode = isElim1 || isElim2;
  const elimBibCount = isElim2 ? 2 : 1;

  // DNS/DSQ support an auto-growing row list.
  const allowAutoGrow = mode === "DNS" || mode === "DSQ";

  // Bib input rows:
  // - `sel`: selected Athlete from autocomplete (or placeholder)
  // - `input`: raw text in the input
  const [rows, setRows] = useState<Array<{ sel: Athlete | null; input: string }>>([{ sel: null, input: "" }]);
  const [error, setError] = useState<string | null>(null);

  // Beim Wechsel auf DNS/DSQ Eingaben immer leeren.
  useEffect(() => {
    if (mode !== "DNS" && mode !== "DSQ") return;

    setRows([{ sel: null, input: "" }]);
    setError(null);
    focusIndex(0);
  }, [mode]);

  // Normalize row count when switching modes:
  // - elim1/elim2 => exactly 1 or 2 rows
  // - DNS/DSQ => keep current rows but ensure a trailing empty row exists
  useEffect(() => {
    setRows((prev) => {
      if (isFixedElimMode) {
        const next = prev.slice(0, elimBibCount);
        while (next.length < elimBibCount) next.push({ sel: null, input: "" });

        // Avoid pointless state updates.
        const isSame =
          next.length === prev.length && next.every((r, i) => r === prev[i]);
        return isSame ? prev : next;
      }

      const safePrev = prev.length ? prev : [{ sel: null, input: "" }];
      const last = safePrev[safePrev.length - 1];
      const lastIsEmpty = !last?.sel && !String(last?.input ?? "").trim();
      return lastIsEmpty ? safePrev : [...safePrev, { sel: null, input: "" }];
    });

    // Clear any stale error when switching modes.
    setError(null);
  }, [isFixedElimMode, elimBibCount, allowAutoGrow]);

  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const saveButtonRef = useRef<HTMLButtonElement | null>(null);

  // ---------------------------------------------------------------------------
  // Dialog: missing starters (non-optimistic flow)
  // ---------------------------------------------------------------------------
  const [missingDialogOpen, setMissingDialogOpen] = useState(false);
  const [missingDialogBibs, setMissingDialogBibs] = useState<number[]>([]);
  const [missingDialogBusy, setMissingDialogBusy] = useState(false);

  // Delay the actual save until created starters arrive in local state.
  const pendingSaveRef = useRef<null | (() => void)>(null);
  const [pendingSaveBibs, setPendingSaveBibs] = useState<number[] | null>(null);

  function openMissingStartersDialog(bibs: number[]) {
    setMissingDialogBibs(bibs);
    setMissingDialogOpen(true);
  }

  function closeMissingStartersDialog() {
    setMissingDialogOpen(false);
    setMissingDialogBibs([]);
  }

  // After missing starters were created and arrived in local state, run the pending save.
  useEffect(() => {
    if (!pendingSaveBibs?.length) return;

    const allPresent = pendingSaveBibs.every((bib) => starterByBib.has(bib));
    if (!allPresent) return;

    const run = pendingSaveRef.current;
    pendingSaveRef.current = null;
    setPendingSaveBibs(null);
    run?.();
  }, [pendingSaveBibs, starterByBib]);

  // Reset when race changes
  useEffect(() => {
    setMode("elim1");
    setLap(1);
    setRows([{ sel: null, input: "" }]);
    setError(null);

    closeMissingStartersDialog();
    pendingSaveRef.current = null;
    setPendingSaveBibs(null);

    // reset live-sync tracking
    prevLiveLapRef.current = null;
    autoPrefillBibsRef.current = { bib0: null, bib1: null };

    setTimeout(() => inputRefs.current[0]?.focus(), 0);
  }, [race.id, resetKey]);

  // Parse/normalize bibs from the UI rows:
  // - accepts either selected Athlete (`sel.bib`) or plain typed input
  // - deduplicates bibs while preserving input order
  const parsedBibs = useMemo(() => {
    const seen = new Set<number>();
    const out: number[] = [];

    for (const r of rows) {
      const bib = r.sel?.bib ?? bibToInt(r.input);
      if (bib == null) continue;
      if (seen.has(bib)) continue;
      seen.add(bib);
      out.push(bib);
    }

    return out;
  }, [rows]);

  const canSave = useMemo(() => {
    if (mode === "elim1") return parsedBibs.length === 1;
    if (mode === "elim2") return parsedBibs.length === 2;
    return parsedBibs.length > 0;
  }, [mode, parsedBibs.length]);

  // ---------------------------------------------------------------------------
  // Live sync handling (lap + prefill)
  // ---------------------------------------------------------------------------
  const prevLiveLapRef = useRef<number | null>(null);
  const autoPrefillBibsRef = useRef<{ bib0: number | null; bib1: number | null }>({ bib0: null, bib1: null });

  function setAutoPrefillBib(idx: 0 | 1, bib: number | null) {
    autoPrefillBibsRef.current = {
      ...autoPrefillBibsRef.current,
      [`bib${idx}`]: bib,
    } as { bib0: number | null; bib1: number | null };
  }

  function clearAutoPrefillBib(idx: 0 | 1) {
    setAutoPrefillBib(idx, null);
  }

  // When sync is turned off, forget previous live lap (so re-enabling doesn't trigger a stale "change").
  useEffect(() => {
    if (syncEnabled) return;
    prevLiveLapRef.current = null;
    autoPrefillBibsRef.current = { bib0: null, bib1: null };
  }, [syncEnabled]);

  // If sync is enabled: always align lap with the live lap count.
  // This runs:
  // - immediately when sync is enabled
  // - on mount (e.g. when switching tabs)
  // - whenever the live lap count changes
  useEffect(() => {
    if (!syncEnabled) return;
    if (liveLapCount == null) return;

    const liveLapInt = Math.max(1, Math.floor(Number(liveLapCount)));

    if (prevLiveLapRef.current !== liveLapInt) {
      prevLiveLapRef.current = liveLapInt;
      setLap(liveLapInt);
    }
  }, [syncEnabled, liveLapCount]);

  // Prefill Elim bib(s) with the last eligible live bib(s) when sync is enabled.
  // - elim1: prefill `lastBib`
  // - elim2: prefill `lastBib` + `secondLastBib`
  // UX rule: never override manual user input.
  useEffect(() => {
    if (!syncEnabled) return;
    if (!isFixedElimMode) return;

    const t0 = liveLastEligibleBibs?.lastBib ?? null;
    let t1 = isElim2 ? (liveLastEligibleBibs?.secondLastBib ?? null) : null;

    // Avoid prefilling duplicates.
    if (t0 != null && t1 != null && t0 === t1) t1 = null;

    setRows((prev) => {
      const next = prev.slice(0, elimBibCount);
      while (next.length < elimBibCount) next.push({ sel: null, input: "" });

      const auto = { ...autoPrefillBibsRef.current };

      function apply(idx: 0 | 1, bib: number | null) {
        if (bib == null) return;

        const current = next[idx] ?? { sel: null, input: "" };
        const currentBib = current.sel?.bib ?? bibToInt(current.input);

        const isEmpty = !current.sel && !String(current.input ?? "").trim();
        const wasAutoFilled = auto[`bib${idx}`] != null && currentBib === auto[`bib${idx}`];
        if (!isEmpty && !wasAutoFilled) return;

        const resolved = resolveOrPlaceholder(String(bib));
        if (!resolved) return;

        next[idx] = { sel: resolved, input: String(bib) };
        auto[`bib${idx}`] = bib;
      }

      apply(0, t0);
      if (elimBibCount > 1) apply(1, t1);

      autoPrefillBibsRef.current = auto;
      return next;
    });
  }, [
    syncEnabled,
    isFixedElimMode,
    isElim2,
    elimBibCount,
    liveLastEligibleBibs?.lastBib,
    liveLastEligibleBibs?.secondLastBib,
    starterByBib,
  ]);

  const selectedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const bib of parsedBibs) {
      const a = starterByBib.get(bib);
      if (a) ids.add(a.id);
    }
    return ids;
  }, [parsedBibs, starterByBib]);

  const statusByBib = useMemo(() => {
    const m = new Map<number, { eliminated?: boolean; dns?: boolean; dsq?: boolean }>();
    const list = Array.isArray((race as any)?.raceResults) ? ((race as any).raceResults as any[]) : [];

    for (const r of list) {
      const bib = bibToInt(String((r as any)?.bib ?? ""));
      if (bib == null) continue;

      const eliminated = Boolean((r as any)?.eliminated);
      const dns = Boolean((r as any)?.dns);
      const dsq = Boolean((r as any)?.dsq);

      if (!eliminated && !dns && !dsq) continue;
      m.set(bib, { eliminated, dns, dsq });
    }

    return m;
  }, [race]);

  const pointsByBib = useMemo(() => {
    const m = new Map<number, number>();
    const list = Array.isArray((race as any)?.raceResults) ? ((race as any).raceResults as any[]) : [];

    for (const r of list) {
      const bib = bibToInt(String((r as any)?.bib ?? ""));
      if (bib == null) continue;

      const pts = Number((r as any)?.points ?? 0);
      if (!Number.isFinite(pts) || pts === 0) continue;
      m.set(bib, pts);
    }

    return m;
  }, [race]);

  function focusIndex(i: number) {
    setTimeout(() => inputRefs.current[i]?.focus(), 0);
  }

  function isAutoHighlighted(row: { sel: Athlete | null; input: string }, idx: number): boolean {
    if (!syncEnabled || !isFixedElimMode) return false;
    if (idx > 1) return false;

    const autoBib = idx === 0 ? autoPrefillBibsRef.current.bib0 : autoPrefillBibsRef.current.bib1;
    if (autoBib == null) return false;

    const currentBib = row.sel?.bib ?? bibToInt(row.input);
    return currentBib != null && currentBib === autoBib;
  }

  function makePlaceholderAthlete(bib: number): Athlete {
    return {
      id: `placeholder_${race.id}_${bib}`,
      bib,
      firstName: "",
      lastName: "",
      ageGroupId: race.ageGroupId ?? null,
      nation: null,
    };
  }

  function resolveOrPlaceholder(bibText: string): Athlete | null {
    const bib = bibToInt(bibText);
    if (bib == null) return null;
    return starterByBib.get(bib) ?? makePlaceholderAthlete(bib);
  }

  function tryAutoPickUniqueBib(input: string, candidates: Athlete[]): Athlete | null {
    const v = input.trim();
    if (!/^[0-9]+$/.test(v)) return null;

    const exact = candidates.find((a) => a.bib !== null && String(a.bib) === v) ?? null;
    if (!exact) return null;

    // Avoid premature picking (e.g. typing "1" when there is also "12")
    const hasLongerPrefix = candidates.some((a) => a.bib !== null && String(a.bib).startsWith(v) && String(a.bib) !== v);
    if (hasLongerPrefix) return null;

    return exact;
  }

  const filterOptions: AthleteFilterOptions = useMemo(() => {
    const base = createFilterOptions<Athlete>({
      stringify: (o) => `${o.bib ?? ""} ${(o.lastName ?? "")} ${(o.firstName ?? "")} ${(o.nation ?? "")}`,
      trim: true,
    });

    return (options, state) => {
      if (!state.inputValue.trim()) return [];
      return base(options, state);
    };
  }, []);

  function optionsForRow(rowIndex: number): Athlete[] {
    const excludedBibs = new Set<number>();

    for (let i = 0; i < rows.length; i++) {
      if (i === rowIndex) continue;
      const bib = rows[i]?.sel?.bib ?? bibToInt(rows[i]?.input ?? "");
      if (bib != null) excludedBibs.add(bib);
    }

    return starters.filter((a) => a.bib != null && !excludedBibs.has(a.bib));
  }

  function candidatesForRow(rowIndex: number): Athlete[] {
    return optionsForRow(rowIndex);
  }

  function ensureRow(index: number) {
    setRows((prev) => {
      if (prev[index]) return prev;
      const copy = prev.slice();
      while (copy.length <= index) copy.push({ sel: null, input: "" });
      return copy;
    });
  }

  function resetRows(shouldFocusFirst = true) {
    if (isFixedElimMode) {
      setRows(Array.from({ length: elimBibCount }, () => ({ sel: null, input: "" })));
    } else {
      // DNS/DSQ: keep one empty row at the end.
      setRows([{ sel: null, input: "" }]);
    }

    if (shouldFocusFirst) focusIndex(0);
  }

  function clearNow() {
    setError(null);
    resetRows();
  }

  /**
   * DNS helper: prefill rows with all bibs that still have 0 laps in the live feed.
   * (These bibs are computed in the page view model and passed in via `liveZeroLapBibs`.)
   */
  function insertZeroLapBibs() {
    const list = Array.from(
      new Set((Array.isArray(liveZeroLapBibs) ? liveZeroLapBibs : []).map((b) => Math.floor(Number(b))).filter((b) => b > 0)),
    ).sort((a, b) => a - b);

    if (!list.length) return;

    setError(null);
    setRows(() => {
      const prefilled = list
        .map((bib) => ({ bib, sel: resolveOrPlaceholder(String(bib)) }))
        .filter((x) => x.sel != null)
        .map((x) => ({ sel: x.sel, input: String(x.bib) }));

      return [...prefilled, { sel: null, input: "" }];
    });

    focusIndex(0);
  }

  function getMissingStarterBibs(bibs: number[]): number[] {
    return bibs.filter((bib) => !starterByBib.has(bib));
  }

  /**
   * The actual save operation (no validation, no missing-starter dialog).
   *
   * NOTE (non-optimistic backend):
   * - For DNS/DSQ we may need to append multiple activities.
   * - If `onAddRaceActivities` is provided, we use it to patch all activities atomically.
   */
  function commitSave() {
    const bibs = parsedBibs;
    if (!bibs.length) return;

    if (isFixedElimMode) {
      // Defensive: should already be enforced via canSave.
      if (bibs.length !== elimBibCount) return;

      const lapNum = Math.max(1, Math.floor(Number(lap)));
      onAddRaceActivity(toEliminationActivity(lapNum, bibs));

      // UX: after recording an elimination, advance the lap counter.
      // When live sync is enabled we do NOT auto-increment here, because lap is driven by the live feed.
      if (!syncEnabled) setLap(lapNum + 1);

      setError(null);
      const keepSaveButtonFocus = syncEnabled;
      resetRows(!keepSaveButtonFocus);
      if (keepSaveButtonFocus) {
        setTimeout(() => saveButtonRef.current?.focus(), 0);
      }
      return;
    }

    if (mode === "DNS") {
      const acts = bibs.map((bib) => toDnsActivity(bib));
      if (onAddRaceActivities) onAddRaceActivities(acts);
      else for (const a of acts) onAddRaceActivity(a);

      setError(null);
      resetRows();
      return;
    }

    // mode === "DSQ"
    const acts = bibs.map((bib) => toDsqActivity(bib));
    if (onAddRaceActivities) onAddRaceActivities(acts);
    else for (const a of acts) onAddRaceActivity(a);

    setError(null);
    resetRows();
  }

  function saveIfPossible() {
    // Prevent saving via "Enter" when an elim-mode is only partially filled.
    if (!canSave) return;

    const bibs = parsedBibs;
    if (!bibs.length) return;

    const missing = getMissingStarterBibs(bibs);
    if (missing.length > 0) {
      if (!onCreateStarters) {
        setError(`Startnummer(n) fehlen in der Starterliste: ${missing.join(", ")}`);
        return;
      }

      pendingSaveRef.current = commitSave;
      setPendingSaveBibs(null);
      openMissingStartersDialog(missing);
      return;
    }

    commitSave();
  }

  async function handleDialogCreateAndSave() {
    if (!onCreateStarters) return;

    // capture before closeMissingStartersDialog() resets the state
    const bibs = [...missingDialogBibs];

    try {
      setMissingDialogBusy(true);
      await onCreateStarters(bibs);
      closeMissingStartersDialog();

      // actual saving happens via effect above, once starters exist locally
      setPendingSaveBibs(bibs);
    } finally {
      setMissingDialogBusy(false);
    }
  }

  function handleDialogCancel() {
    closeMissingStartersDialog();
    pendingSaveRef.current = null;
    setPendingSaveBibs(null);
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
        <Typography variant="subtitle2">Elimination</Typography>
      </Box>

      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, minWidth: 0 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <TextField
            size="small"
            label="Lap"
            value={lap}
            onChange={(e) => setLap(Number((e.target as HTMLInputElement).value))}
            type="number"
            disabled={!isFixedElimMode}
            slotProps={{ htmlInput: { min: 1, step: 1 } }}
            sx={{
              width: 110,
              ...(syncEnabled && {
                "& .MuiOutlinedInput-root fieldset": {
                  borderColor: "success.main",
                  borderWidth: 2,
                },
                "& .MuiOutlinedInput-root:hover fieldset": {
                  borderColor: "success.main",
                },
                "& .MuiOutlinedInput-root.Mui-focused fieldset": {
                  borderColor: "success.main",
                },
                "& .MuiInputLabel-root": {
                  color: "success.main",
                },
                "& .MuiInputLabel-root.Mui-focused": {
                  color: "success.main",
                },
              }),
            }}
          />

          <ToggleButtonGroup
            size="small"
            exclusive
            value={mode}
            onChange={(_, v) => {
              if (v) setMode(v);
            }}
            aria-label="Elimination mode"
          >
            <ToggleButton value="elim1" aria-label="1 Elim">
              1 Elim
            </ToggleButton>
            <ToggleButton value="elim2" aria-label="2 Elim">
              2 Elim
            </ToggleButton>
            <ToggleButton value="DNS" aria-label="DNS">
              DNS
            </ToggleButton>
            <ToggleButton value="DSQ" aria-label="DSQ">
              DSQ
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>
      </Box>

      {/* Bib inputs (auto-growing). Enter on an empty field saves. */}
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {rows.map((row, idx) => {
          const isLast = idx === rows.length - 1;
          const isEmpty = !row.sel && !String(row.input ?? "").trim();
          if (allowAutoGrow && !isLast && isEmpty) return null;

          // Show DNS helper only:
          // - next to the FIRST bib field
          // - when DNS mode is active
          // - when live sync is enabled and the race already progressed (lapsComplete > 0)
          const showInsertZeroLapButton =
            idx === 0 && mode === "DNS" && syncEnabled && Number(liveLapCount ?? 0) > 0;

          return (
            <Box key={idx} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Box sx={{ width: 220 }}>
                <PointsBibField
                value={row.sel}
                inputValue={row.input}
                highlight={isAutoHighlighted(row, idx)}
                inputRef={(el) => {
                  inputRefs.current[idx] = el;
                }}
                options={optionsForRow(idx)}
                filterOptions={filterOptions}
                formatOption={athleteLabel}
                resolveByBib={resolveOrPlaceholder}
                placeholder={idx === 0 ? "Bib" : `Bib ${idx + 1}`}
                nameAdornmentMaxWidth={180}
                onInputValueChange={(v, reason) => {
                  if (isFixedElimMode && idx <= 1 && reason === "input") {
                    clearAutoPrefillBib(idx as 0 | 1);
                  }

                  setRows((prev) => {
                    const copy = prev.slice();
                    const isLastField = idx === prev.length - 1;

                    if (reason === "input") {
                      copy[idx] = { sel: null, input: v };
                      if (allowAutoGrow && isLastField && String(v).trim()) copy.push({ sel: null, input: "" });
                    } else {
                      copy[idx] = { ...copy[idx], input: v };
                    }

                    return copy;
                  });

                  setError(null);

                  if (reason !== "input") return;

                  const pick = tryAutoPickUniqueBib(v, candidatesForRow(idx));
                  if (!pick) return;

                  setRows((prev) => {
                    const copy = prev.slice();
                    const isLastField = idx === prev.length - 1;
                    copy[idx] = { sel: pick, input: pick.bib != null ? String(pick.bib) : "" };
                    if (allowAutoGrow && isLastField) copy.push({ sel: null, input: "" });
                    return copy;
                  });

                  if (allowAutoGrow) {
                    ensureRow(idx + 1);
                    focusIndex(idx + 1);
                  } else if (idx + 1 < elimBibCount) {
                    focusIndex(idx + 1);
                  }
                }}
                onSelect={(next) => {
                  if (isFixedElimMode && idx <= 1) {
                    clearAutoPrefillBib(idx as 0 | 1);
                  }

                  setRows((prev) => {
                    const copy = prev.slice();
                    const isLastField = idx === prev.length - 1;
                    copy[idx] = { sel: next, input: next?.bib != null ? String(next.bib) : "" };
                    if (allowAutoGrow && isLastField && next) copy.push({ sel: null, input: "" });
                    return copy;
                  });

                  setError(null);

                  if (next) {
                    ensureRow(idx + 1);
                    focusIndex(idx + 1);
                  }
                }}
                onEnter={() => {
                  const isEmptyRow = !row.sel && !String(row.input ?? "").trim();
                  if (isEmptyRow) {
                    saveIfPossible();
                    return;
                  }

                  const m = resolveOrPlaceholder(row.input);
                  if (m) {
                    setRows((prev) => {
                      const copy = prev.slice();
                      const isLastField = idx === prev.length - 1;
                      copy[idx] = { sel: m, input: m.bib != null ? String(m.bib) : "" };
                      if (allowAutoGrow && isLastField) copy.push({ sel: null, input: "" });
                      return copy;
                    });
                  } else {
                    return;
                  }

                  if (allowAutoGrow) {
                    ensureRow(idx + 1);
                    focusIndex(idx + 1);
                  } else if (idx + 1 < elimBibCount) {
                    focusIndex(idx + 1);
                  }
                }}
              />
              </Box>

              {showInsertZeroLapButton ? (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={insertZeroLapBibs}
                  disabled={!liveZeroLapBibs.length}
                  sx={{ whiteSpace: "nowrap" }}
                >
                  Insert Bib with 0 Laps
                </Button>
              ) : null}
            </Box>
          );
        })}

        {error ? (
          <Typography variant="caption" color="error" sx={{ display: "block" }}>
            {error}
          </Typography>
        ) : null}

        <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, mt: 0.5 }}>
          <Button size="small" variant="contained" onClick={saveIfPossible} disabled={!canSave} ref={saveButtonRef}>
            Save
          </Button>
          <Button size="small" variant="outlined" onClick={clearNow}>
            Clear
          </Button>
        </Box>

        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
          Tip a bib number and press Enter. Enter on an empty field saves.
        </Typography>
      </Box>

      <ScoringStarterList
        starters={starters}
        missingInLiveBibs={missingInLiveBibs}
        selectedIds={selectedIds}
        statusByBib={statusByBib}
        pointsByBib={pointsByBib}
        formatAthleteLabel={athleteLabel}
        onDeleteStarter={onDeleteStarter}
      />

      <Dialog
        open={missingDialogOpen}
        onClose={missingDialogBusy ? undefined : handleDialogCancel}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Neue Starter anlegen?</DialogTitle>

        <DialogContent>
          <DialogContentText sx={{ mb: 1 }}>
            Folgende Startnummer(n) sind im Rennen noch nicht als Starter enthalten. Sollen diese angelegt werden?
          </DialogContentText>

          <Stack direction="row" flexWrap="wrap" gap={1}>
            {missingDialogBibs.map((bib) => (
              <Chip key={bib} label={bib} />
            ))}
          </Stack>
        </DialogContent>

        <DialogActions>
          <Button onClick={handleDialogCancel} disabled={missingDialogBusy}>
            Abbrechen
          </Button>

          <Button variant="contained" onClick={() => void handleDialogCreateAndSave()} disabled={missingDialogBusy}>
            Starter anlegen &amp; speichern
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

