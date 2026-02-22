// src/pages/ActiveEventPage.tsx
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  Box,
  Card,
  CardContent,
  CardHeader,
  Chip,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
  IconButton,
  Tooltip,
} from "@mui/material";

import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import GroupsIcon from "@mui/icons-material/Groups";

import { useRealtimeDoc } from "../realtime/useRealtimeDoc";
import { useEventList } from "../providers/EventListProvider";

import type { FullEvent } from "../types/event";
import type { Race } from "../types/race";

import RaceEditor, { type RaceDraft } from "../components/RaceEditor";

function normalizeFullEvent(raw: unknown, eventId: string): FullEvent {
  const obj = raw && typeof raw === "object" ? (raw as any) : {};

  const races = Array.isArray(obj.races) ? obj.races : [];

  return {
    id: typeof obj.id === "string" ? obj.id : eventId,
    name: typeof obj.name === "string" ? obj.name : "",
    slug: typeof obj.slug === "string" ? obj.slug : "",
    ageGroups: Array.isArray(obj.ageGroups) ? obj.ageGroups : [],
    races: races.map((r: any) => ({
      ...r,
      raceResults: Array.isArray(r?.raceResults) ? r.raceResults : [],
      raceStarters: Array.isArray(r?.raceStarters) ? r.raceStarters : [],
            raceActivities: Array.isArray(r?.raceActivities) ? r.raceActivities : [],

    })),
    athletes: Array.isArray(obj.athletes) ? obj.athletes : [],
  };
}


function formatRaceMode(r: Race): string {
  const isPoints = !!r.racemode?.isPointsRace;
  const isElim = !!r.racemode?.isEliminationRace;

  if (isPoints && isElim) return "Points + Elimination";
  if (isPoints) return "Points";
  if (isElim) return "Elimination";
  return "Standard";
}


function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function incrementStageValue(value: string): string {
  const v = value.trim();
  if (!v) return "";

  if (/^\d+$/.test(v)) return String(Number(v) + 1);

  if (/^[A-Za-z]+$/.test(v)) {
    const upper = v.toUpperCase();
    const chars = upper.split("").map((c) => c.charCodeAt(0) - 65);
    let carry = 1;

    for (let i = chars.length - 1; i >= 0; i--) {
      const next = chars[i] + carry;
      chars[i] = next % 26;
      carry = Math.floor(next / 26);
      if (!carry) break;
    }

    if (carry) chars.unshift(carry - 1);
    return chars.map((n) => String.fromCharCode(65 + n)).join("");
  }

  return v;
}

export default function ActiveEventPage() {
  const { eventList } = useEventList();

  if (!eventList) return <Typography variant="h6">Loading…</Typography>;
  if (!eventList.activeEventId) return <Typography variant="h6">No active event selected.</Typography>;

  const activeEventId = eventList.activeEventId;
  const activeEvent = eventList.events.find((e) => e.id === activeEventId) ?? null;

  const docId = activeEventId ? `Event-${activeEventId}` : null;
  const { data: raw, update, status, error } = useRealtimeDoc<Partial<FullEvent>>(docId);

  const fullEvent = useMemo(() => normalizeFullEvent(raw, activeEventId), [raw, activeEventId]);

  const navigate = useNavigate();

  // -----------------------
  // RaceEditor state
  // -----------------------
  const [raceEditorOpen, setRaceEditorOpen] = useState(false);
  const [raceEditorMode, setRaceEditorMode] = useState<"new" | "edit">("new");
  const [editorInitialRace, setEditorInitialRace] = useState<Race | null>(null);

  function openNewRace() {
    setRaceEditorMode("new");
    setEditorInitialRace(null);
    setRaceEditorOpen(true);
  }

  function openEditRace(raceId: string) {
    const r = fullEvent.races.find((x) => x.id === raceId) ?? null;
    setRaceEditorMode("edit");
    setEditorInitialRace(r);
    setRaceEditorOpen(true);
  }

    function openNextRaceFrom(r: Race) {
    const nextStageValue = incrementStageValue(r.stage_value);

    const template: Race = {
      ...r,
      name: "",
      slug: "",
      stage_value: nextStageValue,
      raceResults: [], // new race starts without results
      raceActivities: [], // new race starts without activities
    };


    setRaceEditorMode("new");
    setEditorInitialRace(template);
    setRaceEditorOpen(true);
  }

  function closeRaceEditor() {
    setRaceEditorOpen(false);
    setEditorInitialRace(null);
    setRaceEditorMode("new");
  }

  function saveRace(draft: RaceDraft) {
    update((prev) => {
      const current = normalizeFullEvent(prev, activeEventId);

      // Keep existing results if we are updating an existing race
      const existing = current.races.find((r) => r.id === draft.id);
      const existingResults = existing?.raceResults ?? [];
      const existingStarters = existing?.raceStarters ?? [];
      const existingActivities = existing?.raceActivities ?? [];
       

      const normalizedStageValue = draft.stage === "" ? "" : draft.stage_value;

      const nextRace: Race = {
        id: draft.id,
        eventId: draft.eventId,
        ageGroupId: draft.ageGroupId,
        name: draft.name.trim(),
        slug: slugify(draft.name),
        racemode: draft.racemode,
        stage: draft.stage,
        stage_value: normalizedStageValue,
        distance_value: draft.distance_value,
        raceResults: existingResults,
        raceStarters: existingStarters,
        raceActivities: existingActivities,
        
        
      };

      const exists = current.races.some((r) => r.id === nextRace.id);
      const nextRaces = exists
        ? current.races.map((r) => (r.id === nextRace.id ? { ...r, ...nextRace } : r))
        : [nextRace, ...current.races];

      return { ...current, races: nextRaces } as Partial<FullEvent>;
    });

    closeRaceEditor();
  }

  function deleteRace(raceId: string) {
    const r = fullEvent.races.find((x) => x.id === raceId);
    const ok = window.confirm(`Delete race "${r?.name ?? raceId}"?`);
    if (!ok) return;

    update((prev) => {
      const current = normalizeFullEvent(prev, activeEventId);
      return { ...current, races: current.races.filter((x) => x.id !== raceId) } as Partial<FullEvent>;
    });
  }

  // -----------------------
  // Filters and Sort
  // -----------------------
  const [ageGroupFilter, setAgeGroupFilter] = useState<string>("all");
  const [stageFilter, setStageFilter] = useState<"all" | Race["stage"]>("all");
  const [modeFilter, setModeFilter] = useState<"all" | "points" | "elimination" | "standard">("all");

const filteredRaces = useMemo(() => {
  const stageRank: Record<Race["stage"], number> = {
    "": 0,
    qualifying: 1,
    heat: 2,
    final: 3,
  };

  const modeRank = (r: Race) => {
    const p = !!r.racemode?.isPointsRace;
    const e = !!r.racemode?.isEliminationRace;
    if (!p && !e) return 0; // Standard
    if (p && !e) return 1;  // Points
    if (!p && e) return 2;  // Elimination
    return 3;               // Points + Elimination
  };

  const ageGroupSortKey = (ageGroupId: string) => {
    const ag = fullEvent.ageGroups.find((x) => x.id === ageGroupId);
    if (!ag) return `~${ageGroupId}`; // unknown at end
    return `${ag.name.toLowerCase()}|${ag.gender}`;
  };

  const parseStageValue = (value: string) => {
    const v = value.trim();
    if (!v) return { kind: 2 as const, num: Infinity, alpha: "" };

    if (/^\d+$/.test(v)) return { kind: 0 as const, num: Number(v), alpha: "" };

    if (/^[A-Za-z]+$/.test(v)) return { kind: 1 as const, num: Infinity, alpha: v.toUpperCase() };

    return { kind: 2 as const, num: Infinity, alpha: v };
  };

  return (fullEvent.races ?? [])
    .filter((r) => {
      if (ageGroupFilter !== "all" && r.ageGroupId !== ageGroupFilter) return false;
      if (stageFilter !== "all" && r.stage !== stageFilter) return false;

      if (modeFilter !== "all") {
        const isPoints = !!r.racemode?.isPointsRace;
        const isElim = !!r.racemode?.isEliminationRace;

        if (modeFilter === "points" && !isPoints) return false;
        if (modeFilter === "elimination" && !isElim) return false;
        if (modeFilter === "standard" && (isPoints || isElim)) return false;
      }

      return true;
    })
    .slice()
    .sort((a, b) => {
      // 1) AgeGroup
      const agA = ageGroupSortKey(a.ageGroupId);
      const agB = ageGroupSortKey(b.ageGroupId);
      if (agA < agB) return -1;
      if (agA > agB) return 1;

      // 2) Race mode
      const mA = modeRank(a);
      const mB = modeRank(b);
      if (mA !== mB) return mA - mB;

      // 3) Stage ordering: qualifying < heat < final ("" before all)
      const sA = stageRank[a.stage];
      const sB = stageRank[b.stage];
      if (sA !== sB) return sA - sB;

      // 4) Stage value: numeric, then alpha
      const vA = parseStageValue(a.stage_value);
      const vB = parseStageValue(b.stage_value);

      if (vA.kind !== vB.kind) return vA.kind - vB.kind;
      if (vA.kind === 0 && vA.num !== vB.num) return vA.num - vB.num;
      if (vA.alpha < vB.alpha) return -1;
      if (vA.alpha > vB.alpha) return 1;

      // Stable-ish fallback
      return a.name.localeCompare(b.name);
    });
}, [fullEvent.races, fullEvent.ageGroups, ageGroupFilter, stageFilter, modeFilter]);

  const sortedAgeGroups = useMemo(() => {
    return [...fullEvent.ageGroups].sort((a, b) => {
      // 1) name
      const nameCmp = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      if (nameCmp !== 0) return nameCmp;

      // 2) gender (Men/Ladies/Mixed order)
      const rank = (g: typeof a.gender) => (g === "ladies" ? 0 : g === "men" ? 1 : 2);
      return rank(a.gender) - rank(b.gender);
    });
  }, [fullEvent.ageGroups]);


  return (
    <Box>
      <Card variant="outlined">
        <CardHeader
          title={`Active Event: ${activeEvent?.name ?? activeEventId}`}
          subheader={
            <Typography variant="caption" color={error ? "error" : "text.secondary"}>
              Realtime: {status}
              {error ? ` (${error})` : ""}
            </Typography>
          }
        />
        <Divider />
        <CardContent>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
            <Typography variant="h6">Races</Typography>

            <Tooltip title="New race" arrow>
              <span>
                <IconButton size="small" onClick={openNewRace} aria-label="New race">
                  <AddIcon />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>

          {/* Filters */}
          <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ mb: 2 }}>
            <FormControl size="small" sx={{ minWidth: 220 }}>
              <InputLabel>Age Group</InputLabel>
              <Select
                size="small"
                label="Age Group"
                value={ageGroupFilter}
                onChange={(e) => setAgeGroupFilter(e.target.value)}
              >
                <MenuItem value="all">All</MenuItem>
                {sortedAgeGroups.map((ag) => (
                  <MenuItem key={ag.id} value={ag.id}>
                    {ag.name} ({ag.gender})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: 200 }}>
              <InputLabel>Stage</InputLabel>
              <Select
                size="small"
                label="Stage"
                value={stageFilter}
                onChange={(e) => setStageFilter(e.target.value as any)}
              >
                <MenuItem value="all">All</MenuItem>
                <MenuItem value="">(none)</MenuItem>
                <MenuItem value="heat">heat</MenuItem>
                <MenuItem value="qualifying">qualifying</MenuItem>
                <MenuItem value="final">final</MenuItem>
              </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: 220 }}>
              <InputLabel>Race Mode</InputLabel>
              <Select
                size="small"
                label="Race Mode"
                value={modeFilter}
                onChange={(e) => setModeFilter(e.target.value as any)}
              >
                <MenuItem value="all">All</MenuItem>
                <MenuItem value="standard">Standard</MenuItem>
                <MenuItem value="points">Points</MenuItem>
                <MenuItem value="elimination">Elimination</MenuItem>
              </Select>
            </FormControl>

            <Box sx={{ flex: 1 }} />

            <Chip
              label={`${filteredRaces.length} race(s)`}
              variant="outlined"
              sx={{ alignSelf: { xs: "flex-start", md: "center" } }}
            />
          </Stack>

          {/* Table */}
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Race Mode</TableCell>
                <TableCell>Stage</TableCell>
                <TableCell>Age Group</TableCell>
                <TableCell align="right">Athletes</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>

            <TableBody>
              {filteredRaces.map((r) => {
                const ag = fullEvent.ageGroups.find((x) => x.id === r.ageGroupId) ?? null;

                //const results = getRaceResults(r);
                const athletesCount = r.raceStarters ? r.raceStarters.length : 0;

                return (
                  <TableRow key={r.id}>
                    <TableCell>{r.name}</TableCell>
                    <TableCell>{formatRaceMode(r)}</TableCell>
                    <TableCell>
                      {r.stage} {r.stage_value ? `(${r.stage_value})` : ""}
                    </TableCell>
                    <TableCell>{ag ? `${ag.name} (${ag.gender})` : r.ageGroupId}</TableCell>
                    <TableCell align="right">{athletesCount}</TableCell>

                    <TableCell align="right">
                      <Tooltip title="Next race (copy + stage value +1)" arrow>
                        <span>
                          <IconButton size="small" onClick={() => openNextRaceFrom(r)} aria-label="Next race">
                            <AddIcon />
                          </IconButton>
                        </span>
                      </Tooltip>

                      <Tooltip title="Edit" arrow>
                        <span>
                          <IconButton size="small" onClick={() => openEditRace(r.id)} aria-label="Edit race">
                            <EditIcon />
                          </IconButton>
                        </span>
                      </Tooltip>

                      <Tooltip title="Starters" arrow>
                        <span>
                          <IconButton
                            size="small"
                            onClick={() => navigate(`/races/${r.id}/starters`)}
                            aria-label="Race starters"
                          >
                            <GroupsIcon />
                          </IconButton>
                        </span>
                      </Tooltip>
                      
                      <Tooltip title="Scoring" arrow>
                        <span>
                          <IconButton
                            size="small"
                            //color="primary"
                            onClick={() => navigate(`/races/${r.id}/scoring`)}
                            aria-label="Race scoring"
                          >
                            <EmojiEventsIcon />
                          </IconButton>
                        </span>
                      </Tooltip>
                      
                      <Tooltip title="Delete" arrow>
                        <span>
                          <IconButton size="small" color="error" onClick={() => deleteRace(r.id)} aria-label="Delete race">
                            <DeleteIcon />
                          </IconButton>
                        </span>
                      </Tooltip>

                    </TableCell>
                  </TableRow>
                );
              })}

              {filteredRaces.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6}>
                    <Typography color="text.secondary">No races match the current filters.</Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          <RaceEditor
            open={raceEditorOpen}
            mode={raceEditorMode}
            eventId={activeEventId}
            ageGroups={fullEvent.ageGroups}
            initialRace={editorInitialRace}
            onSave={saveRace}
            onCancel={closeRaceEditor}
          />
        </CardContent>
      </Card>
    </Box>
  );
}