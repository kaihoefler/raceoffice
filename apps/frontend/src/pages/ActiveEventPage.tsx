// src/pages/ActiveEventPage.tsx
//
// Zentrale “Admin/Operator”-Übersicht für das aktuell aktive Event.
// Zeigt alle Races des Events und bietet:
// - Race anlegen / bearbeiten / löschen
// - “Active Race” markieren (fullEvent.activeRaceId)
// - Filter & Sortierung (AgeGroup / Stage / RaceMode)
// - Navigation zu Starters- und Scoring-Seiten eines Race
//
// Daten-/Persistenz-Design:
// - Event-Dokument wird live über useEventsActions() bezogen (Hook kapselt Realtime + Mutations).
// - Eingehende Realtime-Daten werden defensiv normalisiert (normalizeFullEvent im domain/eventActions),
//   damit UI/Sortierung nicht an undef/null/invalid Arrays kaputtgehen.
// - Schreiblogik (upsert/delete/setActiveRace, slug/stage_value Regeln) ist zentral im Domain-Modul,
//   um Redundanz zwischen Seiten/Komponenten zu vermeiden.

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  Box,
  Button,
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

import { useEventList } from "../providers/EventListProvider";

import type { Race } from "@raceoffice/domain";


import RaceEditor, { type RaceDraft } from "../components/RaceEditor";
import { useEventsActions } from "../hooks/useEventsActions";

/**
 * Anzeige-Text für den RaceMode.
 * - Standard: keine Flags
 * - Points: isPointsRace
 * - Elimination: isEliminationRace
 * - Points + Elimination: beide Flags gesetzt
 */
function formatRaceMode(r: Race): string {
  const isPoints = !!r.racemode?.isPointsRace;
  const isElim = !!r.racemode?.isEliminationRace;

  if (isPoints && isElim) return "Points + Elimination";
  if (isPoints) return "Points";
  if (isElim) return "Elimination";
  return "Standard";
}

export default function ActiveEventPage() {
    // Event-Liste/Meta kommt aus einem Provider (z.B. Auswahl “active event” irgendwo anders).
  const { eventList } = useEventList();
  const activeEventId = eventList?.activeEventId ?? null;

    // Zentraler Zugriff auf Event-Realtime-Dokument + Actions (kein duplizierter Merge/Update Code in der Page)
  const {
    fullEvent,
    status,
    error,
    saveRace: saveRaceAction,
    deleteRace: deleteRaceAction,
    setActiveRace: setActiveRaceAction,
    makeNextRaceTemplate,
  } = useEventsActions(activeEventId);

  // IMPORTANT: Hooks must not be called conditionally.
  // So we call navigation + local state hooks before doing any early returns.
  const navigate = useNavigate();

  // Aktives Event (Meta) aus der Liste (safe even while eventList is still loading)
  const activeEvent = useMemo(() => {
    const id = activeEventId ?? "";
    return eventList?.events.find((e) => e.id === id) ?? null;
  }, [eventList, activeEventId]);


  // -----------------------
  // RaceEditor state
  // -----------------------
  // Steuert den Dialog/Drawer RaceEditor:
  // - open/closed
  // - mode: “new” oder “edit”
  // - initialRace: Vorlage für Edit oder Copy-Flow
  const [raceEditorOpen, setRaceEditorOpen] = useState(false);
  const [raceEditorMode, setRaceEditorMode] = useState<"new" | "edit">("new");
  const [editorInitialRace, setEditorInitialRace] = useState<Race | null>(null);

  /** Öffnet Editor für neues Race (leere initialRace). */
  function openNewRace() {
    setRaceEditorMode("new");
    setEditorInitialRace(null);
    setRaceEditorOpen(true);
  }

  /** Öffnet Editor zum Bearbeiten eines existierenden Race. */
  function openEditRace(raceId: string) {
    const r = fullEvent.races.find((x) => x.id === raceId) ?? null;
    setRaceEditorMode("edit");
    setEditorInitialRace(r);
    setRaceEditorOpen(true);
  }

  /**
   * “Next race” Flow:
   * - Kopiert ein bestehendes Race als Template
   * - stage_value wird inkrementiert
   * - Ergebnisse/Aktivitäten werden geleert (neues Race)
   * - Name/Slug werden geleert (damit User bewusst vergibt)
   */
      
  function openNextRaceFrom(r: Race) {
    // Domain helper: creates a “next race” template (clears results/activities, increments stage_value).
    const template = makeNextRaceTemplate(r);

    setRaceEditorMode("new");

    setEditorInitialRace(template);
    setRaceEditorOpen(true);
  
  }

  /** Schließt Editor und resetet Editor-State. */

  function closeRaceEditor() {
    setRaceEditorOpen(false);
    setEditorInitialRace(null);
    setRaceEditorMode("new");
  }

  /**
   * Speichert (create oder update) ein Race in das Event-Dokument.
   *
   * Wichtige Logik:
   * - Wenn Race bereits existiert: raceResults/raceStarters/raceActivities behalten!
   *   (sonst würden wir beim Edit versehentlich Ergebnisse löschen)
   * - slug wird aus name generiert
   * - stage_value wird ggf. normalisiert
   */
        
  function saveRace(draft: RaceDraft) {

    saveRaceAction(draft);
    closeRaceEditor();
  }




  

  /**
   * Löscht ein Race nach Confirm-Dialog.

   * Zusätzliche Regel:
   * - Wenn das gelöschte Race aktiv war, setzen wir activeRaceId auf null.
   */
        
  function deleteRace(raceId: string) {

    const r = fullEvent.races.find((x) => x.id === raceId);
    const ok = window.confirm(`Delete race "${r?.name ?? raceId}"?`);

    if (!ok) return;

    deleteRaceAction(raceId);
  }



  

  /**
   * Markiert ein Race als "aktiv" innerhalb des Events.

   * Wird im Table als "Active" hervorgehoben und kann später z.B. als Default-Navigation dienen.
   */
        
    function setActiveRace(raceId: string) {
    setActiveRaceAction(raceId);
  }

  // -----------------------

  // Filters and Sort
  // -----------------------
  // UI-Filter: AgeGroup, Stage, Mode
  const [ageGroupFilter, setAgeGroupFilter] = useState<string>("all");
  const [stageFilter, setStageFilter] = useState<"all" | Race["stage"]>("all");
  const [modeFilter, setModeFilter] = useState<"all" | "points" | "elimination" | "standard">("all");

  /**
   * Gefilterte & sortierte Race-Liste.
   *
   * Sort-Kriterien (in Reihenfolge):
   * 1) AgeGroup (nach Name/Gender)
   * 2) RaceMode (Standard < Points < Elimination < Points+Elimination)
   * 3) Stage ("" < qualifying < heat < final)
   * 4) stage_value (numerisch vor alpha; numerisch aufsteigend)
   * 5) name fallback
   */
  const filteredRaces = useMemo(() => {
    // Reihenfolge für Stage (definiert eine semantische Sortierung)
    const stageRank: Record<Race["stage"], number> = {
      "": 0,
      qualifying: 1,
      heat: 2,
      final: 3,
    };

    // Reihenfolge für RaceMode (ebenfalls semantische Sortierung)
    const modeRank = (r: Race) => {
      const p = !!r.racemode?.isPointsRace;
      const e = !!r.racemode?.isEliminationRace;
      if (!p && !e) return 0; // Standard
      if (p && !e) return 1; // Points
      if (!p && e) return 2; // Elimination
      return 3; // Points + Elimination
    };

    // Erzeugt einen stabilen Sort-Key für AgeGroups anhand der AgeGroup-Daten
    const ageGroupSortKey = (ageGroupId: string) => {
      const ag = fullEvent.ageGroups.find((x) => x.id === ageGroupId);
      if (!ag) return `~${ageGroupId}`; // unknown at end
      return `${ag.name.toLowerCase()}|${ag.gender}`;
    };

    // stage_value kann z.B. "1" oder "A" sein -> wir sortieren numeric vor alpha
    const parseStageValue = (value: string) => {
      const v = value.trim();
      if (!v) return { kind: 2 as const, num: Infinity, alpha: "" };

      if (/^\d+$/.test(v)) return { kind: 0 as const, num: Number(v), alpha: "" };

      if (/^[A-Za-z]+$/.test(v)) return { kind: 1 as const, num: Infinity, alpha: v.toUpperCase() };

      // “sonstige” Werte ans Ende
      return { kind: 2 as const, num: Infinity, alpha: v };
    };

    return (fullEvent.races ?? [])
      .filter((r) => {
        // Filter: AgeGroup
        if (ageGroupFilter !== "all" && r.ageGroupId !== ageGroupFilter) return false;

        // Filter: Stage
        if (stageFilter !== "all" && r.stage !== stageFilter) return false;

        // Filter: Mode
        if (modeFilter !== "all") {
          const isPoints = !!r.racemode?.isPointsRace;
          const isElim = !!r.racemode?.isEliminationRace;

          if (modeFilter === "points" && !isPoints) return false;
          if (modeFilter === "elimination" && !isElim) return false;
          if (modeFilter === "standard" && (isPoints || isElim)) return false;
        }

        return true;
      })
      .slice() // defensive copy, um nicht fullEvent.races zu mutieren
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

        // 3) Stage
        const sA = stageRank[a.stage];
        const sB = stageRank[b.stage];
        if (sA !== sB) return sA - sB;

        // 4) Stage value (numeric vor alpha, dann alphabetisch)
        const vA = parseStageValue(a.stage_value);
        const vB = parseStageValue(b.stage_value);

        if (vA.kind !== vB.kind) return vA.kind - vB.kind;
        if (vA.kind === 0 && vA.num !== vB.num) return vA.num - vB.num;
        if (vA.alpha < vB.alpha) return -1;
        if (vA.alpha > vB.alpha) return 1

      // Stable-ish fallback
      return a.name.localeCompare(b.name);
    });
}, [fullEvent.races, fullEvent.ageGroups, ageGroupFilter, stageFilter, modeFilter]);
  /**
   * Sortierte AgeGroups für das Filter-Dropdown.
   * Ziel: stabile, “menschliche” Reihenfolge:
   * 1) nach Name (case-insensitive)
   * 2) dann nach Gender in definierter Reihenfolge (ladies < men < mixed)
   *
   * Dadurch ist die Auswahl im UI vorhersehbar und nicht “zufällig” nach DB-Reihenfolge.
   */
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

    /**
   * Render:
   * - Card: Event Header + Live-Status (useRealtimeDoc status/error)
   * - Filterzeile: AgeGroup/Stage/Mode Filter + Count Chip
   * - Tabelle: gefilterte/sortierte Races mit Actions
   * - RaceEditor: Modal/Dialog für New/Edit/Copy
   */

  // Render guards (must come AFTER all hooks above)
  if (!eventList) return <Typography variant="h6">Loading…</Typography>;
  if (!activeEventId) return <Typography variant="h6">No active event selected.</Typography>;

  return (

    <Box>
      <Card variant="outlined">
        {/* Kopfbereich: zeigt Eventnamen und Realtime-Status */}
        <CardHeader
          title={`Active Event: ${activeEvent?.name ?? activeEventId}`}
          subheader={
            <Typography variant="caption" color={error ? "error" : "text.secondary"}>
              {/* status kommt aus useRealtimeDoc, z.B. "connected/syncing/..." */}
              Realtime: {status}
              {error ? ` (${error})` : ""}
            </Typography>
          }
        />
        <Divider />
        <CardContent>
          {/* Titelzeile + Action “New race” */}
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
            <Typography variant="h6">Races</Typography>

            {/* “New race” IconButton (Tooltip + span Wrapper ist MUI-Pattern, falls disabled) */}
            <Tooltip title="New race" arrow>
              <span>
                <IconButton size="small" onClick={openNewRace} aria-label="New race">
                  <AddIcon />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>

          {/* Filters:
              - responsiv: Column auf xs, Row ab md
              - rechts: Chip mit Anzahl Races nach Filter */}
          <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ mb: 2 }}>
            {/* AgeGroup Filter */}
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

            {/* Stage Filter */}
            <FormControl size="small" sx={{ minWidth: 200 }}>
              <InputLabel>Stage</InputLabel>
              <Select size="small" label="Stage" value={stageFilter} onChange={(e) => setStageFilter(e.target.value as any)}>
                <MenuItem value="all">All</MenuItem>
                <MenuItem value="">(none)</MenuItem>
                <MenuItem value="heat">heat</MenuItem>
                <MenuItem value="qualifying">qualifying</MenuItem>
                <MenuItem value="final">final</MenuItem>
              </Select>
            </FormControl>

            {/* RaceMode Filter */}
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

            {/* Spacer: schiebt Count-Chip nach rechts (auf md+) */}
            <Box sx={{ flex: 1 }} />

            {/* Anzeige wie viele Races durch Filter übrig bleiben */}
            <Chip
              label={`${filteredRaces.length} race(s)`}
              variant="outlined"
              sx={{ alignSelf: { xs: "flex-start", md: "center" } }}
            />
          </Stack>

          {/* Tabelle der Races:
              - zeigt Metadaten und Anzahl Starter
              - “Status” Button setzt activeRaceId
              - Actions: Next(copy), Edit, Starters, Scoring, Delete */}
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Race Mode</TableCell>
                <TableCell>Stage</TableCell>
                <TableCell>Age Group</TableCell>
                <TableCell align="right">Athletes</TableCell>

                {/* Status-Spalte: Race als aktiv setzen (analog EventsPage -> Active/Activate) */}
                <TableCell align="center">Status</TableCell>

                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>

            <TableBody>
              {filteredRaces.map((r) => {
                // AgeGroup fürs Anzeigen auflösen
                const ag = fullEvent.ageGroups.find((x) => x.id === r.ageGroupId) ?? null;

                // Starteranzahl (defensiv, falls raceStarters fehlt)
                const athletesCount = r.raceStarters ? r.raceStarters.length : 0;

                // Active-State (Button disabled + grüne Darstellung)
                const isActiveRace = fullEvent.activeRaceId === r.id;

                return (
                  <TableRow key={r.id}>
                    <TableCell>{r.name}</TableCell>
                    <TableCell>{formatRaceMode(r)}</TableCell>

                    {/* Stage + optional stage_value in Klammern */}
                    <TableCell>
                      {r.stage} {r.stage_value ? `(${r.stage_value})` : ""}
                    </TableCell>

                    {/* AgeGroup Label oder Fallback auf ID */}
                    <TableCell>{ag ? `${ag.name} (${ag.gender})` : r.ageGroupId}</TableCell>

                    <TableCell align="right">{athletesCount}</TableCell>

                    {/* Activate / Active:
                        - Klick setzt fullEvent.activeRaceId
                        - Wenn aktiv: Button disabled, aber optisch weiterhin “success” (grün)
                          => MUI macht disabled normalerweise grau, daher SX Override */}
                    <TableCell align="center">
                      <Button
                        size="small"
                        onClick={() => setActiveRace(r.id)}
                        disabled={isActiveRace}
                        variant="outlined"
                        color={isActiveRace ? "success" : "primary"}
                        sx={
                          isActiveRace
                            ? {
                                "&.Mui-disabled": {
                                  color: "success.main",
                                  borderColor: "success.main",
                                  opacity: 1,
                                },
                              }
                            : undefined
                        }
                      >
                        {isActiveRace ? "Active" : "Activate"}
                      </Button>
                    </TableCell>

                    {/* Actions:
                        - Next race: kopiert Race + stage_value+1 (Editor öffnet mit Template)
                        - Edit: öffnet Editor mit existierendem Race
                        - Starters: navigiert zu Starters-Page
                        - Scoring: navigiert zu Scoring-Page
                        - Delete: Confirmation + Entfernen aus Event */}
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
                          <IconButton size="small" onClick={() => navigate(`/races/${r.id}/scoring`)} aria-label="Race scoring">
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

              {/* Empty-State: keine Races nach Filter */}
              {filteredRaces.length === 0 && (
                <TableRow>
                  {/* colSpan muss zu Anzahl Spalten passen (hier 7) */}
                  <TableCell colSpan={7}>
                    <Typography color="text.secondary">No races match the current filters.</Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          {/* RaceEditor:
              - open/mode/initialRace kommen aus lokalem State
              - onSave schreibt ins Realtime-Dokument
              - onCancel schließt ohne Änderungen */}
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