import { type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";

import DeleteIcon from "@mui/icons-material/Delete";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";

import { createFilterOptions } from "@mui/material/useAutocomplete";

import PointsBibField, { type AthleteFilterOptions } from "./PointsBibField";
import ScoringStarterList from "./ScoringStarterList";

import type { Athlete } from "../types/athlete";
import type { Race, RaceResult } from "../types/race";

type Props = {
  race: Race;
  /** Use e.g. race.id so the component can reset when switching races */
  resetKey?: string;

  /** Persist the updated raceResults back into the race (page updates realtime doc) */
  onChangeRaceResults: (next: RaceResult[]) => void;

  /** Optional: when a bib is not in starters, ask to create it (same flow as PointsScoring). */
  onCreateStarters?: (bibs: number[]) => Promise<void> | void;
};

function bibToInt(input: string): number | null {
  const v = String(input ?? "").trim();
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  return i > 0 ? i : null;
}

function athleteLabel(a: Athlete) {
  return `${a.bib ?? ""} - ${(a.lastName ?? "").trim()} ${(a.firstName ?? "").trim()}`.trim();
}

function groupFinishersByFinishRank(sortedFinishers: RaceResult[]): RaceResult[][] {
  // Expects finishers sorted by (finishRank asc, bib asc)
  const groups: RaceResult[][] = [];
  let lastRank: number | null = null;

  for (const r of sortedFinishers) {
    const rank = Number(r?.finishRank ?? 0) || 0;
    if (!groups.length || rank !== lastRank) {
      groups.push([r]);
      lastRank = rank;
    } else {
      groups[groups.length - 1].push(r);
    }
  }

  return groups;
}

function applyCompetitionRanking(groups: RaceResult[][]): RaceResult[] {
  // Competition ranking: ranks jump by the size of a tie group, e.g. 1,1,3
  let nextRank = 1;
  const out: RaceResult[] = [];

  for (const g of groups) {
    const items = [...g].sort((a, b) => Number(a.bib ?? 0) - Number(b.bib ?? 0));
    for (const r of items) out.push({ ...r, finishRank: nextRank });
    nextRank += items.length;
  }

  return out;
}

function rankToInt(input: string): number | null {
  const v = String(input ?? "").trim();
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  return i > 0 ? i : null;
}

function computeNextSuggestedRank(finishers: RaceResult[]): number {
  if (!finishers.length) return 1;

  let maxRank = 0;
  for (const r of finishers) {
    const fr = Number(r?.finishRank ?? 0);
    if (Number.isFinite(fr) && fr > maxRank) maxRank = fr;
  }

  if (maxRank <= 0) return 1;

  const countAtMax = finishers.filter((r) => Number(r?.finishRank ?? 0) === maxRank).length;
  return maxRank + Math.max(1, countAtMax);
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

export default function FinishLineScoring({
  race,
  resetKey,
  onChangeRaceResults,
  onCreateStarters,
}: Props) {
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

  const raceResults = useMemo(() => {
    const raw = Array.isArray((race as any)?.raceResults) ? ((race as any).raceResults as RaceResult[]) : [];
    // keep stable order by bib as secondary if finishRank equal
    return [...raw];
  }, [race]);

  const finishers = useMemo(() => {
    return raceResults
      .filter((r) => Number(r?.finishRank ?? 0) !== 0)
      .sort((a, b) => {
        const ar = Number(a.finishRank ?? 0) || 9999;
        const br = Number(b.finishRank ?? 0) || 9999;
        if (ar !== br) return ar - br;
        return Number(a.bib ?? 0) - Number(b.bib ?? 0);
      });
  }, [raceResults]);

  const selectedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of finishers) {
      const a = starterByBib.get(Number(r.bib)) ?? null;
      if (a) ids.add(a.id);
    }
    return ids;
  }, [finishers, starterByBib]);

  const finishBibSet = useMemo(() => new Set(finishers.map((r) => Number(r.bib))), [finishers]);

  const [rankInput, setRankInput] = useState("");
  const [bibInput, setBibInput] = useState("");
  const [selBib, setSelBib] = useState<Athlete | null>(null);
  const [error, setError] = useState<string | null>(null);

  const bibRef = useRef<HTMLInputElement>(null);
  const dragFromIndexRef = useRef<number | null>(null);

  // Confirmation dialog for creating missing starters
  const [missingDialogOpen, setMissingDialogOpen] = useState(false);
  const [missingDialogBibs, setMissingDialogBibs] = useState<number[]>([]);
  const [missingDialogBusy, setMissingDialogBusy] = useState(false);

  // When the user chooses "create starter", we have to wait for the starter-create patch
  // to roundtrip from the server (this app is non-optimistic).
  // Otherwise the subsequent "add finish result" patch may be rejected due to rev mismatch.
  const [pendingAddBib, setPendingAddBib] = useState<number | null>(null);
  const [pendingAddRank, setPendingAddRank] = useState<number | null>(null);

  const filterOptions: AthleteFilterOptions = useMemo(() => {
    const base = createFilterOptions<Athlete>({
      stringify: (o) => `${o.bib ?? ""} ${(o.lastName ?? "")} ${(o.firstName ?? "")} ${(o.nation ?? "")}`,
      trim: true,
    });

    // Only show suggestions when at least 1 character was typed.
    return (options, state) => {
      if (!state.inputValue.trim()) return [];
      return base(options, state);
    };
  }, []);

  const bibOptions = useMemo(() => {
    // Only suggest starters that are not already in the finish list.
    return starters.filter((a) => a.bib != null && !finishBibSet.has(a.bib));
  }, [starters, finishBibSet]);

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

  function closeMissingStartersDialog() {
    setMissingDialogOpen(false);
    setMissingDialogBibs([]);
  }

  useEffect(() => {
    setRankInput(String(computeNextSuggestedRank(finishers)));
    setBibInput("");
    setSelBib(null);
    setError(null);
    closeMissingStartersDialog();
    setPendingAddBib(null);
    setPendingAddRank(null);

    setTimeout(() => bibRef.current?.focus(), 0);
  }, [resetKey, race.id]);

  // After saving (raceResults update comes back in via props), update the suggested next rank,
  // but don't overwrite the user's in-progress input.
  useEffect(() => {
    if (bibInput.trim()) return;
    if (missingDialogOpen) return;
    if (pendingAddBib != null) return;

    setRankInput(String(computeNextSuggestedRank(finishers)));
  }, [finishers, bibInput, missingDialogOpen, pendingAddBib]);

  function makeDefaultRaceResult(bib: number): RaceResult {
    return {
      bib,
      rank: 0,
      points: 0,
      eliminated: false,
      eliminationLap: 0,
      dns: false,
      dsq: false,
      lapsCompleted: 0,
      finishTime: "",
      finishRank: 0,
    };
  }

  function commitAddBib(bib: number, finishRank: number) {
    const existing = raceResults.find((r) => Number(r?.bib) === bib) ?? null;
    const base: RaceResult = existing ? { ...existing } : makeDefaultRaceResult(bib);

    const nextFinishers = [...finishers, {
      ...base,
      finishRank,
      // keep any existing laps/time if present
      lapsCompleted: Number.isFinite(Number(base.lapsCompleted)) ? Number(base.lapsCompleted) : 0,
      finishTime: String(base.finishTime ?? ""),
    }].sort((a, b) => {
      const ar = Number(a.finishRank ?? 0) || 9999;
      const br = Number(b.finishRank ?? 0) || 9999;
      if (ar !== br) return ar - br;
      return Number(a.bib ?? 0) - Number(b.bib ?? 0);
    });

    // Merge finishers back into the full raceResults list
    const nextByBib = new Map<number, RaceResult>();
    for (const r of nextFinishers) nextByBib.set(Number(r.bib), r);

    const nextRaceResults: RaceResult[] = [];

    // Update existing entries
    for (const r of raceResults) {
      const bibNum = Number((r as any)?.bib);
      if (!Number.isFinite(bibNum)) continue;
      const updated = nextByBib.get(bibNum);
      nextRaceResults.push(updated ? { ...r, ...updated } : r);
      nextByBib.delete(bibNum);
    }

    // Append new entries (bib was not present in raceResults before)
    for (const r of nextByBib.values()) nextRaceResults.push(r);

    onChangeRaceResults(nextRaceResults);

    setRankInput(String(computeNextSuggestedRank(nextFinishers)));
    setBibInput("");
    setSelBib(null);
    setError(null);
    setTimeout(() => bibRef.current?.focus(), 0);
  }

  function requestAddBibFromText(bibText: string, rankText: string) {
    const finishRank = rankToInt(rankText);
    if (finishRank == null) {
      setError("Bitte einen gültigen Rank eingeben");
      return;
    }

    const bib = bibToInt(bibText);
    if (bib == null) {
      setError("Bitte eine gültige Startnummer eingeben");
      return;
    }

    if (finishers.some((r) => Number(r.bib) === bib)) {
      setError(`Startnummer ${bib} ist bereits in der Finisher-Liste`);
      return;
    }

    // If bib is not an existing starter: ask to create it.
    if (!starterByBib.has(bib)) {
      if (!onCreateStarters) {
        setError(`Startnummer ${bib} ist nicht in der Starterliste`);
        return;
      }

      setPendingAddBib(bib);
      setPendingAddRank(finishRank);
      setMissingDialogBibs([bib]);
      setMissingDialogOpen(true);
      return;
    }

    commitAddBib(bib, finishRank);
  }

  async function handleDialogCreateAndAdd() {
    if (!onCreateStarters) return;

    try {
      setMissingDialogBusy(true);
      await onCreateStarters(missingDialogBibs);
      closeMissingStartersDialog();
      // actual adding happens via effect below, once starter exists locally
    } finally {
      setMissingDialogBusy(false);
    }
  }

  function handleDialogCancel() {
    closeMissingStartersDialog();
    setPendingAddBib(null);
    setPendingAddRank(null);
  }

  // After the missing-starter creation patch arrived (starter now exists), add the bib to the finish list.
  useEffect(() => {
    if (pendingAddBib == null) return;

    // If it was added elsewhere in the meantime, stop waiting.
    if (finishers.some((r) => Number(r.bib) === pendingAddBib)) {
      setPendingAddBib(null);
      setPendingAddRank(null);
      return;
    }

    // Wait until the created starter is actually present in starters.
    if (!starterByBib.has(pendingAddBib)) return;

    const bib = pendingAddBib;
    const rank = pendingAddRank;
    setPendingAddBib(null);
    setPendingAddRank(null);

    // rank should always be set (we only set pendingAddBib together with pendingAddRank)
    commitAddBib(bib, rank ?? computeNextSuggestedRank(finishers));
  }, [pendingAddBib, pendingAddRank, finishers, starterByBib]);

  function commitFinishers(nextFinishers: RaceResult[], removedBibs: Set<number> = new Set()) {
    const nextByBib = new Map<number, RaceResult>();
    for (const r of nextFinishers) nextByBib.set(Number(r.bib), r);

    const nextRaceResults: RaceResult[] = [];

    for (const r of raceResults) {
      const bibNum = Number((r as any)?.bib);
      if (!Number.isFinite(bibNum)) continue;

      if (removedBibs.has(bibNum)) {
        nextRaceResults.push({
          ...r,
          finishRank: 0,
          finishTime: "",
        });
        continue;
      }

      const updated = nextByBib.get(bibNum);
      nextRaceResults.push(updated ? { ...r, ...updated } : r);
      nextByBib.delete(bibNum);
    }

    for (const r of nextByBib.values()) nextRaceResults.push(r);

    onChangeRaceResults(nextRaceResults);
  }

  function removeAt(idx: number) {
    const bib = Number(finishers[idx]?.bib);
    if (!Number.isFinite(bib)) return;

    const nextFinishers = finishers.filter((_, i) => i !== idx);
    commitFinishers(nextFinishers, new Set([bib]));
  }

  function updateAt(idx: number, patch: Partial<Pick<RaceResult, "finishTime">>) {
    const nextFinishers = finishers.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    commitFinishers(nextFinishers);
  }

  function onDragStart(idx: number) {
    dragFromIndexRef.current = idx;
  }

  function onDrop(e: DragEvent<HTMLElement>, idx: number) {
    const from = dragFromIndexRef.current;
    dragFromIndexRef.current = null;

    if (from == null) return;
    if (from === idx) return;

    const dragged = finishers[from];
    const target = finishers[idx];
    if (!dragged || !target) return;

    const draggedBib = Number(dragged.bib);
    const targetBib = Number(target.bib);
    if (!Number.isFinite(draggedBib) || !Number.isFinite(targetBib)) return;

    const withShift = e.shiftKey;

    // Build tie groups from current state.
    const groups = groupFinishersByFinishRank(finishers);

    // Remove dragged from its current group.
    for (let gi = 0; gi < groups.length; gi++) {
      const g = groups[gi];
      const nextG = g.filter((r) => Number(r.bib) !== draggedBib);
      if (nextG.length !== g.length) {
        if (nextG.length === 0) groups.splice(gi, 1);
        else groups[gi] = nextG;
        break;
      }
    }

    // Find target group (after removal).
    const targetGroupIndex = groups.findIndex((g) => g.some((r) => Number(r.bib) === targetBib));
    if (targetGroupIndex < 0) return;

    if (withShift) {
      // Shift+Drop: create a tie by putting the dragged athlete into the target's tie group.
      groups[targetGroupIndex] = [...groups[targetGroupIndex], dragged];
    } else {
      // Normal Drop: insert the dragged athlete as its own group BEFORE the target's tie group.
      // This keeps existing ties (for non-moved athletes) intact.
      groups.splice(targetGroupIndex, 0, [dragged]);
    }

    const nextFinishers = applyCompetitionRanking(groups);
    commitFinishers(nextFinishers);
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      {/* Quick entry */}
      <Box sx={{ p: 2, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, mb: 1 }}>
          <Typography variant="subtitle2">Finish</Typography>
          <Typography variant="caption" color="text.secondary">
            {finishers.length}
          </Typography>
        </Box>

        <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
          <TextField
            value={rankInput}
            onChange={(e) => {
              setRankInput((e.target as HTMLInputElement).value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                setTimeout(() => bibRef.current?.focus(), 0);
              }
            }}
            placeholder="Rank"
            size="small"
            variant="outlined"
            inputProps={{ inputMode: "numeric", pattern: "[0-9]*" }}
            sx={{ width: 80 }}
          />

          <Box sx={{ width: 140 }}>
            <PointsBibField
              value={selBib}
              inputValue={bibInput}
              inputRef={bibRef}
              options={bibOptions}
              filterOptions={filterOptions}
              formatOption={athleteLabel}
              resolveByBib={resolveOrPlaceholder}
              placeholder="Bib"
              nameAdornmentMaxWidth={180}
              onInputValueChange={(v, reason) => {
                setBibInput(v);
                setError(null);

                if (reason !== "input") return;

                setSelBib(null);
                const pick = tryAutoPickUniqueBib(v, bibOptions);
                if (pick) {
                  setSelBib(pick);
                  setBibInput(pick.bib != null ? String(pick.bib) : "");
                }
              }}
              onSelect={(next) => {
                setError(null);
                setSelBib(next);
                setBibInput(next?.bib != null ? String(next.bib) : "");
              }}
              onEnter={() => {
                setError(null);

                // Make sure we can still show the name adornment when a valid bib is typed.
                const m = resolveOrPlaceholder(bibInput);
                if (m) {
                  setSelBib(m);
                  setBibInput(m.bib != null ? String(m.bib) : "");
                }

                requestAddBibFromText(bibInput, rankInput);
              }}
            />
          </Box>

          <Button size="small" variant="contained" onClick={() => requestAddBibFromText(bibInput, rankInput)}>
            Add
          </Button>

          <Typography variant="caption" color="text.secondary" sx={{ ml: "auto" }}>
            Tip bibs in order and press Enter.
          </Typography>
        </Box>

        {error ? (
          <Typography variant="caption" color="error" sx={{ display: "block", mt: 0.75 }}>
            {error}
          </Typography>
        ) : null}
      </Box>

      {/* Results table */}
      <Box sx={{ p: 2, border: "1px solid", borderColor: "divider", borderRadius: 1, minHeight: 0 }}>
        {finishers.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No finish results yet.
          </Typography>
        ) : (
          <Table
            size="small"
            stickyHeader
            sx={{
              "& th, & td": {
                px: 0.5, // horizontal padding (default is larger)
                py: 0.25, // vertical padding
              },
            }}
          >
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 20 }} padding="checkbox">
                  Rank
                </TableCell>
                <TableCell sx={{ width: 90 }} padding="checkbox">
                  Bib
                </TableCell>
                <TableCell sx={{ width: 170 }} padding="checkbox">
                  Time
                </TableCell>
                <TableCell sx={{ width: 20 }} padding="checkbox" />
              </TableRow>
            </TableHead>

            <TableBody>
              {finishers.map((r, idx) => {
                const a = starterByBib.get(Number(r.bib)) ?? null;

                return (
                  <TableRow
                    key={`${r.bib}-${idx}`}
                    hover
                    draggable
                    onDragStart={() => onDragStart(idx)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => onDrop(e, idx)}
                    sx={{ cursor: "grab" }}
                    title={a ? athleteLabel(a) : undefined}
                  >
                    <TableCell>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.1 }}>
                        <DragIndicatorIcon fontSize="small" color="action" />
                        <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
                          {Number(r.finishRank ?? idx + 1)}
                        </Typography>
                      </Box>
                    </TableCell>

                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        {r.bib}
                      </Typography>
                      {a ? (
                        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                          {a.lastName}
                        </Typography>
                      ) : null}
                    </TableCell>

                    <TableCell>
                      <TextField
                        variant="standard"
                        size="small"
                        value={String(r.finishTime ?? "")}
                        onChange={(e) => updateAt(idx, { finishTime: (e.target as HTMLInputElement).value })}
                        placeholder="0:15,032"
                        sx={{
                          width: "100%",
                          "& .MuiInputBase-input": { fontSize: 13, py: 0.5 },
                        }}
                      />
                    </TableCell>

                    <TableCell padding="checkbox">
                      <Tooltip title="Remove" arrow>
                        <span>
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => removeAt(idx)}
                            aria-label="Remove"
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
          Tip: Drag rows to change the rank order. Hold Shift while dropping to create a tie (same rank).
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

          <Button variant="contained" onClick={() => void handleDialogCreateAndAdd()} disabled={missingDialogBusy}>
            Starter anlegen &amp; hinzufügen
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

