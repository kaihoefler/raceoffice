// src/pages/ScoringPage.tsx
import { useMemo, useState } from "react";

import { useNavigate, useParams } from "react-router-dom";

import {
  Box,
  Card,
  CardContent,
  CardHeader,
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
 * Defensive normalization of the realtime document.
 *
 * The realtime doc is typed as Partial<FullEvent>, so arrays may be missing or malformed.
 * This helper ensures the page can safely iterate/access nested arrays.
 */
function normalizeFullEvent(raw: unknown, eventId: string): FullEvent {
    // NOTE: We intentionally accept unknown input here because realtime docs can be partially initialized.
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

        // ViewModel computes display-only data (standings, missing bibs, live-sync meta) derived from providers.
    // It does NOT persist anything.
    const vm = useScoringViewModel(race, syncEnabled);



    // -------------------------------------------------------------------------
    // Handlers: navigation
    // -------------------------------------------------------------------------
    function handleRaceSelect(nextRaceId: string) {
        if (!nextRaceId || nextRaceId === raceId) return;
        navigate(`/races/${nextRaceId}/scoring`);
    }

    // -------------------------------------------------------------------------
    // Handlers: race activities (points sprint / elimination / etc.)
    // -------------------------------------------------------------------------
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

    return (
        <Box sx={{ width: "100%", maxWidth: "none" }}>
            <Card variant="outlined" sx={{ width: "100%" }}>
                <CardHeader
                    title={`Scoring • ${race.name}`}
                    action={
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                            <RaceSelector
                                races={fullEvent.races}
                                ageGroups={fullEvent.ageGroups}
                                value={race.id}
                                onChange={handleRaceSelect}
                                size="small"
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
