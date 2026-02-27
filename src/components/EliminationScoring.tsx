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

export type EliminationMode = "elim" | "DNS" | "DSQ";

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

  /** If true, EliminationScoring can react to live lap changes + prefill last-place bib. */
  syncEnabled?: boolean;
  /** Live lap count (typically RaceStatusRace.lapsComplete). */
  liveLapCount?: number | null;
  /** Bib of the last eligible athlete in live ranking (not eliminated/DNS/DSQ). */
  liveLastEligibleBib?: number | null;

  /** Bibs with 0 lapsComplete in live feed (typically DNS candidates). */
  liveZeroLapBibs?: number[];
};

function athleteLabel(a: Athlete) {
  return `${a.bib ?? ""} - ${(a.lastName ?? "").trim()} ${(a.firstName ?? "").trim()}`.trim();
}

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function bibToInt(input: string): number | null {
  const v = String(input ?? "").trim();
  if (!v) return null;
  if (!/^[0-9]+$/.test(v)) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  return i > 0 ? i : null;
}

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
  syncEnabled = false,
  liveLapCount = null,
  liveLastEligibleBib = null,
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
  const [mode, setMode] = useState<EliminationMode>("elim");
  const [lap, setLap] = useState<number>(1);

  // We always keep at least one empty input row at the end.
  const [rows, setRows] = useState<Array<{ sel: Athlete | null; input: string }>>([{ sel: null, input: "" }]);
  const [error, setError] = useState<string | null>(null);

  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

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
    setMode("elim");
    setLap(1);
    setRows([{ sel: null, input: "" }]);
    setError(null);

    closeMissingStartersDialog();
    pendingSaveRef.current = null;
    setPendingSaveBibs(null);

    // reset live-sync tracking
    prevLiveLapRef.current = null;
    autoPrefillBibRef.current = null;

    setTimeout(() => inputRefs.current[0]?.focus(), 0);
  }, [race.id, resetKey]);

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

  const canSave = parsedBibs.length > 0;

  // ---------------------------------------------------------------------------
  // Live sync handling (lap + prefill)
  // ---------------------------------------------------------------------------
  const prevLiveLapRef = useRef<number | null>(null);
  const autoPrefillBibRef = useRef<number | null>(null);

  // When sync is turned off, forget previous live lap (so re-enabling doesn't trigger a stale "change").
  useEffect(() => {
    if (syncEnabled) return;
    prevLiveLapRef.current = null;
    autoPrefillBibRef.current = null;
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

  const firstRowSelId = rows[0]?.sel?.id ?? null;
  const firstRowInput = rows[0]?.input ?? "";

  // Prefill the first bib with the last eligible bib from the live ranking.
  // We do not override user input; we only apply if first row is empty OR it was previously auto-filled.
  useEffect(() => {
    if (!syncEnabled) return;
    if (liveLastEligibleBib == null) return;

    const first = rows[0];
    const firstBib = first?.sel?.bib ?? bibToInt(first?.input ?? "");

    const isEmpty = !first?.sel && !String(first?.input ?? "").trim();
    const wasAutoFilled = autoPrefillBibRef.current != null && firstBib === autoPrefillBibRef.current;
    if (!isEmpty && !wasAutoFilled) return;

    const resolved = resolveOrPlaceholder(String(liveLastEligibleBib));
    if (!resolved) return;

    autoPrefillBibRef.current = liveLastEligibleBib;

    setRows((prev) => {
      const current0 = prev[0] ?? { sel: null, input: "" };
      const currentBib = current0.sel?.bib ?? bibToInt(current0.input);
      const desiredInput = String(liveLastEligibleBib);

      const alreadySet =
        currentBib === liveLastEligibleBib &&
        String(current0.input ?? "").trim() === desiredInput &&
        current0.sel?.bib === liveLastEligibleBib;

      const needsTrailingEmpty = prev.length === 1;
      if (alreadySet && !needsTrailingEmpty) return prev;

      const copy = prev.slice();
      copy[0] = { sel: resolved, input: desiredInput };
      if (needsTrailingEmpty) copy.push({ sel: null, input: "" });
      return copy;
    });
  }, [syncEnabled, liveLastEligibleBib, firstRowSelId, firstRowInput, starterByBib]);

  const selectedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const bib of parsedBibs) {
      const a = starterByBib.get(bib);
      if (a) ids.add(a.id);
    }
    return ids;
  }, [parsedBibs, starterByBib]);

  function focusIndex(i: number) {
    setTimeout(() => inputRefs.current[i]?.focus(), 0);
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

  function resetRows() {
    setRows([{ sel: null, input: "" }]);
    focusIndex(0);
  }

  function clearNow() {
    setError(null);
    resetRows();
  }

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

  function commitSave() {
    const bibs = parsedBibs;
    if (!bibs.length) return;

    if (mode === "elim") {
      const lapNum = Math.max(1, Math.floor(Number(lap)));
      onAddRaceActivity(toEliminationActivity(lapNum, bibs));
    } else if (mode === "DNS") {
      const acts = bibs.map((bib) => toDnsActivity(bib));
      if (onAddRaceActivities) onAddRaceActivities(acts);
      else for (const a of acts) onAddRaceActivity(a);
    } else {
      const acts = bibs.map((bib) => toDsqActivity(bib));
      if (onAddRaceActivities) onAddRaceActivities(acts);
      else for (const a of acts) onAddRaceActivity(a);
    }

    setError(null);
    resetRows();
  }

  function saveIfPossible() {
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
            disabled={mode !== "elim"}
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
            <ToggleButton value="elim" aria-label="Elim">
              Elim
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
          if (!isLast && isEmpty) return null;

          const showInsertZeroLapButton =
            idx === 0 && mode === "DNS" && syncEnabled && Number(liveLapCount ?? 0) > 0;

          return (
            <Box key={idx} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Box sx={{ width: 220 }}>
                <PointsBibField
                value={row.sel}
                inputValue={row.input}
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
                  setRows((prev) => {
                    const copy = prev.slice();
                    const isLastField = idx === prev.length - 1;

                    if (reason === "input") {
                      copy[idx] = { sel: null, input: v };
                      if (isLastField && String(v).trim()) copy.push({ sel: null, input: "" });
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
                    if (isLastField) copy.push({ sel: null, input: "" });
                    return copy;
                  });

                  ensureRow(idx + 1);
                  focusIndex(idx + 1);
                }}
                onSelect={(next) => {
                  setRows((prev) => {
                    const copy = prev.slice();
                    const isLastField = idx === prev.length - 1;
                    copy[idx] = { sel: next, input: next?.bib != null ? String(next.bib) : "" };
                    if (isLastField && next) copy.push({ sel: null, input: "" });
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
                      if (isLastField) copy.push({ sel: null, input: "" });
                      return copy;
                    });
                  } else {
                    return;
                  }

                  ensureRow(idx + 1);
                  focusIndex(idx + 1);
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
          <Button size="small" variant="contained" onClick={saveIfPossible} disabled={!canSave}>
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

      <ScoringStarterList starters={starters} selectedIds={selectedIds} formatAthleteLabel={athleteLabel} />

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

