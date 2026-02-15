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
import type { RaceActivityPointsSprint } from "../types/raceactivities";

const DEFAULT_LIVE_TOP_BIBS = { p1Bib: null, p2Bib: null, p3Bib: null } as const;

export type PointsMode = "lap" | "finish";

type Props = {
  /** Active race (comes from the page) */
  race: Race;
  /** Use e.g. race.id so the component resets when switching races */
  resetKey?: string;
  /** Add a new RaceActivityPointsSprint to the race (no editing in this component) */
  onAddRaceActivity: (activity: RaceActivityPointsSprint) => void;

  onCreateStarters?: (bibs: number[]) => Promise<void> | void;

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

function newId() {
  return (globalThis.crypto as any)?.randomUUID?.() ?? `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

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

export default function PointsScoring({
  race,
  resetKey,
  onAddRaceActivity,
  onCreateStarters,
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
  // State: mode + selected athletes + input strings
  // ---------------------------------------------------------------------------
  const [mode, setMode] = useState<PointsMode>("lap");

  const [sel3P, setSel3P] = useState<Athlete | null>(null);
  const [sel2P, setSel2P] = useState<Athlete | null>(null);
  const [sel1P, setSel1P] = useState<Athlete | null>(null);

  const [in3P, setIn3P] = useState("");
  const [in2P, setIn2P] = useState("");
  const [in1P, setIn1P] = useState("");

  const ref3P = useRef<HTMLInputElement>(null);

  const ref2P = useRef<HTMLInputElement>(null);
  const ref1P = useRef<HTMLInputElement>(null);

  // Track which values were auto-prefilled from live status.
  // If the user changes a field manually, we clear the corresponding ref.
  const auto3PBibRef = useRef<number | null>(null);
  const auto2PBibRef = useRef<number | null>(null);
  const auto1PBibRef = useRef<number | null>(null);

  // Used to ensure saving happens "through Enter".
  const enterRequestedRef = useRef(false);

  // ---------------------------------------------------------------------------
  // State: confirmation dialog for creating missing starters
  // ---------------------------------------------------------------------------
  const [missingDialogOpen, setMissingDialogOpen] = useState(false);
  const [missingDialogBibs, setMissingDialogBibs] = useState<number[]>([]);
  const [missingDialogBusy, setMissingDialogBusy] = useState(false);

  // Speichert die "eigentliche" Save-Operation, bis der User im Dialog entscheidet.
  const pendingSaveRef = useRef<null | (() => void)>(null);

  function openMissingStartersDialog(bibs: number[]) {
    setMissingDialogBibs(bibs);
    setMissingDialogOpen(true);
  }

  function closeMissingStartersDialog() {
    setMissingDialogOpen(false);
    setMissingDialogBibs([]);
  }

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

  // Reset lap when switching races (or when parent forces a reset)
  useEffect(() => {
    setLap(defaultLap);
  }, [resetKey, race.id, defaultLap]);

  // ---------------------------------------------------------------------------
  // Live sync handling (lap + mode)
  // ---------------------------------------------------------------------------
  const prevLiveLapRef = useRef<number | null>(null);

  // When sync is turned off, forget previous live lap (so re-enabling doesn't trigger a stale "change").
  useEffect(() => {
    if (syncEnabled) return;
    prevLiveLapRef.current = null;
  }, [syncEnabled]);

  // If sync is enabled: update lap ONLY when the live lap count changes.
  useEffect(() => {
    if (!syncEnabled) return;
    if (liveLapCount == null) return;

    const liveLapInt = Math.max(1, Math.floor(Number(liveLapCount)));

    if (prevLiveLapRef.current == null) {
      // Initialize without overriding the user's current lap.
      prevLiveLapRef.current = liveLapInt;
      return;
    }

    if (prevLiveLapRef.current !== liveLapInt) {
      prevLiveLapRef.current = liveLapInt;
      setLap(liveLapInt);
    }
  }, [syncEnabled, liveLapCount]);

  // If live says "no laps to go" -> switch to finish mode.
  // We do not auto-switch back to lap mode.
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
  useEffect(() => {
    if (!syncEnabled) return;

    const p1 = liveTopBibs?.p1Bib ?? null;
    const p2 = liveTopBibs?.p2Bib ?? null;
    const p3 = liveTopBibs?.p3Bib ?? null;

    const apply = (
      desiredBib: number | null,
      current: Athlete | null,
      currentInput: string,
      setCurrent: (a: Athlete | null) => void,
      setInput: (v: string) => void,
      autoRef: { current: number | null },
    ) => {

      if (desiredBib == null) return;
      const a = starterByBib.get(desiredBib) ?? null;
      if (!a) return;

      const currentBib = current?.bib ?? null;
      const shouldUpdate =
        (current == null && !String(currentInput ?? "").trim()) ||
        (autoRef.current != null && currentBib != null && currentBib === autoRef.current);




      if (!shouldUpdate) return;

      autoRef.current = a.bib ?? null;
      setCurrent(a);
      setInput(a.bib != null ? String(a.bib) : "");

    };

    if (mode === "finish") {
      // Finish: place 1..3 => 3/2/1 points
      apply(p1, sel3P, in3P, setSel3P, setIn3P, auto3PBibRef);
      apply(p2, sel2P, in2P, setSel2P, setIn2P, auto2PBibRef);
      apply(p3, sel1P, in1P, setSel1P, setIn1P, auto1PBibRef);

    } else {
      // Lap sprint: place 1..2 => 2/1 points
      apply(p1, sel2P, in2P, setSel2P, setIn2P, auto2PBibRef);
      apply(p2, sel1P, in1P, setSel1P, setIn1P, auto1PBibRef);

    }
  }, [syncEnabled, mode, liveTopBibs, starterByBib, sel1P, sel2P, sel3P, in1P, in2P, in3P]);





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

  const optionsFor = (exclude: Set<string>) => starters.filter((a) => !exclude.has(a.id));

  function resetInputs(focus: "2P" | "3P" = "2P") {
    auto3PBibRef.current = null;
    auto2PBibRef.current = null;
    auto1PBibRef.current = null;

    setSel3P(null);
    setSel2P(null);
    setSel1P(null);
    setIn3P("");
    setIn2P("");
    setIn1P("");


    setTimeout(() => {
      if (focus === "3P") ref3P.current?.focus();
      else ref2P.current?.focus();
    }, 0);
  }

  // Reset when parent context changes (e.g. race change)
  useEffect(() => {
    if (!resetKey) return;
    resetInputs(mode === "finish" ? "3P" : "2P");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // When switching mode, adjust focus + clear 3P if leaving finish
  useEffect(() => {
    if (mode === "finish") {
      setTimeout(() => ref3P.current?.focus(), 0);
    } else {
      auto3PBibRef.current = null;
      setSel3P(null);
      setIn3P("");
      setTimeout(() => ref2P.current?.focus(), 0);
    }

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

  function commitSave() {
    const lapNum = Math.max(1, Math.floor(Number(lap)));

    enterRequestedRef.current = false;

    if (mode === "lap") {
      onAddRaceActivity(
        toPointsSprintActivity(lapNum, [
          { bib: sel2P!.bib!, points: 2 },
          { bib: sel1P!.bib!, points: 1 },
        ]),
      );
      resetInputs("2P");
      return;
    }

    onAddRaceActivity(
      toPointsSprintActivity(lapNum, [
        { bib: sel3P!.bib!, points: 3 },
        { bib: sel2P!.bib!, points: 2 },
        { bib: sel1P!.bib!, points: 1 },
      ]),
    );
    resetInputs("3P");
  }

  async function saveAsync() {
    if (!canSave) return;

    const selectedBibs = getSelectedBibs();
    const missing = getMissingStarterBibs(selectedBibs);

    if (missing.length > 0) {
      if (!onCreateStarters) {
        console.warn("Missing starters but onCreateStarters is not provided:", missing);
        return; // nicht speichern
      }

      pendingSaveRef.current = commitSave;
      openMissingStartersDialog(missing);
      return;
    }

    commitSave();
  }

  async function handleDialogCreateAndSave() {
    if (!onCreateStarters) return;

    try {
      setMissingDialogBusy(true);
      await onCreateStarters(missingDialogBibs);
      closeMissingStartersDialog();

      const run = pendingSaveRef.current;
      pendingSaveRef.current = null;
      run?.();
    } finally {
      setMissingDialogBusy(false);
    }
  }



  function handleDialogCancel() {
    closeMissingStartersDialog();
    pendingSaveRef.current = null;
  }

  function clearNow() {
    enterRequestedRef.current = false;
    resetInputs(mode === "finish" ? "3P" : "2P");
  }

  function maybeSaveIfComplete() {
    if (!enterRequestedRef.current) return;
    void saveAsync();
  }

  // ---------------------------------------------------------------------------
  // Placeholder handling: allow selecting bibs that are not (yet) in race starters
  // ---------------------------------------------------------------------------

  function makePlaceholderAthlete(bib: number): Athlete {
    return {
      id: `placeholder_${bib}_${Date.now()}`,
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
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
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
        </Box>


        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {mode === "finish" ? (
            <PointsRow label="3 P">
              <PointsBibField
                value={sel3P}
                inputValue={in3P}
                inputRef={ref3P}
                options={optionsFor(new Set([sel2P?.id, sel1P?.id].filter(Boolean) as string[]))}
                filterOptions={filterOptions}
                formatOption={athleteLabel}
                resolveByBib={resolveOrPlaceholder}
                onInputValueChange={(v, reason) => {
                  setIn3P(v);
                  if (reason !== "input") return;

                  auto3PBibRef.current = null;
                  setSel3P(null);

                  const pick = tryAutoPickUniqueBib(v, candidatesFor([sel2P?.id, sel1P?.id]));
                  if (pick) {
                    setSel3P(pick);
                    setIn3P(pick.bib != null ? String(pick.bib) : "");
                    setTimeout(() => ref2P.current?.focus(), 0);
                  }
                }}
                onSelect={(next) => {
                  auto3PBibRef.current = null;
                  setSel3P(next);
                  setIn3P(next?.bib != null ? String(next.bib) : "");

                  if (next) setTimeout(() => ref2P.current?.focus(), 0);
                }}
                onEnter={() => {
                  const m = resolveOrPlaceholder(in3P);
                  if (m) {
                    auto3PBibRef.current = null;
                    setSel3P(m);
                    setIn3P(m.bib != null ? String(m.bib) : "");
                    setTimeout(() => ref2P.current?.focus(), 0);
                  }
                }}
              />
            </PointsRow>
          ) : null}

          <PointsRow label={mode === "finish" ? "2 P" : "2 P"}>
            <PointsBibField
              value={sel2P}
              inputValue={in2P}
              inputRef={ref2P}
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

                auto2PBibRef.current = null;
                setSel2P(null);

                const exclude = mode === "finish" ? [sel3P?.id, sel1P?.id] : [sel1P?.id];
                const pick = tryAutoPickUniqueBib(v, candidatesFor(exclude));
                if (pick) {
                  setSel2P(pick);
                  setIn2P(pick.bib != null ? String(pick.bib) : "");
                  setTimeout(() => ref1P.current?.focus(), 0);
                }
              }}
              onSelect={(next) => {
                auto2PBibRef.current = null;
                setSel2P(next);
                setIn2P(next?.bib != null ? String(next.bib) : "");

                if (next) setTimeout(() => ref1P.current?.focus(), 0);
              }}
              onEnter={() => {
                const m = resolveOrPlaceholder(in2P);
                if (m) {
                  auto2PBibRef.current = null;
                  setSel2P(m);
                  setIn2P(m.bib != null ? String(m.bib) : "");
                  setTimeout(() => ref1P.current?.focus(), 0);
                }
              }}
            />
          </PointsRow>

          <PointsRow label="1 P">
            <PointsBibField
              value={sel1P}
              inputValue={in1P}
              inputRef={ref1P}
              options={optionsFor(new Set([sel3P?.id, sel2P?.id].filter(Boolean) as string[]))}
              filterOptions={filterOptions}
              formatOption={athleteLabel}
              resolveByBib={resolveOrPlaceholder}
              onInputValueChange={(v, reason) => {
                setIn1P(v);
                if (reason !== "input") return;

                auto1PBibRef.current = null;
                setSel1P(null);

                const pick = tryAutoPickUniqueBib(v, candidatesFor([sel3P?.id, sel2P?.id]));
                if (pick) {
                  setSel1P(pick);
                  setIn1P(pick.bib != null ? String(pick.bib) : "");
                }
              }}
              onSelect={(next) => {
                auto1PBibRef.current = null;
                setSel1P(next);
                setIn1P(next?.bib != null ? String(next.bib) : "");

                // saving is intentionally gated by Enter
                maybeSaveIfComplete();
              }}
              onEnter={() => {
                // mark that we want to save via Enter
                enterRequestedRef.current = true;

                const m = resolveOrPlaceholder(in1P);
                if (m) {
                  auto1PBibRef.current = null;
                  setSel1P(m);
                  setIn1P(m.bib != null ? String(m.bib) : "");
                  setTimeout(() => maybeSaveIfComplete(), 0);
                  return;
                }

                setTimeout(() => maybeSaveIfComplete(), 0);
              }}
            />
          </PointsRow>

          <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, mt: 0.5 }}>
            <Button size="small" variant="contained" onClick={() => void saveAsync()} disabled={!canSave}>
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
        formatAthleteLabel={athleteLabel}
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

