// src/pages/ScoringPage.tsx
import { useMemo, useState } from "react";

import { useNavigate, useParams } from "react-router-dom";

import { Box, Card, CardContent, CardHeader, Divider, IconButton, Tooltip, Typography } from "@mui/material";

import HomeIcon from "@mui/icons-material/Home";

import { useEventList } from "../providers/EventListProvider";
import { useRealtimeDoc } from "../realtime/useRealtimeDoc";
import { useRaceStatus } from "../providers/RaceStatusProvider";
import { useScoringViewModel } from "./scoring/ScoringViewModel";
import RaceSelector from "../components/RaceSelector";
import PointsScoring from "../components/PointsScoring";
import LiveRaceStatus from "../components/LiveRaceStatus";
import RaceActivitiesList from "../components/RaceActivitiesList";
import Scoreboard from "../components/Scoreboard";


import type { FullEvent } from "../types/event";
import type { Race } from "../types/race";
import type { RaceActivityPointsSprint } from "../types/raceactivities";
import type { RaceActivity } from "../types/raceactivities";
import type { Athlete } from "../types/athlete";



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


export default function ScoringPage() {
    const navigate = useNavigate();
    const { raceId } = useParams<{ raceId: string }>();
    const { eventList } = useEventList();

    const activeEventId = eventList?.activeEventId ?? null;
    const docId = activeEventId ? `Event-${activeEventId}` : null;
    const { data: raw, update, status, error } = useRealtimeDoc<Partial<FullEvent>>(docId);


    const fullEvent = useMemo(() => {
        if (!activeEventId) return null;
        return normalizeFullEvent(raw, activeEventId);
    }, [raw, activeEventId]);

    const race: Race | null = useMemo(() => {
        if (!fullEvent || !raceId) return null;
        return fullEvent.races.find((r) => r.id === raceId) ?? null;
    }, [fullEvent, raceId]);

    const raceAgeGroup = useMemo(() => {
        if (!fullEvent || !race) return null;
        return fullEvent.ageGroups.find((ag) => ag.id === race.ageGroupId) ?? null;
    }, [fullEvent, race]);

        const { currentRace } = useRaceStatus();

    const [syncEnabled, setSyncEnabled] = useState(false);

    const vm = useScoringViewModel(race, currentRace, syncEnabled);


    function handleRaceSelect(nextRaceId: string) {
        if (!nextRaceId || nextRaceId === raceId) return;
        navigate(`/races/${nextRaceId}/scoring`);
    }

    function handleUpdateActivity(updated: RaceActivity) {
        if (!race) return;

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
            races[rIdx] = r;
            next.races = races;

            return next;
        });
    }

    function handleAddPointsSprintActivity(activity: RaceActivityPointsSprint) {
        if (!race) return;

        update((prev) => {
            const next: any = structuredClone(prev as any);
            const races = Array.isArray(next?.races) ? next.races : [];
            const idx = races.findIndex((r: any) => r?.id === race.id);
            if (idx < 0) return prev;

            const r = { ...races[idx] };
            const activities = Array.isArray(r.raceActivities) ? r.raceActivities : [];
            r.raceActivities = [...activities, activity];
            races[idx] = r;
            next.races = races;
            return next;
        });
    }

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



    // ---- Render guards ----
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
                                md: "minmax(300px, 0.8fr) minmax(300px, 1.0fr) minmax(280px, 1fr) minmax(380px, 1.4fr)",
                            },
                            alignItems: "start",
                        }}
                    >
                        {/* Spalte 1: Punkte-Erfassung + kompakte Starterliste */}
                                                <PointsScoring
                            race={race}
                            resetKey={race.id}
                            onAddRaceActivity={handleAddPointsSprintActivity}
                            missingInLiveBibs={vm.missingInLiveBibs}
                            syncEnabled={vm.syncEnabled}
                            liveLapCount={vm.liveLapCount}
                                                        liveLapsToGo={vm.liveLapsToGo}
                            liveTopBibs={vm.liveTopBibs}
                        />




                        <Box sx={{ p: 2, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                            <RaceActivitiesList race={race} onUpdateActivity={handleUpdateActivity} />
                        </Box>


                        

                        <Scoreboard standings={vm.standings} title="Standings" />


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