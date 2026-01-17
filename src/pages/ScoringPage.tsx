// src/pages/ScoringPage.tsx
import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { Box, Card, CardContent, CardHeader, Divider, IconButton, Tooltip, Typography } from "@mui/material";

import HomeIcon from "@mui/icons-material/Home";

import { useEventList } from "../providers/EventListProvider";
import { useRealtimeDoc } from "../realtime/useRealtimeDoc";
import RaceSelector from "../components/RaceSelector";
import PointsScoring, { type PointsEntry } from "../components/PointsScoring";
import LiveRaceStatus from "../components/LiveRaceStatus";


import type { FullEvent } from "../types/event";
import type { Race } from "../types/race";

function normalizeFullEvent(raw: unknown, eventId: string): FullEvent {
    const obj = raw && typeof raw === "object" ? (raw as any) : {};

    return {
        id: typeof obj.id === "string" ? obj.id : eventId,
        name: typeof obj.name === "string" ? obj.name : "",
        slug: typeof obj.slug === "string" ? obj.slug : "",
        ageGroups: Array.isArray(obj.ageGroups) ? obj.ageGroups : [],
        races: Array.isArray(obj.races) ? obj.races : [],
        athletes: Array.isArray(obj.athletes) ? obj.athletes : [],
    };
}

export default function ScoringPage() {
    const navigate = useNavigate();
    const { raceId } = useParams<{ raceId: string }>();
    const { eventList } = useEventList();

    const activeEventId = eventList?.activeEventId ?? null;
    const docId = activeEventId ? `Event-${activeEventId}` : null;
    const { data: raw, status, error } = useRealtimeDoc<Partial<FullEvent>>(docId);

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

    function handleRaceSelect(nextRaceId: string) {
        if (!nextRaceId || nextRaceId === raceId) return;
        navigate(`/races/${nextRaceId}/scoring`);
    }

    const startersSorted = useMemo(() => {
        const starters = race?.raceStarters ?? [];
        return [...starters].sort((a, b) => {
            const ai = a.bib ?? Number.MAX_SAFE_INTEGER;
            const bi = b.bib ?? Number.MAX_SAFE_INTEGER;
            if (ai !== bi) return ai - bi;
            return (a.lastName ?? "").localeCompare(b.lastName ?? "", undefined, { sensitivity: "base" });
        });
    }, [race?.raceStarters]);

    function handleSavePoints(entry: PointsEntry) {
        // TODO: persistence logic comes next (you said you'll define it)
        console.log("save points", { raceId: race?.id, ...entry });
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
                            gap: 2,
                            gridTemplateColumns: {
                                xs: "1fr",
                                md: "repeat(4, 1fr)",
                            },
                            alignItems: "start",
                        }}
                    >
                        {/* Spalte 1: Punkte-Erfassung + kompakte Starterliste */}
                        <PointsScoring starters={startersSorted} resetKey={race.id} onSave={handleSavePoints} />

                        <Box sx={{ p: 2, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                            <Typography variant="subtitle2">Bereich 2</Typography>
                        </Box>


                        <Box sx={{ p: 2, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                            <Typography variant="subtitle2">Bereich 3</Typography>
                        </Box>

                                                {/* Spalte 4: Live race status (polled via RaceStatusProvider) */}
                        <LiveRaceStatus />

                    </Box>
                </CardContent>
            </Card>
        </Box>
    );
}