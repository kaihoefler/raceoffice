// src/components/PointsScoring.tsx
//
// UI for recording points sprint activities.
//
// Supports two workflows:
// - lap:   2-point + 1-point sprint
// - finish: 3-point + 2-point + 1-point finish sprint
//
// Optional live-sync helpers (controlled by the page):
// - sync lap from live feed
// - switch to finish mode when lapsToGo reaches 0
// - prefill top bibs from live positions
// - keep manual overrides stable until user clears inputs

import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import PointsRemovalDialog from "./PointsRemovalDialog";
import ScoringStarterList from "./ScoringStarterList";

import type {
  Athlete,
  Race,
  RaceActivity,
  RaceActivityPointsRemoval,
  RaceActivityPointsSprint,
} from "@raceoffice/domain";


// Default fallback when no live top bibs are provided by the page.
const DEFAULT_LIVE_TOP_BIBS = { p1Bib: null, p2Bib: null, p3Bib: null } as const;

// lap    -> regular sprint (2P/1P)
// finish -> final sprint (3P/2P/1P)
export type PointsMode = "lap" | "finish";

type Props = {
  /** Active race (comes from the page) */
  race: Race;
  /** Use e.g. race.id so the component resets when switching races */
  resetKey?: string;
    /** Add a new race activity to the race (pointsSprint / pointsRemoval). */
  onAddRaceActivity: (activity: RaceActivity) => void;
  onCreateStarters?: (bibs: number[]) => Promise<void> | void;
  onDeleteStarter?: (starter: Athlete) => void;
  missingInLiveBibs?: Set<number>;


  /** If true, PointsScoring can react to live lap changes. */
  syncEnabled?: boolean;
  /** Live lap count (typically RaceStatusRace.lapsComplete). */
  liveLapCount?: number | null;
  /** Live laps to go (typically RaceStatusRace.lapsToGo). */
  liveLapsToGo?: number | null;

  /** Top bibs by live position (p1..p3). Used for auto-prefill when sync is enabled. */
  liveTopBibs?: {
    p1Bib: number | null;
    p2Bib: number | null;
    p3Bib: number | null;
  };
};

function athleteLabel(a: Athlete) {
  return `${a.bib ?? ""} - ${(a.lastName ?? "").trim()} ${(a.firstName ?? "").trim()}`.trim();
}

/**
 * Small row layout helper used for 3P/2P/1P inputs.
 */
function PointsRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
      <Typography variant="body2" sx={{ minWidth: 44, fontWeight: 600 }}>
        {label}
      </Typography>
      <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
    </Box>
  );
}

// Generates a client-side activity id.
function newId() {
  return (globalThis.crypto as any)?.randomUUID?.() ?? `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/** Build a pointsSprint activity from current form values. */
function toPointsSprintActivity(lap: number, results: Array<{ bib: number; points: number }>): RaceActivityPointsSprint {
  return {
    id: newId(),
    createdAt: new Date().toISOString(),
    type: "pointsSprint",
    data: {
      lap,
      isDeleted: false,
      results,
      history: [],
    },
  };
}

/** Build a pointsRemoval activity for selected bibs. */
function toPointsRemovalActivity(lap: number, bibs: number[]): RaceActivityPointsRemoval {
  return {
    id: newId(),
    createdAt: new Date().toISOString(),
    type: "pointsRemoval",
    data: {
      lap,
      isDeleted: false,
      results: bibs.map((bib) => ({ bib })),
      history: [],
    },
  };
}

export default function PointsScoring({
  race,
  resetKey,
  onAddRaceActivity,
  onCreateStarters,
  onDeleteStarter,
  missingInLiveBibs,

  syncEnabled = false,
  liveLapCount = null,
  liveLapsToGo = null,
  liveTopBibs = DEFAULT_LIVE_TOP_BIBS,
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
  const [mode, setMode] = useState<PointsMode>("lap");

  // Forces the live-prefill effect to run again, even when the inputs are already empty
  // (for example when the user presses "Clear" twice).
  const [prefillNonce, setPrefillNonce] = useState(0);

  const [sel3P, setSel3P] = useState<Athlete | null>(null);
  const [sel2P, setSel2P] = useState<Athlete | null>(null);
  const [sel1P, setSel1P] = useState<Athlete | null>(null);

  const [in3P, setIn3P] = useState("");
  const [in2P, setIn2P] = useState("");
  const [in1P, setIn1P] = useState("");

  const ref3P = useRef<HTMLInputElement>(null);
  const ref2P = useRef<HTMLInputElement>(null);
  const ref1P = useRef<HTMLInputElement>(null);
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const focusSaveAfterSyncSaveRef = useRef(false);

  // Once the user manually edits any points field while sync is enabled, we stop
  // overwriting points fields from live data until the user presses "Clear".
  const syncOverwriteBlockedRef = useRef(false);

  // Tracks which bibs currently come from live prefill so they can stay highlighted
  // and may still be replaced by newer live values.
  const auto3PBibRef = useRef<number | null>(null);
  const auto2PBibRef = useRef<number | null>(null);
  const auto1PBibRef = useRef<number | null>(null);

  // Used to ensure saving only happens after Enter in the last field.
  const enterRequestedRef = useRef(false);

  function clearAutoPrefillRefs() {
    auto3PBibRef.current = null;
    auto2PBibRef.current = null;
    auto1PBibRef.current = null;
  }

  function requestSyncPrefill() {
    if (!syncEnabled) return;
    syncOverwriteBlockedRef.current = false;
    clearAutoPrefillRefs();
    setPrefillNonce((n) => n + 1);
  }

  function parseBibInput(value: string): number | null {
    const v = String(value ?? "").trim();
    if (!/^\d+$/.test(v)) return null;
    const bib = Number(v);
    return Number.isFinite(bib) && bib > 0 ? bib : null;
  }

  function isAutoHighlighted(selected: Athlete | null, autoBib: number | null) {
    return syncEnabled && autoBib != null && (selected?.bib ?? null) === autoBib;
  }

  function markManualOverride(autoRef: { current: number | null }) {
    syncOverwriteBlockedRef.current = true;
    autoRef.current = null;
  }

  function queueFocus(ref: RefObject<HTMLInputElement | null>) {
    setTimeout(() => ref.current?.focus(), 0);
  }

  function focusByMode(nextMode: PointsMode) {
    if (nextMode === "finish") queueFocus(ref3P);
    else queueFocus(ref2P);
  }

  function resolveFieldSelection(
    input: string,
    setSelected: (a: Athlete | null) => void,
    setInput: (value: string) => void,
    autoRef: { current: number | null },
  ) {
    markManualOverride(autoRef);

    const resolved = resolveOrPlaceholder(input);
    if (!resolved) return null;

    setSelected(resolved);
    setInput(resolved.bib != null ? String(resolved.bib) : "");
    return resolved;
  }

  // ---------------------------------------------------------------------------
  // State: confirmation dialog for creating missing starters
  // ---------------------------------------------------------------------------
  const [missingDialogOpen, setMissingDialogOpen] = useState(false);
  const [pointsRemovalOpen, setPointsRemovalOpen] = useState(false);
  const [missingDialogBibs, setMissingDialogBibs] = useState<number[]>([]);
  const [missingDialogBusy, setMissingDialogBusy] = useState(false);

  // Holds the actual save operation until the dialog flow completes.
  const pendingSaveRef = useRef<null | (() => void)>(null);

  // When the user chooses "create starters", we have to wait for the starter-create patch
  // to roundtrip from the server (this app is non-optimistic).
  // Otherwise the subsequent "add activity" patch may be rejected due to rev mismatch.
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

    // Wait until all created starters are actually present.
    const allPresent = pendingSaveBibs.every((bib) => starterByBib.has(bib));
    if (!allPresent) return;

    const run = pendingSaveRef.current;
    pendingSaveRef.current = null;
    setPendingSaveBibs(null);
    run?.();
  }, [pendingSaveBibs, starterByBib]);


  // ---------------------------------------------------------------------------
  // Existing points activities -> default lap = max(lap) + 1
  // ---------------------------------------------------------------------------
  const pointsSprintActivities = useMemo(() => {
    const activities = (race as any)?.raceActivities;
    const list = Array.isArray(activities) ? activities : [];
    return list.filter((a): a is RaceActivityPointsSprint => a?.type === "pointsSprint");
  }, [race]);


  const defaultLap = useMemo(() => {
    // nur gültige, nicht gelöschte Points-Sprints zählen
    const maxLap = pointsSprintActivities.reduce((m, a) => {
      if (a.data?.isDeleted) return m;
      const lap = Number(a.data?.lap ?? 0);
      return Number.isFinite(lap) ? Math.max(m, lap) : m;
    }, 0);

    // gewünschtes Verhalten: nächster Lap = max + 1
    return Math.max(1, maxLap + 1);
  }, [pointsSprintActivities]);

  const [lap, setLap] = useState<number>(defaultLap);

  // Reset lap when switching races (or when parent forces a reset).
  // IMPORTANT (live sync): never overwrite the live-driven lap while sync is enabled.
  useEffect(() => {
    if (syncEnabled) return;
    setLap(defaultLap);
  }, [resetKey, race.id, defaultLap, syncEnabled]);



  // ---------------------------------------------------------------------------
  // Live sync handling (lap + mode)
  // ---------------------------------------------------------------------------
  const prevLiveLapRef = useRef<number | null>(null);

  // When sync is turned off, forget previous live lap (so re-enabling doesn't trigger a stale "change").
  useEffect(() => {
    if (syncEnabled) return;
    prevLiveLapRef.current = null;
  }, [syncEnabled]);

  // When the component mounts in sync mode (for example after switching back to the
  // Points tab) or when sync is enabled again, trigger one explicit prefill pass.
  // This mirrors the "Clear" behavior and makes mount-time timing/order issues harmless.
  useEffect(() => {
    requestSyncPrefill();
  }, [syncEnabled, race.id]);

  // If sync is enabled, always align the lap with the live lap count. This runs on
  // mount, when sync is enabled, and whenever the live lap count changes.
  useEffect(() => {
    if (!syncEnabled) return;
    if (liveLapCount == null) return;

    const liveLapInt = Math.max(1, Math.floor(Number(liveLapCount)));

    // Fix (tab switch / transient null liveLapCount): ensure lap is aligned even if

    // prevLiveLapRef already equals liveLapInt but local state was reset in between.
    if (prevLiveLapRef.current !== liveLapInt || lap !== liveLapInt) {
      prevLiveLapRef.current = liveLapInt;
      setLap(liveLapInt);
    }
  }, [syncEnabled, liveLapCount, lap]);



  // If live says "no laps to go", switch to finish mode. We intentionally do not
  // auto-switch back to lap mode.
  useEffect(() => {
    if (!syncEnabled) return;
    if (liveLapsToGo == null) return;

    const n = Math.floor(Number(liveLapsToGo));
    if (Number.isFinite(n) && n === 0 && mode !== "finish") {
      setMode("finish");
    }
  }, [syncEnabled, liveLapsToGo, mode]);

  // ---------------------------------------------------------------------------
  // Live sync: prefill bibs from live positions
  // ---------------------------------------------------------------------------
  const liveP1 = liveTopBibs?.p1Bib ?? null;
  const liveP2 = liveTopBibs?.p2Bib ?? null;
  const liveP3 = liveTopBibs?.p3Bib ?? null;

  useEffect(() => {
    if (!syncEnabled) return;
    if (syncOverwriteBlockedRef.current) return;

    const apply = (
      desiredBib: number | null,
      current: Athlete | null,
      currentInput: string,
      setCurrent: (a: Athlete | null) => void,
      setInput: (v: string) => void,
      autoRef: { current: number | null },
    ) => {
      if (desiredBib == null) return;

      // Resolve even if the bib is not yet part of the starter list. This keeps
      // live-prefill working for unknown live bibs as well.
      const resolved = resolveOrPlaceholder(String(desiredBib));
      if (!resolved) return;

      const currentBib = current?.bib ?? parseBibInput(currentInput);
      const isEmpty = current == null && !String(currentInput ?? "").trim();
      const wasAutoFilled = autoRef.current != null && currentBib != null && currentBib === autoRef.current;
      if (!isEmpty && !wasAutoFilled) return;

      autoRef.current = resolved.bib ?? null;
      setCurrent(resolved);
      setInput(resolved.bib != null ? String(resolved.bib) : "");
    };

    if (mode === "finish") {
      // Finish mode maps live places 1..3 to 3/2/1 points.
      apply(liveP1, sel3P, in3P, setSel3P, setIn3P, auto3PBibRef);
      apply(liveP2, sel2P, in2P, setSel2P, setIn2P, auto2PBibRef);
      apply(liveP3, sel1P, in1P, setSel1P, setIn1P, auto1PBibRef);
    } else {
      // Lap sprint mode maps live places 1..2 to 2/1 points.
      apply(liveP1, sel2P, in2P, setSel2P, setIn2P, auto2PBibRef);
      apply(liveP2, sel1P, in1P, setSel1P, setIn1P, auto1PBibRef);
    }
  }, [
    syncEnabled,
    mode,
    liveP1,
    liveP2,
    liveP3,
    starterByBib,
    sel1P,
    sel2P,
    sel3P,
    in1P,
    in2P,
    in3P,
    prefillNonce,
  ]);

  // ---------------------------------------------------------------------------
  // Autocomplete filtering (only show options after typing at least 1 char)
  // ---------------------------------------------------------------------------
  const filterOptions: AthleteFilterOptions = useMemo(() => {
    const base = createFilterOptions<Athlete>({
      stringify: (o) => `${o.bib ?? ""} ${(o.lastName ?? "")} ${(o.firstName ?? "")} ${(o.nation ?? "")}`,
      trim: true,
    });

    // Only show suggestions when at least 1 character was typed.
    // This also prevents showing an empty dropdown / "no options" on focus.
    return (options, state) => {
      if (!state.inputValue.trim()) return [];
      return base(options, state);
    };
  }, []);








  // ---------------------------------------------------------------------------
  // UI helpers: selectedIds + available options + focus/reset behavior
  // ---------------------------------------------------------------------------
  const selectedIds = useMemo(() => {
    const ids = new Set<string>();

    if (sel3P) ids.add(sel3P.id);
    if (sel2P) ids.add(sel2P.id);
    if (sel1P) ids.add(sel1P.id);
    return ids;
  }, [sel1P, sel2P, sel3P]);

  const statusByBib = useMemo(() => {
    const m = new Map<number, { dnf?: false | "dnf" | "elimination"; dns?: boolean; dsq?: boolean }>();
    const list = Array.isArray((race as any)?.raceResults) ? ((race as any).raceResults as any[]) : [];

    for (const r of list) {
      const bib = Number((r as any)?.bib);
      if (!Number.isFinite(bib) || bib <= 0) continue;

      const dnfRaw = (r as any)?.dnf;
      const dnf = dnfRaw === "dnf" || dnfRaw === "elimination" ? dnfRaw : false;
      const dns = Boolean((r as any)?.dns);
      const dsq = Boolean((r as any)?.dsq);

      if (dnf === false && !dns && !dsq) continue;
      m.set(bib, { dnf, dns, dsq });
    }

    return m;
  }, [race]);

  const pointsByBib = useMemo(() => {
    const m = new Map<number, number>();
    const list = Array.isArray((race as any)?.raceResults) ? ((race as any).raceResults as any[]) : [];

    for (const r of list) {
      const bib = Number((r as any)?.bib);
      if (!Number.isFinite(bib) || bib <= 0) continue;

      const pts = Number((r as any)?.points ?? 0);
      if (!Number.isFinite(pts) || pts === 0) continue;
      m.set(bib, pts);
    }

    return m;
  }, [race]);

  const optionsFor = (exclude: Set<string>) => starters.filter((a) => !exclude.has(a.id));

  function resetInputs(focus: "2P" | "3P" | "none" = "2P") {
    clearAutoPrefillRefs();

    setSel3P(null);
    setSel2P(null);
    setSel1P(null);
    setIn3P("");
    setIn2P("");
    setIn1P("");

    if (focus === "none") return;
    if (focus === "3P") queueFocus(ref3P);
    else queueFocus(ref2P);
  }

  const didApplyResetRef = useRef(false);

  // Reset when parent context changes (e.g. race change).
  // NOTE: We intentionally skip the initial mount so that the live-sync prefill effect can run
  // when opening the tab (otherwise this reset would clear the freshly prefixed values).
  useEffect(() => {
    if (!resetKey) return;

    if (!didApplyResetRef.current) {
      didApplyResetRef.current = true;
      return;
    }

    resetInputs(mode === "finish" ? "3P" : "2P");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);


  // When switching mode, update focus. Leaving finish mode also clears the 3-point field.
  useEffect(() => {
    if (mode === "finish") {
      focusByMode(mode);
      return;
    }

    auto3PBibRef.current = null;
    setSel3P(null);
    setIn3P("");
    focusByMode(mode);
  }, [mode]);

  // NOTE: Previously there was a `trySelectByBib` helper that only resolved existing starters.
  // We now use `resolveOrPlaceholder` (see below), so unknown bibs can still be selected.

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

  function candidatesFor(excludeIds: Array<string | null | undefined>): Athlete[] {
    const exclude = new Set(excludeIds.filter(Boolean) as string[]);
    return starters.filter((a) => !exclude.has(a.id));
  }




  // ---------------------------------------------------------------------------
  // Save flow (with confirmation dialog for missing starters)
  // ---------------------------------------------------------------------------
  const canSave = useMemo(() => {
    if (mode === "finish") {
      return sel3P?.bib != null && sel2P?.bib != null && sel1P?.bib != null;
    }
    return sel2P?.bib != null && sel1P?.bib != null;
  }, [mode, sel1P, sel2P, sel3P]);

  /**
 * Persists a new pointsSprint activity based on current mode.
 * - lap mode:    2P + 1P
 * - finish mode: 3P + 2P + 1P
 */
  function commitSave() {
    const lapNum = Math.max(1, Math.floor(Number(lap)));

    enterRequestedRef.current = false;

    // In sync mode we do not want to jump back into the bib fields after saving.
    // Instead we restore focus to the Save button once prefill has made the form complete again.
    focusSaveAfterSyncSaveRef.current = syncEnabled;
    requestSyncPrefill();

    if (mode === "lap") {
      onAddRaceActivity(
        toPointsSprintActivity(lapNum, [
          { bib: sel2P!.bib!, points: 2 },
          { bib: sel1P!.bib!, points: 1 },
        ]),
      );
      resetInputs(syncEnabled ? "none" : "2P");
      return;
    }

    onAddRaceActivity(
      toPointsSprintActivity(lapNum, [
        { bib: sel3P!.bib!, points: 3 },
        { bib: sel2P!.bib!, points: 2 },
        { bib: sel1P!.bib!, points: 1 },
      ]),
    );
    resetInputs(syncEnabled ? "none" : "3P");
  }

  // When saving in sync mode, reset clears the fields temporarily. As soon as live-prefill
  // makes the inputs complete again (canSave=true), restore focus to the Save button.
  useEffect(() => {
    if (!syncEnabled) {
      focusSaveAfterSyncSaveRef.current = false;
      return;
    }

    if (!focusSaveAfterSyncSaveRef.current) return;
    if (!canSave) return;

    focusSaveAfterSyncSaveRef.current = false;
    setTimeout(() => saveButtonRef.current?.focus(), 0);
  }, [syncEnabled, canSave]);

  async function saveAsync() {
    if (!canSave) return;

    const selectedBibs = getSelectedBibs();
    const missing = getMissingStarterBibs(selectedBibs);

    if (missing.length > 0) {
      if (!onCreateStarters) {
        console.warn("Missing starters but onCreateStarters is not provided:", missing);
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

    // Capture before closeMissingStartersDialog() resets the state.
    const bibs = [...missingDialogBibs];

    try {
      setMissingDialogBusy(true);
      await onCreateStarters(bibs);
      closeMissingStartersDialog();

      // The actual save happens via the effect above, once starters exist locally.
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

    function clearNow() {
    enterRequestedRef.current = false;
    requestSyncPrefill();
    resetInputs(mode === "finish" ? "3P" : "2P");
  }

  async function handleSavePointsRemoval(payload: { lap: number; bibs: number[] }) {
    const lapNum = Math.max(1, Math.floor(Number(payload.lap) || 1));
    const bibs = Array.from(new Set(payload.bibs.filter((bib) => Number.isFinite(bib) && bib > 0))).sort((a, b) => a - b);
    if (!bibs.length) return;

    onAddRaceActivity(toPointsRemovalActivity(lapNum, bibs));
  }

  function maybeSaveIfComplete() {
    if (!enterRequestedRef.current) return;
    void saveAsync();
  }

  // ---------------------------------------------------------------------------
  // Placeholder handling: allow selecting bibs that are not (yet) in race starters
  // ---------------------------------------------------------------------------

  function makePlaceholderAthlete(bib: number): Athlete {

    // Keep the placeholder id stable so MUI Autocomplete does not lose the selection
    // across re-renders / effects.
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
    const v = bibText.trim();
    if (!/^\d+$/.test(v)) return null;
    const bib = Number(v);
    if (!Number.isFinite(bib) || bib <= 0) return null;

    return starterByBib.get(bib) ?? makePlaceholderAthlete(bib);
  }



  function getSelectedBibs(): number[] {
    const bibs = [sel1P?.bib, sel2P?.bib, sel3P?.bib].filter((b): b is number => b != null);
    return Array.from(new Set(bibs));
  }

  function getMissingStarterBibs(bibs: number[]): number[] {
    return bibs.filter((bib) => !starterByBib.has(bib));
  }

  /**
   * Quick-pick from starter list (bottom panel):
   * fills the next free points slot and moves focus forward.
   */
    const handleStarterClick = useCallback((starter: Athlete) => {
    const bib = starter.bib;
    if (bib == null) return;

    const selectedBibs = new Set<number>([sel3P?.bib, sel2P?.bib, sel1P?.bib].filter((b): b is number => b != null));
    if (selectedBibs.has(bib)) return;

    const next = starterByBib.get(bib) ?? starter;

    if (mode === "finish") {
      if (!sel3P) {
        markManualOverride(auto3PBibRef);
        setSel3P(next);
        setIn3P(String(bib));
        queueFocus(ref2P);
        return;
      }

      if (!sel2P) {
        markManualOverride(auto2PBibRef);
        setSel2P(next);
        setIn2P(String(bib));
        queueFocus(ref1P);
        return;
      }

      if (!sel1P) {
        markManualOverride(auto1PBibRef);
        setSel1P(next);
        setIn1P(String(bib));
      }
      return;
    }

    if (!sel2P) {
      markManualOverride(auto2PBibRef);
      setSel2P(next);
      setIn2P(String(bib));
      queueFocus(ref1P);
      return;
    }

    if (!sel1P) {
      markManualOverride(auto1PBibRef);
      setSel1P(next);
      setIn1P(String(bib));
    }
  }, [mode, sel1P, sel2P, sel3P, starterByBib]);



  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      {/* Points entry */}
      <Box sx={{ p: 2, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1, minWidth: 0 }}>
          <Typography variant="subtitle2">Points</Typography>
        </Box>
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, mb: 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
            <TextField
              size="small"
              label="Lap"
              value={lap}
              onChange={(e) => setLap(Number((e.target as HTMLInputElement).value))}
              type="number"
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
              aria-label="Points mode"
            >
              <ToggleButton value="lap" aria-label="Lap">
                Lap
              </ToggleButton>
              <ToggleButton value="finish" aria-label="Finish">
                Finish
              </ToggleButton>
            </ToggleButtonGroup>
          </Box>

                    <Button
            size="small"
            variant="outlined"
            color="warning"
            onClick={() => setPointsRemovalOpen(true)}
            disabled={pointsByBib.size === 0}
            sx={{
              ml: "auto",
              minWidth: 0,
              px: 1,
              py: 0.25,
              fontSize: "0.72rem",
              lineHeight: 1.1,
            }}
          >
            Loose Pts.
          </Button>
        </Box>


        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {mode === "finish" ? (
            <PointsRow label="3 P">
              <PointsBibField
                value={sel3P}
                inputValue={in3P}
                inputRef={ref3P}
                highlight={isAutoHighlighted(sel3P, auto3PBibRef.current)}
                options={optionsFor(new Set([sel2P?.id, sel1P?.id].filter(Boolean) as string[]))}
                filterOptions={filterOptions}
                formatOption={athleteLabel}
                resolveByBib={resolveOrPlaceholder}
                onInputValueChange={(v, reason) => {
                  setIn3P(v);
                  if (reason !== "input") return;

                  markManualOverride(auto3PBibRef);
                  setSel3P(null);

                  const pick = tryAutoPickUniqueBib(v, candidatesFor([sel2P?.id, sel1P?.id]));
                  if (!pick) return;

                  setSel3P(pick);
                  setIn3P(pick.bib != null ? String(pick.bib) : "");
                  queueFocus(ref2P);
                }}
                onSelect={(next) => {
                  markManualOverride(auto3PBibRef);
                  setSel3P(next);
                  setIn3P(next?.bib != null ? String(next.bib) : "");
                  if (next) queueFocus(ref2P);
                }}
                onEnter={() => {
                  const resolved = resolveFieldSelection(in3P, setSel3P, setIn3P, auto3PBibRef);
                  if (resolved) queueFocus(ref2P);
                }}
              />
            </PointsRow>
          ) : null}

          <PointsRow label="2 P">
            <PointsBibField
              value={sel2P}
              inputValue={in2P}
              inputRef={ref2P}
              highlight={isAutoHighlighted(sel2P, auto2PBibRef.current)}
              options={
                mode === "finish"
                  ? optionsFor(new Set([sel3P?.id, sel1P?.id].filter(Boolean) as string[]))
                  : optionsFor(new Set([sel1P?.id].filter(Boolean) as string[]))
              }
              filterOptions={filterOptions}
              formatOption={athleteLabel}
              resolveByBib={resolveOrPlaceholder}
              onInputValueChange={(v, reason) => {
                setIn2P(v);
                if (reason !== "input") return;

                markManualOverride(auto2PBibRef);
                setSel2P(null);

                const exclude = mode === "finish" ? [sel3P?.id, sel1P?.id] : [sel1P?.id];
                const pick = tryAutoPickUniqueBib(v, candidatesFor(exclude));
                if (!pick) return;

                setSel2P(pick);
                setIn2P(pick.bib != null ? String(pick.bib) : "");
                queueFocus(ref1P);
              }}
              onSelect={(next) => {
                markManualOverride(auto2PBibRef);
                setSel2P(next);
                setIn2P(next?.bib != null ? String(next.bib) : "");
                if (next) queueFocus(ref1P);
              }}
              onEnter={() => {
                const resolved = resolveFieldSelection(in2P, setSel2P, setIn2P, auto2PBibRef);
                if (resolved) queueFocus(ref1P);
              }}
            />
          </PointsRow>

          <PointsRow label="1 P">
            <PointsBibField
              value={sel1P}
              inputValue={in1P}
              inputRef={ref1P}
              highlight={isAutoHighlighted(sel1P, auto1PBibRef.current)}
              options={optionsFor(new Set([sel3P?.id, sel2P?.id].filter(Boolean) as string[]))}
              filterOptions={filterOptions}
              formatOption={athleteLabel}
              resolveByBib={resolveOrPlaceholder}
              onInputValueChange={(v, reason) => {
                setIn1P(v);
                if (reason !== "input") return;

                markManualOverride(auto1PBibRef);
                setSel1P(null);

                const pick = tryAutoPickUniqueBib(v, candidatesFor([sel3P?.id, sel2P?.id]));
                if (!pick) return;

                setSel1P(pick);
                setIn1P(pick.bib != null ? String(pick.bib) : "");
              }}
              onSelect={(next) => {
                markManualOverride(auto1PBibRef);
                setSel1P(next);
                setIn1P(next?.bib != null ? String(next.bib) : "");
                maybeSaveIfComplete();
              }}
              onEnter={() => {
                // Mark that we want to save via Enter.
                enterRequestedRef.current = true;

                const resolved = resolveFieldSelection(in1P, setSel1P, setIn1P, auto1PBibRef);
                if (resolved) {
                  setTimeout(() => maybeSaveIfComplete(), 0);
                  return;
                }

                setTimeout(() => maybeSaveIfComplete(), 0);
              }}
            />
          </PointsRow>

          <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, mt: 0.5 }}>
            <Button
              ref={saveButtonRef}
              size="small"
              variant="contained"
              onClick={() => void saveAsync()}
              disabled={!canSave}
            >
              Save
            </Button>

            <Button size="small" variant="outlined" onClick={clearNow}>
              Clear
            </Button>
          </Box>

          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
            Tip a bib number and select a starter (keyboard). Press Enter in the last field to save.
          </Typography>

        </Box>
      </Box>

      <ScoringStarterList
        starters={starters}
        missingInLiveBibs={missingInLiveBibs}
        selectedIds={selectedIds}
        statusByBib={statusByBib}
        pointsByBib={pointsByBib}
        formatAthleteLabel={athleteLabel}
        onDeleteStarter={onDeleteStarter}
        onStarterClick={handleStarterClick}
      />




            <PointsRemovalDialog
        open={pointsRemovalOpen}
        initialLap={lap}
        starters={starters}
        pointsByBib={pointsByBib}
        formatAthleteLabel={athleteLabel}
        onClose={() => setPointsRemovalOpen(false)}
        onSave={handleSavePointsRemoval}
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

          <Button
            variant="contained"
            onClick={() => void handleDialogCreateAndSave()}
            disabled={missingDialogBusy}
          >
            Starter anlegen &amp; speichern
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
