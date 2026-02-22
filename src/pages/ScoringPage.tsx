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

import { useMemo, useState } from "react";

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
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from "@mui/material";

import HomeIcon from "@mui/icons-material/Home";
import GroupsIcon from "@mui/icons-material/Groups";

import { useEventList } from "../providers/EventListProvider";
import { useRealtimeDoc } from "../realtime/useRealtimeDoc";

import { useScoringViewModel } from "./scoring/ScoringViewModel";

// raceResults is treated as a consolidated/materialized view:
// - manual parts come from dedicated UI (e.g. FinishLineScoring writes finishRank/finishTime)
// - derived parts come from the event log (raceActivities), e.g. points/eliminations
//
// Whenever activities or results change, we rebuild the derived fields and recompute rank.
import { applyActivitiesToRaceResults } from "./scoring/applyActivitiesToRaceResults";
import { recomputeRaceResults } from "./scoring/recomputeRaceResults";

import RaceSelector from "../components/RaceSelector";

import PointsScoring from "../components/PointsScoring";
import FinishLineScoring from "../components/FinishLineScoring";
import LiveRaceStatus from "../components/LiveRaceStatus";
import RaceActivitiesList from "../components/RaceActivitiesList";
import Scoreboard from "../components/Scoreboard";

import type { FullEvent } from "../types/event";
import type { Race, RaceResult } from "../types/race";

import type { RaceActivityPointsSprint } from "../types/raceactivities";
import type { RaceActivity } from "../types/raceactivities";
import type { Athlete } from "../types/athlete";


/**
 * Defensive Normalisierung des Realtime-Event-Dokuments.
 *
 * Hintergrund:
 * - useRealtimeDoc wird hier als Partial<FullEvent> gelesen.
 * - Realtime-Dokumente können initial "halb" sein: Arrays fehlen, falscher Typ, etc.
 *
 * Ziel:
 * - ScoringPage kann überall sicher über Arrays iterieren (races, ageGroups, athletes)
 * - auch verschachtelte Arrays in races (raceResults, raceStarters, raceActivities)
 *
 * Hinweis:
 * - wir akzeptieren raw: unknown absichtlich, damit wir bei fehlerhaften Snapshots nicht crashen.
 */
function normalizeFullEvent(raw: unknown, eventId: string): FullEvent {
    const obj = raw && typeof raw === "object" ? (raw as any) : {};

    const races = Array.isArray(obj.races) ? obj.races : [];

    return {
        id: typeof obj.id === "string" ? obj.id : eventId,
        name: typeof obj.name === "string" ? obj.name : "",
        slug: typeof obj.slug === "string" ? obj.slug : "",
        activeRaceId: typeof obj.activeRaceId === "string" ? obj.activeRaceId : null,
        ageGroups: Array.isArray(obj.ageGroups) ? obj.ageGroups : [],
        races: races.map((r: any) => ({
            ...r,
            // Nested arrays defensiv normalisieren
            raceResults: Array.isArray(r?.raceResults) ? r.raceResults : [],
            raceStarters: Array.isArray(r?.raceStarters) ? r.raceStarters : [],
            raceActivities: Array.isArray(r?.raceActivities) ? r.raceActivities : [],
        })),
        athletes: Array.isArray(obj.athletes) ? obj.athletes : [],
    };
}


export default function ScoringPage() {
    // -------------------------------------------------------------------------
    // Routing + data providers
    // -------------------------------------------------------------------------
    const navigate = useNavigate();
    const { raceId } = useParams<{ raceId: string }>();
    const { eventList } = useEventList();

    const activeEventId = eventList?.activeEventId ?? null;
    const docId = activeEventId ? `Event-${activeEventId}` : null;

    // Realtime document for the active event.
    // update(...) will persist modifications back into the realtime doc.
    const { data: raw, update, status, error } = useRealtimeDoc<Partial<FullEvent>>(docId);

    // -------------------------------------------------------------------------
    // Derived data from realtime doc
    // -------------------------------------------------------------------------
    const fullEvent = useMemo(() => {
        if (!activeEventId) return null;
        return normalizeFullEvent(raw, activeEventId);
    }, [raw, activeEventId]);

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
    const [syncEnabled, setSyncEnabled] = useState(false);
    const [col1Tab, setCol1Tab] = useState<"points" | "finish">("points");

    /**
     * ViewModel (rein abgeleitet / read-only):
     * - berechnet Anzeige-Daten für die UI (z.B. missing bibs, live-sync Meta)
     * - persistiert nichts selbst (Persistenz passiert ausschließlich über update(...))
     */
    const vm = useScoringViewModel(race, syncEnabled);



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
        if (!activeEventId || !race) return;

        update((prev) => {
            const current = normalizeFullEvent(prev, activeEventId);
            const exists = current.races.some((r) => r.id === race.id);
            if (!exists) return prev as any;

            const isActive = current.activeRaceId === race.id;
            return { ...current, activeRaceId: isActive ? null : race.id } as Partial<FullEvent>;
        });
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

        // NOTE: This app is non-optimistic (server patch roundtrip). We compute the next state
        // (activities -> derived raceResults -> rank) before sending the update.
        update((prev) => {
            const next: any = structuredClone(prev as any);


            const races = Array.isArray(next?.races) ? next.races : [];
            const rIdx = races.findIndex((r: any) => r?.id === race.id);
            if (rIdx < 0) return prev;

            const r = { ...races[rIdx] };
            const activities = Array.isArray(r.raceActivities) ? r.raceActivities : [];

            const aIdx = activities.findIndex((a: any) => a?.id === updated.id);
            if (aIdx < 0) {
                // falls du lieber append willst: r.raceActivities = [...activities, updated];
                return prev;
            }

            const nextActivities = [...activities];
            nextActivities[aIdx] = updated;

                        r.raceActivities = nextActivities;

            // Keep raceResults consistent whenever activities change:
            // 1) rebuild derived fields (points, eliminated/eliminationLap, ...)
            // 2) recompute rank using the configured priority rules
            r.raceResults = recomputeRaceResults(
                applyActivitiesToRaceResults({
                    prevResults: Array.isArray(r.raceResults) ? r.raceResults : [],
                    starters: Array.isArray(r.raceStarters) ? r.raceStarters : [],
                    activities: Array.isArray(r.raceActivities) ? r.raceActivities : [],
                }),
            );


            races[rIdx] = r;
            next.races = races;


            return next;
        });
    }

        /**
         * Ersetzt die komplette Activities-Liste eines Rennens.
         * Danach müssen derived fields + rank neu berechnet werden.
         */
        function handleReplaceActivities(nextActivities: RaceActivity[]) {
        if (!race) return;

        // Replacing the activities list affects derived results, so we recompute raceResults + rank.
        update((prev) => {
            const next: any = structuredClone(prev as any);


            const races = Array.isArray(next?.races) ? next.races : [];
            const idx = races.findIndex((r: any) => r?.id === race.id);
            if (idx < 0) return prev;

            const r = { ...races[idx] };
                        r.raceActivities = Array.isArray(nextActivities) ? nextActivities : [];

            // Recompute derived RaceResults (points/elimination/...) from activities, then rank.
            r.raceResults = recomputeRaceResults(
                applyActivitiesToRaceResults({
                    prevResults: Array.isArray(r.raceResults) ? r.raceResults : [],
                    starters: Array.isArray(r.raceStarters) ? r.raceStarters : [],
                    activities: Array.isArray(r.raceActivities) ? r.raceActivities : [],
                }),
            );

            races[idx] = r;

            next.races = races;
            return next;

        });
    }

        /**
         * Fügt eine PointsSprint-Activity hinzu.
         * Wir hängen die Activity an und materialisieren anschließend raceResults + rank neu.
         */
        function handleAddPointsSprintActivity(activity: RaceActivityPointsSprint) {
        if (!race) return;

        // Adding a points sprint affects derived points and therefore rank.
        update((prev) => {

            const next: any = structuredClone(prev as any);
            const races = Array.isArray(next?.races) ? next.races : [];
            const idx = races.findIndex((r: any) => r?.id === race.id);
            if (idx < 0) return prev;

            const r = { ...races[idx] };
            const activities = Array.isArray(r.raceActivities) ? r.raceActivities : [];
                        r.raceActivities = [...activities, activity];

            // Recompute derived RaceResults (points/elimination/...) from activities, then rank.
            r.raceResults = recomputeRaceResults(
                applyActivitiesToRaceResults({
                    prevResults: Array.isArray(r.raceResults) ? r.raceResults : [],
                    starters: Array.isArray(r.raceStarters) ? r.raceStarters : [],
                    activities: Array.isArray(r.raceActivities) ? r.raceActivities : [],
                }),
            );

            races[idx] = r;
            next.races = races;
            return next;

        });
    }

    // -------------------------------------------------------------------------
    // Handlers: starters
    // -------------------------------------------------------------------------
    /**
     * Erstellt fehlende Starter anhand der Live-Daten (z.B. wenn Bibs im Live-Feed auftauchen,
     * aber noch nicht in raceStarters existieren).
     */
    function handleCreateMissingStartersFromLive() {
        if (!race) return;

        const missing = vm.getMissingStarterBibsFromLive();
        if (!missing.length) return;

        update((prev) => {
            const next: any = structuredClone(prev as any);
            const races = Array.isArray(next?.races) ? next.races : [];
            const idx = races.findIndex((r: any) => r?.id === race.id);
            if (idx < 0) return prev;

            const r = { ...races[idx] };
            const starters: Athlete[] = Array.isArray(r.raceStarters) ? r.raceStarters : [];

            const existingBibs = new Set<number>();
            for (const s of starters) {
                const bib = Number((s as any)?.bib);
                if (Number.isFinite(bib)) existingBibs.add(bib);
            }

            const toAdd = missing.filter((a) => a.bib != null && !existingBibs.has(a.bib));
            if (!toAdd.length) return prev;

            r.raceStarters = [...starters, ...toAdd];
            races[idx] = r;
            next.races = races;
            return next;
        });
    }

    /**
     * Erstellt Starter für eine Liste von Bibs.
     * - vm.buildStartersForBibs(...) baut Athlete-Objekte
     * - wir deduplizieren gegen existierende raceStarters
     */
    async function handleCreateStartersForBibs(bibs: number[]) {
        if (!race) return;

        const toAdd = vm.buildStartersForBibs(bibs);
        if (!toAdd.length) return;

        update((prev) => {
            const next: any = structuredClone(prev as any);
            const races = Array.isArray(next?.races) ? next.races : [];
            const idx = races.findIndex((r: any) => r?.id === race.id);
            if (idx < 0) return prev;

            const r = { ...races[idx] };
            const starters: Athlete[] = Array.isArray(r.raceStarters) ? r.raceStarters : [];

            // doppelt absichern
            const existingBibs = new Set(starters.map(s => Number((s as any)?.bib)).filter(Number.isFinite));
            const finalAdd = toAdd.filter(a => a.bib != null && !existingBibs.has(a.bib));

            r.raceStarters = [...starters, ...finalAdd];
            races[idx] = r;
            next.races = races;
            return next;
        });
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

        update((prev) => {
            const next: any = structuredClone(prev as any);

            const races = Array.isArray(next?.races) ? next.races : [];
            const idx = races.findIndex((r: any) => r?.id === race.id);
            if (idx < 0) return prev;

            const r = { ...races[idx] };

                        // Merge manual fields (finishRank/finishTime/...) from UI with derived fields from activities.
            // Derived fields always win (so editing a points sprint immediately updates points in raceResults).
            const merged = applyActivitiesToRaceResults({
                prevResults: Array.isArray(nextResults) ? nextResults : [],
                starters: Array.isArray(r.raceStarters) ? r.raceStarters : [],
                activities: Array.isArray(r.raceActivities) ? r.raceActivities : [],
            });

            // Compute rank after we have a fully-consistent RaceResult view.
            r.raceResults = recomputeRaceResults(merged);


            races[idx] = r;
            next.races = races;
            return next;
        });
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
                        {/* Spalte 1: Tabs (Points / Finish) */}
                        <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, minHeight: 0 }}>
                            <Tabs
                                value={col1Tab}
                                onChange={(_, v) => setCol1Tab(v)}
                                variant="fullWidth"
                                sx={{ borderBottom: "1px solid", borderColor: "divider" }}
                            >
                                <Tab value="points" label="Points" />
                                <Tab value="finish" label="Finish" />
                            </Tabs>

                            <Box sx={{ p: 1 }}>
                                {col1Tab === "points" ? (
                                    <PointsScoring
                                        race={race}
                                        resetKey={race.id}
                                        onAddRaceActivity={handleAddPointsSprintActivity}
                                        onCreateStarters={handleCreateStartersForBibs}
                                        missingInLiveBibs={vm.missingInLiveBibs}
                                        syncEnabled={vm.syncEnabled}
                                        liveLapCount={vm.liveLapCount}
                                        liveLapsToGo={vm.liveLapsToGo}
                                        liveTopBibs={vm.liveTopBibs}
                                    />
                                                                ) : (
                                                                        <FinishLineScoring
                                        race={race}
                                        resetKey={race.id}
                                        onChangeRaceResults={handleChangeRaceResults}
                                        onCreateStarters={handleCreateStartersForBibs}
                                    />

                                )}
                            </Box>
                        </Box>
                        {/* Spalte 2: Race activities */}
                        <RaceActivitiesList race={race} onUpdateActivity={handleUpdateActivity} onReplaceActivities={handleReplaceActivities} />

                        {/* Spalte 3: Standings */}
                        <Scoreboard results={race.raceResults} title="Standings" />


                        {/* Spalte 4: Live race status (polled via RaceStatusProvider) */}
                        <LiveRaceStatus
                            unknownLiveBibs={vm.unknownLiveBibs}
                            onCreateStarters={handleCreateMissingStartersFromLive}
                            syncEnabled={syncEnabled}
                            onSyncEnabledChange={setSyncEnabled}
                        />



                    </Box>
                </CardContent>
            </Card>
        </Box>
    );
}
