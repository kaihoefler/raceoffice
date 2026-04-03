// src/pages/ScoringPage.tsx
//
// ScoringPage
// ----------
// Zweck:
// - Zentrale Scoring-Ansicht für ein Rennen (raceId aus der Route)
// - Lädt das aktive Event-Dokument aus dem Realtime-Store (Partial<FullEvent>)
// - Normalisiert das Dokument defensiv (fehlende Arrays/Strukturen)
// - Bietet UI für:
//   - Punktewertung (PointsScoring)
//   - Zieleinlauf-Erfassung (FinishLineScoring)
//   - Race Activities (RaceActivitiesList)
//   - Standings (Scoreboard)
//   - Live-Status (LiveRaceStatus)
//
// Wichtige Datenidee:
// raceResults wird hier als "materialisierte Sicht" verstanden:
// - manuelle Felder: z.B. finishRank/finishTime (aus FinishLineScoring)
// - abgeleitete Felder: z.B. points/eliminations (aus raceActivities)
// Nach Änderungen an Activities oder Results wird immer recomputeRaceResults(...) aufgerufen,
// um Punkte/Status/Rank konsistent zu halten.

import { useMemo } from "react";

import { useNavigate, useParams } from "react-router-dom";

import {
    Box,
    Button,
    Card,
    CardContent,
    CardHeader,
    Chip,
    Divider,
    IconButton,
    Tooltip,
    Typography,
} from "@mui/material";

import HomeIcon from "@mui/icons-material/Home";
import GroupsIcon from "@mui/icons-material/Groups";
import FileDownloadIcon from "@mui/icons-material/FileDownload";
import HistoryIcon from "@mui/icons-material/History";


import { useEventList } from "../providers/EventListProvider";
import { useEventsActions } from "../hooks/useEventsActions";

import {
    buildRaceResultsCsv,
    buildRaceResultsPointsOnlyLegacy,
} from "../domain/raceResultsCsvExport";


import RaceSelector from "../components/RaceSelector";

import RaceActivitiesList from "../components/RaceActivitiesList";

import Scoreboard from "../components/Scoreboard";

import type { Athlete, Race, RaceActivity, RaceResult } from "@raceoffice/domain";


import ScoringLiveColumns from "./scoring/ScoringLiveColumns";


export default function ScoringPage() {
    // -------------------------------------------------------------------------
    // Routing + data providers
    // -------------------------------------------------------------------------
    const navigate = useNavigate();
    const { raceId } = useParams<{ raceId: string }>();
    const { eventList } = useEventList();

    const activeEventId = eventList?.activeEventId ?? null;

    const {
        fullEvent: eventDoc,
        status,
        error,
        toggleActiveRace: toggleActiveRaceAction,
        setActiveRace: setActiveRaceAction,
        removeRaceStarter,

        insertRaceStarters,

        saveRaceWithStarters,



        // Scoring-specific actions (centralized in useEventsActions)
        addRaceActivity,
        addRaceActivities,
        updateRaceActivity,
        replaceRaceActivities,
        setRaceResultsManual,
        recalculateRaceResults,
    } = useEventsActions(activeEventId);




    // -------------------------------------------------------------------------
    // Derived data from realtime doc
    // -------------------------------------------------------------------------
    const fullEvent = useMemo(() => {
        if (!activeEventId) return null;
        return eventDoc;
    }, [eventDoc, activeEventId]);


    const race: Race | null = useMemo(() => {
        if (!fullEvent || !raceId) return null;
        return fullEvent.races.find((r) => r.id === raceId) ?? null;
    }, [fullEvent, raceId]);

    // Resolve the race's age group (for display only).
    const raceAgeGroup = useMemo(() => {
        if (!fullEvent || !race) return null;
        return fullEvent.ageGroups.find((ag) => ag.id === race.ageGroupId) ?? null;
    }, [fullEvent, race]);


    // -------------------------------------------------------------------------
    // Local UI state
    // -------------------------------------------------------------------------




    // -------------------------------------------------------------------------
    // Handlers: navigation
    // -------------------------------------------------------------------------
    /**
     * Navigation: Wechsel des Rennens über RaceSelector.
     */
    function handleRaceSelect(nextRaceId: string) {
        if (!nextRaceId || nextRaceId === raceId) return;
        navigate(`/races/${nextRaceId}/scoring`);
    }

    /**
     * Markiert das aktuelle Race als aktiv (fullEvent.activeRaceId = race.id) oder deaktiviert es (-> null).
     *
     * Hinweis:
     * - Aktivieren setzt activeRaceId immer auf dieses Race (überschreibt ggf. ein anderes aktives Race)
     * - Deaktivieren setzt activeRaceId nur dann auf null, wenn dieses Race aktuell aktiv ist
     */
    function toggleActiveRace() {
        if (!race) return;
        toggleActiveRaceAction(race.id);
    }


    // -------------------------------------------------------------------------
    // Handlers: race activities (points sprint / elimination / etc.)
    // -------------------------------------------------------------------------
    /**
     * Update einer existierenden RaceActivity.
     *
     * Wichtig:
     * - Diese App ist non-optimistic: wir patchen das Realtime-Dokument und berechnen davor den Folgezustand.
     * - Nach jeder Activity-Änderung werden raceResults neu materialisiert:
     *   applyActivitiesToRaceResults(...) -> recomputeRaceResults(...)
     */
    function handleUpdateActivity(updated: RaceActivity) {
        if (!race) return;
        updateRaceActivity(race.id, updated);
    }


    /**
     * Ersetzt die komplette Activities-Liste eines Rennens.
     * Danach müssen derived fields + rank neu berechnet werden.
     */
    function handleReplaceActivities(nextActivities: RaceActivity[]) {
        if (!race) return;
        replaceRaceActivities(race.id, nextActivities);
    }


    function handleAddRaceActivity(activity: RaceActivity) {
        if (!race) return;
        addRaceActivity(race.id, activity);
    }

    function handleAddRaceActivities(activities: RaceActivity[]) {
        if (!race) return;
        addRaceActivities(race.id, activities);
    }



    // -------------------------------------------------------------------------
    // Handlers: starters
    // -------------------------------------------------------------------------
    function handleDeleteStarter(starter: Athlete) {

        if (!race) return;

        const bibLabel = starter.bib != null ? ` ${starter.bib}` : "";
        const ok = window.confirm(`Starter${bibLabel} löschen?`);
        if (!ok) return;

        removeRaceStarter(race.id, starter.id);

    }

    // -------------------------------------------------------------------------

    // Handlers: race results (manual finish entry)
    // -------------------------------------------------------------------------
    // FinishLineScoring edits manual finish fields in raceResults (finishRank/finishTime).
    // We must merge these manual edits with derived fields from activities and finally recompute rank.
    /**
     * Übernimmt manuell editierte RaceResults (z.B. FinishLineScoring) ins Event-Dokument.
     *
     * Wichtig:
     * - Manuelle Felder (finishRank/finishTime/...) kommen aus dem UI.
     * - Abgeleitete Felder (points/eliminated/...) werden aus Activities neu berechnet.
     * - Danach wird rank neu berechnet.
     */
    function handleChangeRaceResults(nextResults: RaceResult[]) {

        if (!race) return;
        setRaceResultsManual(race.id, nextResults);
    }

    function downloadTextFile(filename: string, contents: string, mimeType = "text/plain;charset=utf-8") {
        const blob = new Blob([contents], { type: mimeType });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();

        URL.revokeObjectURL(url);
    }

    function handleExportRaceResultsCsv() {
        if (!race) return;

        const csv = buildRaceResultsCsv(race.raceResults ?? []);
        const filename = `${race.slug}_result.csv`;

        downloadTextFile(filename, csv, "text/csv;charset=utf-8");
    }

        function handleExportRaceResultsLegacyPointsOnly() {
        if (!race) return;

        const legacy = buildRaceResultsPointsOnlyLegacy(race.raceResults ?? []);
        const filename = `${race.slug}_result_points_only.txt`;

        downloadTextFile(filename, legacy, "text/plain;charset=utf-8");
    }

    function handleRecalculateResults() {
        if (!race) return;
        recalculateRaceResults(race.id);
    }








    // -------------------------------------------------------------------------
    // Render guards
    // -------------------------------------------------------------------------
    if (!raceId) return <Typography variant="h6">Missing raceId.</Typography>;
    if (!eventList) return <Typography variant="h6">Loading…</Typography>;
    if (!activeEventId) return <Typography variant="h6">No active event selected.</Typography>;
    if (!fullEvent) return <Typography variant="h6">Loading event…</Typography>;

    if (!race) {
        return (
            <Card variant="outlined">
                <CardHeader
                    title="Scoring"
                    action={
                        <Tooltip title="Back to Active Event" arrow>
                            <span>
                                <IconButton onClick={() => navigate("/")} aria-label="Back to Active Event">
                                    <HomeIcon />
                                </IconButton>
                            </span>
                        </Tooltip>
                    }
                    subheader={
                        <Typography variant="caption" color={error ? "error" : "text.secondary"}>
                            Realtime: {status}
                            {error ? ` (${error})` : ""}
                        </Typography>
                    }
                />
                <Divider />
                <CardContent>
                    <Typography color="text.secondary">Race not found (raceId: {raceId})</Typography>
                </CardContent>
            </Card>
        );
    }

    const ageGroupLabel = raceAgeGroup ? `${raceAgeGroup.name} (${raceAgeGroup.gender})` : race.ageGroupId;
    const isActiveRace = fullEvent.activeRaceId === race.id;

    return (
        <Box sx={{ width: "100%", maxWidth: "none" }}>
            <Card variant="outlined" sx={{ width: "100%" }}>
                <CardHeader
                    title={
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0, flexWrap: "wrap" }}>
                            <Typography variant="h6" component="span" sx={{ minWidth: 0 }}>
                                {`Scoring • ${race.name}`}
                            </Typography>

                            {/* Active status direkt hinter dem Race-Namen */}
                            {isActiveRace ? (
                                <Chip size="small" label="Active" color="success" variant="outlined" />
                            ) : null}

                            {/* Activate / Deactivate direkt hinter dem Race-Namen */}
                            <Button
                                size="small"
                                variant="outlined"
                                // Deactivate soll grau erscheinen (Chip zeigt den grünen Active-Status)
                                color={isActiveRace ? "inherit" : "primary"}
                                onClick={toggleActiveRace}
                                aria-label={isActiveRace ? "Deactivate race" : "Activate race"}
                                sx={
                                    isActiveRace
                                        ? {
                                            color: "text.secondary",
                                            borderColor: "divider",
                                            "&:hover": {
                                                borderColor: "text.secondary",
                                                backgroundColor: "action.hover",
                                            },
                                        }
                                        : undefined
                                }
                            >
                                {isActiveRace ? "Deactivate" : "Activate"}
                            </Button>
                        </Box>
                    }
                    action={
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", justifyContent: "flex-end" }}>
                            <RaceSelector
                                races={fullEvent.races}
                                ageGroups={fullEvent.ageGroups}
                                value={race.id}
                                onChange={handleRaceSelect}
                                size="small"
                                activeRaceId={fullEvent.activeRaceId}
                            />

                                                        <Tooltip title="Export results as CSV" arrow>
                                <span>
                                    <IconButton
                                        size="small"
                                        onClick={handleExportRaceResultsCsv}
                                        disabled={!race.raceResults?.length}
                                        aria-label="Export results as CSV"
                                    >
                                        <FileDownloadIcon />
                                    </IconButton>
                                </span>
                            </Tooltip>

                            <Tooltip title="Legacy export (points only)" arrow>
                                <span>
                                    <IconButton
                                        size="small"
                                        onClick={handleExportRaceResultsLegacyPointsOnly}
                                        disabled={!race.raceResults?.length}
                                        aria-label="Legacy export (points only)"
                                    >
                                        <HistoryIcon />
                                    </IconButton>
                                </span>
                            </Tooltip>

                            <Tooltip title="Race starters" arrow>


                                <span>
                                    <IconButton
                                        onClick={() => navigate(`/races/${race.id}/starters`)}
                                        aria-label="Race starters"
                                    >
                                        <GroupsIcon />
                                    </IconButton>
                                </span>
                            </Tooltip>

                            <Tooltip title="Back to Active Event" arrow>
                                <span>
                                    <IconButton onClick={() => navigate("/")} aria-label="Back to Active Event">
                                        <HomeIcon />
                                    </IconButton>
                                </span>
                            </Tooltip>

                        </Box>
                    }
                    subheader={
                        <Typography variant="caption" color={error ? "error" : "text.secondary"}>
                            AgeGroup: {ageGroupLabel} • Realtime: {status}
                            {error ? ` (${error})` : ""}
                        </Typography>
                    }
                />
                <Divider />

                <CardContent>
                    {/* 4-spaltiges Layout für die späteren Bereiche */}
                    <Box
                        sx={{
                            display: "grid",
                            gap: 1,
                            gridTemplateColumns: {
                                xs: "1fr",
                                md: "minmax(240px, 1fr) minmax(260px, .8fr) minmax(180px, .7fr) minmax(380px, 1.4fr)",
                            },
                            alignItems: "start",
                        }}
                    >
                        <ScoringLiveColumns
                            race={race}
                            activeEventId={activeEventId}
                            ageGroups={fullEvent.ageGroups}
                            onInsertRaceStarters={(incoming) => insertRaceStarters(race.id, incoming)}
                            onDeleteStarter={handleDeleteStarter}
                            onAddRaceActivity={handleAddRaceActivity}
                            onAddRaceActivities={handleAddRaceActivities}
                            onChangeRaceResults={handleChangeRaceResults}
                            onCreateRaceFromLive={(draft, starters) => {
                                saveRaceWithStarters(draft, starters);
                                setActiveRaceAction(draft.id);
                                navigate(`/races/${draft.id}/scoring`);
                            }}
                        />

                        {/* Spalte 2: Race activities */}
                        <Box sx={{ order: { xs: 2, md: 2 }, gridColumn: { md: 2 }, minWidth: 0 }}>
                            <RaceActivitiesList race={race} onUpdateActivity={handleUpdateActivity} onReplaceActivities={handleReplaceActivities} />
                        </Box>

                        {/* Spalte 3: Standings */}
                        <Box sx={{ order: { xs: 3, md: 3 }, gridColumn: { md: 3 }, minWidth: 0 }}>
                            <Scoreboard
                                results={race.raceResults}
                                title="Standings"
                                onRecalculateResults={handleRecalculateResults}
                            />
                        </Box>
                  </Box>
                </CardContent>
            </Card>
        </Box>
    );
}
