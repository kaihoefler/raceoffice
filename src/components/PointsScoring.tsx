import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  List,
  ListItem,
  ListItemText,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import Autocomplete, { createFilterOptions } from "@mui/material/Autocomplete";

import type { Athlete } from "../types/athlete";
import type { Race } from "../types/race";
import type { RaceActivityPointsSprint } from "../types/raceactivities";




export type PointsMode = "lap" | "finish";


type Props = {
  /** Active race (comes from the page) */
  race: Race;
  /** Use e.g. race.id so the component resets when switching races */
  resetKey?: string;
  /** Add a new RaceActivityPointsSprint to the race (no editing in this component) */
  onAddRaceActivity: (activity: RaceActivityPointsSprint) => void;
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

export default function PointsScoring({ race, resetKey, onAddRaceActivity }: Props) {
  const starters = useMemo(() => {
    const s = race.raceStarters ?? [];
    return [...s].sort((a, b) => {
      const ai = a.bib ?? Number.MAX_SAFE_INTEGER;
      const bi = b.bib ?? Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return (a.lastName ?? "").localeCompare(b.lastName ?? "", undefined, { sensitivity: "base" });
    });
  }, [race.raceStarters]);


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

    
  // Used to ensure saving happens "through Enter".
  const enterRequestedRef = useRef(false);


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


    const filterOptions = useMemo(() => {
    const base = createFilterOptions<Athlete>({

      stringify: (o) => `${o.bib ?? ""} ${(o.lastName ?? "")} ${(o.firstName ?? "")} ${(o.nation ?? "")}`,
      trim: true,
    });

    // Only show suggestions when at least 1 character was typed.
    // This also prevents showing an empty dropdown / "no options" on focus.
    return (options: Athlete[], state: { inputValue: string }) => {
      if (!state.inputValue.trim()) return [];
      return base(options, state as any);
    };
  }, []);




  

  

  const selectedIds = useMemo(() => {
    const ids = new Set<string>();

    if (sel3P) ids.add(sel3P.id);
    if (sel2P) ids.add(sel2P.id);
    if (sel1P) ids.add(sel1P.id);
    return ids;
  }, [sel1P, sel2P, sel3P]);

  const optionsFor = (exclude: Set<string>) => starters.filter((a) => !exclude.has(a.id));

  function resetInputs(focus: "2P" | "3P" = "2P") {
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
      setSel3P(null);
      setIn3P("");
      setTimeout(() => ref2P.current?.focus(), 0);
    }
  }, [mode]);

    

  function trySelectByBib(input: string): Athlete | null {
    const v = input.trim();

    if (!v) return null;
    const bib = Number(v);
    if (!Number.isFinite(bib)) return null;
    return starters.find((a) => a.bib === bib) ?? null;
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

  function candidatesFor(excludeIds: Array<string | null | undefined>): Athlete[] {
    const exclude = new Set(excludeIds.filter(Boolean) as string[]);
    return starters.filter((a) => !exclude.has(a.id));
  }


    

  function maybeSaveIfComplete() {

    if (!enterRequestedRef.current) return;

    const lapNum = Math.max(1, Math.floor(Number(lap)));

    if (mode === "lap") {
      if (sel2P && sel1P && sel2P.bib != null && sel1P.bib != null) {
        enterRequestedRef.current = false;
        onAddRaceActivity(
          toPointsSprintActivity(lapNum, [
            { bib: sel2P.bib, points: 2 },
            { bib: sel1P.bib, points: 1 },
          ]),
        );
        resetInputs("2P");
      }
      return;
    }

    // finish
    if (sel3P && sel2P && sel1P && sel3P.bib != null && sel2P.bib != null && sel1P.bib != null) {
      enterRequestedRef.current = false;
      onAddRaceActivity(
        toPointsSprintActivity(lapNum, [
          { bib: sel3P.bib, points: 3 },
          { bib: sel2P.bib, points: 2 },
          { bib: sel1P.bib, points: 1 },
        ]),
      );
      resetInputs("3P");
    }
  }


  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      {/* Points entry */}
            <Box sx={{ p: 2, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, mb: 1 }}>

          <Typography variant="subtitle2">Points</Typography>

          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <TextField
              size="small"
              label="Lap"
              value={lap}
              onChange={(e) => setLap(Number(e.target.value))}
              type="number"
              inputProps={{ min: 1, step: 1 }}
              sx={{ width: 110 }}
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
              <ToggleButton value="lap" aria-label="Standard Lap">
                Standard Lap
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
              <Autocomplete
                size="small"
                options={optionsFor(new Set([sel2P?.id, sel1P?.id].filter(Boolean) as string[]))}
                                value={sel3P}
                inputValue={in3P}
                                open={Boolean(in3P.trim()) && !sel3P}

                onInputChange={(_, v) => {
                  setIn3P(v);

                  const pick = tryAutoPickUniqueBib(v, candidatesFor([sel2P?.id, sel1P?.id]));
                  if (pick) {
                    setSel3P(pick);
                    setIn3P(athleteLabel(pick));
                    setTimeout(() => ref2P.current?.focus(), 0);
                  }
                }}

                onChange={(_, v) => {
                  const next = (typeof v === "string" ? trySelectByBib(v) : v) as Athlete | null;
                  setSel3P(next);
                  if (next) {
                    setIn3P(athleteLabel(next));
                    setTimeout(() => ref2P.current?.focus(), 0);
                  }
                }}
                filterOptions={filterOptions}
                                autoHighlight
                openOnFocus={false}
                freeSolo

                isOptionEqualToValue={(o, v) => o.id === v.id}
                getOptionLabel={(o) => (typeof o === "string" ? o : athleteLabel(o))}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    inputRef={ref3P}
                    placeholder="Startnummer"
                    inputProps={{ ...params.inputProps, inputMode: "numeric" }}
                    onKeyDown={(ev) => {
                      if (ev.key !== "Enter") return;
                      const m = trySelectByBib(in3P);
                      if (m) {
                        setSel3P(m);
                        setIn3P(athleteLabel(m));
                        setTimeout(() => ref2P.current?.focus(), 0);
                      }
                    }}
                  />
                )}
              />
            </PointsRow>
          ) : null}

          <PointsRow label={mode === "finish" ? "2 P" : "2 P"}>
            <Autocomplete
              size="small"
              options={
                mode === "finish"
                  ? optionsFor(new Set([sel3P?.id, sel1P?.id].filter(Boolean) as string[]))
                  : optionsFor(new Set([sel1P?.id].filter(Boolean) as string[]))
              }
                            value={sel2P}
              inputValue={in2P}
                            open={Boolean(in2P.trim()) && !sel2P}

              onInputChange={(_, v) => {
                setIn2P(v);

                const exclude = mode === "finish" ? [sel3P?.id, sel1P?.id] : [sel1P?.id];
                const pick = tryAutoPickUniqueBib(v, candidatesFor(exclude));
                if (pick) {
                  setSel2P(pick);
                  setIn2P(athleteLabel(pick));
                  setTimeout(() => ref1P.current?.focus(), 0);
                }
              }}

              onChange={(_, v) => {
                const next = (typeof v === "string" ? trySelectByBib(v) : v) as Athlete | null;
                setSel2P(next);
                if (next) {
                  setIn2P(athleteLabel(next));
                  setTimeout(() => ref1P.current?.focus(), 0);
                }
              }}
              filterOptions={filterOptions}
                              autoHighlight
                openOnFocus={false}
                freeSolo

              isOptionEqualToValue={(o, v) => o.id === v.id}
              getOptionLabel={(o) => (typeof o === "string" ? o : athleteLabel(o))}
              renderInput={(params) => (
                <TextField
                  {...params}
                  inputRef={ref2P}
                  placeholder="Startnummer"
                  inputProps={{ ...params.inputProps, inputMode: "numeric" }}
                  onKeyDown={(ev) => {
                    if (ev.key !== "Enter") return;
                    const m = trySelectByBib(in2P);
                    if (m) {
                      setSel2P(m);
                      setIn2P(athleteLabel(m));
                      setTimeout(() => ref1P.current?.focus(), 0);
                    }
                  }}
                />
              )}
            />
          </PointsRow>

          <PointsRow label="1 P">
            <Autocomplete
              size="small"
              options={optionsFor(new Set([sel3P?.id, sel2P?.id].filter(Boolean) as string[]))}
                            value={sel1P}
              inputValue={in1P}
                            open={Boolean(in1P.trim()) && !sel1P}

              onInputChange={(_, v) => {
                setIn1P(v);

                const pick = tryAutoPickUniqueBib(v, candidatesFor([sel3P?.id, sel2P?.id]));
                if (pick) {
                  setSel1P(pick);
                  setIn1P(athleteLabel(pick));
                }
              }}

              onChange={(_, v) => {
                const next = (typeof v === "string" ? trySelectByBib(v) : v) as Athlete | null;
                setSel1P(next);
                if (next) setIn1P(athleteLabel(next));
                // saving is intentionally gated by Enter
                maybeSaveIfComplete();
              }}
              filterOptions={filterOptions}
                              autoHighlight
                openOnFocus={false}
                freeSolo

              isOptionEqualToValue={(o, v) => o.id === v.id}
              getOptionLabel={(o) => (typeof o === "string" ? o : athleteLabel(o))}
              renderInput={(params) => (
                <TextField
                  {...params}
                  inputRef={ref1P}
                  placeholder="Startnummer"
                  inputProps={{ ...params.inputProps, inputMode: "numeric" }}
                  onKeyDown={(ev) => {
                    if (ev.key !== "Enter") return;

                    // mark that we want to save via Enter
                    enterRequestedRef.current = true;

                    // try to resolve bib if user typed a number and didn't select from dropdown
                    const m = trySelectByBib(in1P);
                    if (m) {
                      setSel1P(m);
                      setIn1P(athleteLabel(m));
                      // save will happen onChange (state update) or below if already selected
                      setTimeout(() => maybeSaveIfComplete(), 0);
                      return;
                    }

                    // If already selected and user presses Enter -> save
                    setTimeout(() => maybeSaveIfComplete(), 0);
                  }}
                />
              )}
            />
          </PointsRow>

          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
            Tip a bib number and select a starter (keyboard). Press Enter in the last field to save.
          </Typography>
        </Box>
      </Box>

      {/* Compact starters list */}
      <Box sx={{ p: 2, border: "1px solid", borderColor: "divider", borderRadius: 1, minHeight: 0 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
          <Typography variant="subtitle2">Starters</Typography>
          <Typography variant="caption" color="text.secondary">
            {starters.length}
          </Typography>
        </Box>

        {starters.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No starters.
          </Typography>
        ) : (
          <List dense sx={{ maxHeight: 420, overflow: "auto", py: 0 }}>
            {starters.map((a) => (
              <ListItem
                key={a.id}
                sx={{
                  px: 1,
                  borderRadius: 1,
                  bgcolor: selectedIds.has(a.id) ? "action.selected" : "transparent",
                }}
              >
                <ListItemText primaryTypographyProps={{ variant: "body2" }} primary={athleteLabel(a)} />
              </ListItem>
            ))}
          </List>
        )}
      </Box>
    </Box>
  );
}
