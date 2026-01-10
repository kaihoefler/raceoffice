// src/pages/RaceStartersPage.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import {
    Box,
    Card,
    CardContent,
    CardHeader,
    Divider,
    IconButton,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    TextField,
    Tooltip,
    Typography,
} from "@mui/material";

import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import SaveIcon from "@mui/icons-material/Save";
import CloseIcon from "@mui/icons-material/Close";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";

import { useNavigate, useParams } from "react-router-dom";

import { useEventList } from "../providers/EventListProvider";
import { useRealtimeDoc } from "../realtime/useRealtimeDoc";
import RaceStartersImport from "../components/RaceStartersImport";

import type { FullEvent } from "../types/event";
import type { Race } from "../types/race";
import type { Athlete } from "../types/athlete";

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

function normalizeIoc(input: string): string | null {
    const v = input.trim().toUpperCase();
    if (!v) return null;
    if (!/^[A-Z]{3}$/.test(v)) return v;
    return v;
}

function parseBib(input: string): number | null {
    const v = input.trim();
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

export default function RaceStartersPage() {
    // ---- Hooks (must run unconditionally) ----
    const navigate = useNavigate();
    const { raceId } = useParams<{ raceId: string }>();
    const { eventList } = useEventList();
    const newBibRef = useRef<HTMLInputElement>(null);

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

    const starters: Athlete[] = race?.raceStarters ?? [];
    const startersCount = starters.length;

    // Focus bib when race is available (initial page load)
    useEffect(() => {
        if (!race) return;
        setTimeout(() => newBibRef.current?.focus(), 0);
    }, [race?.id]);

    // Inline edit state
    const [editingAthleteId, setEditingAthleteId] = useState<string | null>(null);
    const [editingDraft, setEditingDraft] = useState<{
        bib: string;
        firstName: string;
        lastName: string;
        nation: string;
    } | null>(null);

    const [newDraft, setNewDraft] = useState({
        bib: "",
        firstName: "",
        lastName: "",
        nation: "",
    });

    function updateRaceStarters(nextStarters: Athlete[]) {
        if (!activeEventId || !raceId) return;

        update((prev) => {
            const current = normalizeFullEvent(prev, activeEventId);

            const nextRaces = current.races.map((r) => {
                if (r.id !== raceId) return r;
                return { ...r, raceStarters: nextStarters };
            });

            return { ...current, races: nextRaces } as Partial<FullEvent>;
        });
    }

    function startEdit(a: Athlete) {
        setEditingAthleteId(a.id);
        setEditingDraft({
            bib: a.bib === null ? "" : String(a.bib),
            firstName: a.firstName ?? "",
            lastName: a.lastName ?? "",
            nation: a.nation ?? "",
        });
    }

    function cancelEdit() {
        setEditingAthleteId(null);
        setEditingDraft(null);
    }

    function saveEdit() {
        if (!race || !editingAthleteId || !editingDraft) return;

        const next = starters.map((a) => {
            if (a.id !== editingAthleteId) return a;

            return {
                ...a,
                bib: parseBib(editingDraft.bib),
                firstName: editingDraft.firstName.trim(),
                lastName: editingDraft.lastName.trim(),
                nation: normalizeIoc(editingDraft.nation),
                ageGroupId: race.ageGroupId, // enforce binding
            };
        });

        updateRaceStarters(next);
        cancelEdit();
    }

    function deleteStarter(athleteId: string) {
        const ok = window.confirm("Delete starter?");
        if (!ok) return;

        updateRaceStarters(starters.filter((a) => a.id !== athleteId));
        if (editingAthleteId === athleteId) cancelEdit();
    }

    function addStarter(): boolean {
        if (!race) return false;

        const firstName = newDraft.firstName.trim();
        const lastName = newDraft.lastName.trim();
        if (!firstName || !lastName) return false;

        const nextAthlete: Athlete = {
            id: crypto.randomUUID(),
            firstName,
            lastName,
            bib: parseBib(newDraft.bib),
            nation: normalizeIoc(newDraft.nation),
            ageGroupId: race.ageGroupId,
        };

        updateRaceStarters([...starters, nextAthlete]);

        // clear row + refocus bib (start next entry)
        setNewDraft({ bib: "", firstName: "", lastName: "", nation: "" });
        setTimeout(() => newBibRef.current?.focus(), 0);

        return true;
    }

    type ImportPreviewRow = {
        bib: number | null;
        firstName: string;
        lastName: string;
        nation: string | null;
    };

    function makeNameKey(r: { firstName: string; lastName: string; nation: string | null }) {
        return `${r.firstName.trim().toLowerCase()}|${r.lastName.trim().toLowerCase()}|${(r.nation ?? "").trim().toUpperCase()}`;
    }

    function rowsToAthletes(rows: ImportPreviewRow[], ageGroupId: string): Athlete[] {
        return rows
            .filter((r) => r.firstName.trim() && r.lastName.trim())
            .map((r) => ({
                id: crypto.randomUUID(),
                bib: r.bib,
                firstName: r.firstName.trim(),
                lastName: r.lastName.trim(),
                nation: r.nation,
                ageGroupId,
            }));
    }

    function mergeStarters(existing: Athlete[], rows: ImportPreviewRow[], ageGroupId: string): Athlete[] {
        const byBib = new Map<number, Athlete>();
        const byName = new Map<string, Athlete>();

        for (const a of existing) {
            if (a.bib !== null) byBib.set(a.bib, a);
            byName.set(makeNameKey({ firstName: a.firstName ?? "", lastName: a.lastName ?? "", nation: a.nation ?? null }), a);
        }

        const updatesById = new Map<string, Athlete>();
        const additions: Athlete[] = [];

        for (const r of rows) {
            const firstName = r.firstName.trim();
            const lastName = r.lastName.trim();
            if (!firstName || !lastName) continue;

            const candidate = {
                bib: r.bib,
                firstName,
                lastName,
                nation: r.nation,
                ageGroupId,
            };

            const match =
                (candidate.bib !== null ? byBib.get(candidate.bib) : undefined) ??
                byName.get(makeNameKey(candidate));

            if (match) {
                updatesById.set(match.id, { ...match, ...candidate, ageGroupId });
            } else {
                additions.push({ id: crypto.randomUUID(), ...candidate });
            }
        }

        // keep existing order, apply updates, then append new ones
        return [...existing.map((a) => updatesById.get(a.id) ?? a), ...additions];
    }

    function handleImport(mode: "overwrite" | "merge", rows: ImportPreviewRow[]) {
        if (!race) return;

        if (mode === "overwrite") {
            const next = rowsToAthletes(rows, race.ageGroupId);
            updateRaceStarters(next);
            return;
        }

        // merge
        const next = mergeStarters(starters, rows, race.ageGroupId);
        updateRaceStarters(next);
    }


    function handleNewRowKeyDown(ev: React.KeyboardEvent) {
        if (ev.key !== "Enter") return;

        // optional: Shift+Enter soll NICHT hinzufügen
        if (ev.shiftKey) return;

        ev.preventDefault();

        // only add if required fields are present
        if (!newDraft.firstName.trim() || !newDraft.lastName.trim()) return;

        addStarter();
    }

    // ---- Render guards (after all hooks) ----
    if (!raceId) return <Typography variant="h6">Missing raceId.</Typography>;
    if (!eventList) return <Typography variant="h6">Loading…</Typography>;
    if (!activeEventId) return <Typography variant="h6">No active event selected.</Typography>;
    if (!fullEvent) return <Typography variant="h6">Loading event…</Typography>;

    if (!race) {
        return (
            <Card variant="outlined">
                <CardHeader
                    title="Race starters"
                    action={
                        <Tooltip title="Back to Active Event" arrow>
                            <span>
                                <IconButton onClick={() => navigate("/")} aria-label="Back to Active Event">
                                    <ArrowBackIcon />
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
        <Box>
            <Card variant="outlined">
                <CardHeader
                    title={race.name}
                    action={
                        <Tooltip title="Back to Active Event" arrow>
                            <span>
                                <IconButton onClick={() => navigate("/")} aria-label="Back to Active Event">
                                    <ArrowBackIcon />
                                </IconButton>
                            </span>
                        </Tooltip>
                    }
                    subheader={
                        <Typography variant="caption" color={error ? "error" : "text.secondary"}>
                            {startersCount} starter(s) • AgeGroup: {ageGroupLabel} • Realtime: {status}
                            {error ? ` (${error})` : ""}
                        </Typography>
                    }
                />
                <Divider />
                <CardContent>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>Bib</TableCell>
                                <TableCell>Firstname</TableCell>
                                <TableCell>Lastname</TableCell>
                                <TableCell>Nation (IOC)</TableCell>
                                <TableCell>AgeGroup</TableCell>
                                <TableCell align="right">Actions</TableCell>
                            </TableRow>
                        </TableHead>

                        <TableBody>
                            {starters.map((a) => {
                                const isEditing = editingAthleteId === a.id;
                                const d = editingDraft;

                                return (
                                    <TableRow key={a.id}>
                                        <TableCell sx={{ width: 100 }}>
                                            {isEditing ? (
                                                <TextField
                                                    size="small"
                                                    value={d?.bib ?? ""}
                                                    onChange={(e) => setEditingDraft((p) => (p ? { ...p, bib: e.target.value } : p))}
                                                />
                                            ) : (
                                                a.bib ?? ""
                                            )}
                                        </TableCell>

                                        <TableCell>
                                            {isEditing ? (
                                                <TextField
                                                    size="small"
                                                    value={d?.firstName ?? ""}
                                                    onChange={(e) => setEditingDraft((p) => (p ? { ...p, firstName: e.target.value } : p))}
                                                    fullWidth
                                                />
                                            ) : (
                                                a.firstName
                                            )}
                                        </TableCell>

                                        <TableCell>
                                            {isEditing ? (
                                                <TextField
                                                    size="small"
                                                    value={d?.lastName ?? ""}
                                                    onChange={(e) => setEditingDraft((p) => (p ? { ...p, lastName: e.target.value } : p))}
                                                    fullWidth
                                                />
                                            ) : (
                                                a.lastName
                                            )}
                                        </TableCell>

                                        <TableCell sx={{ width: 140 }}>
                                            {isEditing ? (
                                                <TextField
                                                    size="small"
                                                    value={d?.nation ?? ""}
                                                    onChange={(e) =>
                                                        setEditingDraft((p) => (p ? { ...p, nation: e.target.value.toUpperCase() } : p))
                                                    }
                                                    inputProps={{ maxLength: 3 }}
                                                />
                                            ) : (
                                                a.nation ?? ""
                                            )}
                                        </TableCell>

                                        <TableCell>{ageGroupLabel}</TableCell>

                                        <TableCell align="right">
                                            {isEditing ? (
                                                <>
                                                    <Tooltip title="Save" arrow>
                                                        <span>
                                                            <IconButton size="small" onClick={saveEdit} aria-label="Save starter">
                                                                <SaveIcon />
                                                            </IconButton>
                                                        </span>
                                                    </Tooltip>

                                                    <Tooltip title="Cancel" arrow>
                                                        <span>
                                                            <IconButton size="small" onClick={cancelEdit} aria-label="Cancel edit">
                                                                <CloseIcon />
                                                            </IconButton>
                                                        </span>
                                                    </Tooltip>
                                                </>
                                            ) : (
                                                <>
                                                    <Tooltip title="Edit" arrow>
                                                        <span>
                                                            <IconButton size="small" onClick={() => startEdit(a)} aria-label="Edit starter">
                                                                <EditIcon />
                                                            </IconButton>
                                                        </span>
                                                    </Tooltip>

                                                    <Tooltip title="Delete" arrow>
                                                        <span>
                                                            <IconButton
                                                                size="small"
                                                                color="error"
                                                                onClick={() => deleteStarter(a.id)}
                                                                aria-label="Delete starter"
                                                            >
                                                                <DeleteIcon />
                                                            </IconButton>
                                                        </span>
                                                    </Tooltip>
                                                </>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                );
                            })}

                            {/* Empty row for adding a new starter */}
                            <TableRow>
                                <TableCell sx={{ width: 90 }}>
                                    <TextField
                                        size="small"
                                        value={newDraft.bib}
                                        onChange={(e) => setNewDraft((p) => ({ ...p, bib: e.target.value }))}
                                        onKeyDown={ handleNewRowKeyDown }
                                        placeholder="bib"
                                        inputRef={newBibRef}
                                    />
                                </TableCell>

                                <TableCell>
                                    <TextField
                                        size="small"
                                        value={newDraft.firstName}
                                        onChange={(e) => setNewDraft((p) => ({ ...p, firstName: e.target.value }))}
                                        onKeyDown={handleNewRowKeyDown}
                                        placeholder="First name"
                                        fullWidth
                                    />
                                </TableCell>

                                <TableCell>
                                    <TextField
                                        size="small"
                                        value={newDraft.lastName}
                                        onChange={(e) => setNewDraft((p) => ({ ...p, lastName: e.target.value }))}
                                        onKeyDown={handleNewRowKeyDown}
                                        placeholder="Last name"
                                        fullWidth
                                    />
                                </TableCell>

                                <TableCell sx={{ width: 140 }}>
                                    <TextField
                                        size="small"
                                        value={newDraft.nation}
                                        onChange={(e) => setNewDraft((p) => ({ ...p, nation: e.target.value.toUpperCase() }))}
                                        onKeyDown={handleNewRowKeyDown}
                                        placeholder="IOC"
                                        inputProps={{ maxLength: 3 }}
                                    />
                                </TableCell>

                                <TableCell>{ageGroupLabel}</TableCell>

                                <TableCell align="right">
                                    <Tooltip title="Add starter" arrow>
                                        <span>
                                            <IconButton
                                                size="small"
                                                onClick={addStarter}
                                                aria-label="Add starter"
                                                disabled={!newDraft.firstName.trim() || !newDraft.lastName.trim()}
                                            >
                                                <AddIcon />
                                            </IconButton>
                                        </span>
                                    </Tooltip>
                                </TableCell>
                            </TableRow>
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
            {/* NEW: Import Card */}
            <RaceStartersImport
                raceName={race.name}
                ageGroupLabel={ageGroupLabel}
                onImport={handleImport}
            />

        </Box>
    );
}