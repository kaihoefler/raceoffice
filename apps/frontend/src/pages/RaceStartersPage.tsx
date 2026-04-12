// src/pages/RaceStartersPage.tsx
//
// RaceStartersPage
// ----------------
// Zweck:
// - Verwaltung der Starter eines einzelnen Rennens
// - manuelles Hinzufügen, Editieren und Löschen von Startern
// - Import von Starterlisten (Replace oder Merge)
// - Navigation zum zugehörigen Scoring-Screen
//
// Wichtige Domänenidee:
// - Änderungen an den Startern sollen nicht nur `raceStarters` verändern,
//   sondern das Race als Ganzes konsistent halten
// - deshalb nutzt die Seite die aggregate-aware Actions aus `useEventsActions(...)`
// - diese Actions bereinigen bei Bedarf auch `raceActivities` und bauen
//   `raceResults` anschließend neu auf
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
import HomeIcon from "@mui/icons-material/Home";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";


import { useNavigate, useParams } from "react-router-dom";

import { useEventList } from "../providers/EventListProvider";
import RaceStartersImport from "../components/RaceStartersImport";
import RaceSelector from "../components/RaceSelector";

import type { Athlete, Race, StarterImportRow } from "@raceoffice/domain";



import { useEventsActions } from "../hooks/useEventsActions";

import { normalizeIoc, parseBib, rowsToAthletes } from "../domain/startersActions";




export default function RaceStartersPage() {
    // ---- Hooks (must run unconditionally) ----
    // Routing + globale Event-Auswahl
    const navigate = useNavigate();
    const { raceId } = useParams<{ raceId: string }>();
    const { eventList } = useEventList();
    const newBibRef = useRef<HTMLInputElement>(null);

    const activeEventId = eventList?.activeEventId ?? null;

    const { fullEvent: eventDoc, status, error, replaceRaceStarters, removeRaceStarter, upsertRaceStarters } = useEventsActions(activeEventId);



    // Solange kein aktives Event gewählt ist, exponieren wir bewusst `null`.
    // Das vereinfacht die Render-Guards weiter unten.
    const fullEvent = useMemo(() => (activeEventId ? eventDoc : null), [activeEventId, eventDoc]);


    // Das aktuell in der Route ausgewählte Race auflösen.
    const race: Race | null = useMemo(() => {
        if (!fullEvent || !raceId) return null;
        return fullEvent.races.find((r) => r.id === raceId) ?? null;
    }, [fullEvent, raceId]);

    // Altersklasse des Rennens nur für Anzeigezwecke bestimmen.
    const raceAgeGroup = useMemo(() => {
        if (!fullEvent || !race) return null;
        return fullEvent.ageGroups.find((ag) => ag.id === race.ageGroupId) ?? null;
    }, [fullEvent, race]);

    // Wechsel auf ein anderes Race über den Selector im Header.
    function handleRaceSelect(nextRaceId: string) {
        if (!nextRaceId || nextRaceId === raceId) return;
        cancelEdit(); // optional: Edit-State sauber abbrechen
        navigate(`/races/${nextRaceId}/starters`);
    }

    // Komfortable Ableitungen für Rendering und Aktionen.
    const starters: Athlete[] = race?.raceStarters ?? [];
    const startersCount = starters.length;

    // Für die Anzeige sortieren wir nach Bib; Starter ohne Bib wandern ans Ende.
    const startersSorted = useMemo(() => {
        return [...starters].sort((a, b) => {
            const ai = a.bib ?? Number.MAX_SAFE_INTEGER; // bib=null ans Ende
            const bi = b.bib ?? Number.MAX_SAFE_INTEGER;
            if (ai !== bi) return ai - bi;

            // stabiler Tie-Breaker (optional)
            return (a.lastName ?? "").localeCompare(b.lastName ?? "", undefined, { sensitivity: "base" });
        });
    }, [starters]);

    // Focus bib when race is available (initial page load)
    useEffect(() => {
        if (!race) return;
        setTimeout(() => newBibRef.current?.focus(), 0);
    }, [race?.id]);

    // Inline-Edit-State für genau eine bearbeitete Tabellenzeile.
    const [editingAthleteId, setEditingAthleteId] = useState<string | null>(null);
    const [editingDraft, setEditingDraft] = useState<{
        bib: string;
        firstName: string;
        lastName: string;
        nation: string;
    } | null>(null);

    // Eingabemodell für die leere "neuer Starter"-Zeile am Tabellenende.
    const [newDraft, setNewDraft] = useState({
        bib: "",
        firstName: "",
        lastName: "",
        nation: "",
    });

    /**
* Aggregate-aware replace:
* - ersetzt die komplette Starterliste
* - bereinigt abhängige raceActivities
* - materialisiert raceResults danach neu
*/
    function updateRaceStarters(nextStarters: Athlete[]) {
        if (!raceId) return;
        replaceRaceStarters(raceId, nextStarters);
    }

    /**
     * Aggregate-aware upsert:
     * - fügt Starter hinzu oder merged sie per bib/name
     * - baut raceResults für neue Starter direkt mit auf
     */
    function addOrMergeRaceStarters(incoming: Athlete[]) {
        if (!raceId) return;
        upsertRaceStarters(raceId, incoming, { recomputeResults: true });
    }



    // Startet die Inline-Bearbeitung eines vorhandenen Starters.
    function startEdit(a: Athlete) {
        setEditingAthleteId(a.id);
        setEditingDraft({
            bib: a.bib === null ? "" : String(a.bib),
            firstName: a.firstName ?? "",
            lastName: a.lastName ?? "",
            nation: a.nation ?? "",
        });
    }

    // Bricht die Inline-Bearbeitung ab und verwirft den Draft.
    function cancelEdit() {
        setEditingAthleteId(null);
        setEditingDraft(null);
    }

    // Speichert die aktuell bearbeitete Tabellenzeile.
    // Wir ersetzen bewusst die komplette Starterliste des Races,
    // damit die Domain-Logik anschließend Konsistenzregeln anwenden kann.
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

    // Löscht einen einzelnen Starter aggregate-aware.
    // Dabei werden auch abhängige Race-Strukturen bereinigt.
    function deleteStarter(athleteId: string) {
        const ok = window.confirm("Delete starter?");
        if (!ok) return;

        if (!raceId) return;

        removeRaceStarter(raceId, athleteId);
        if (editingAthleteId === athleteId) cancelEdit();

    }

    // Löscht alle Starter des Races.
    // Folge: raceActivities/raceResults werden ebenfalls konsistent zurückgebaut.
    function deleteAllStarters() {
        if (!race) return;
        if (!starters.length) return;

        const ok = window.confirm(`Delete ALL starters (${starters.length})?`);
        if (!ok) return;

        updateRaceStarters([]);
        cancelEdit();
        setTimeout(() => newBibRef.current?.focus(), 0);
    }


    // Fügt einen neuen Starter aus der Eingabezeile hinzu.
    // Der Upsert ist aggregate-aware, d.h. neue Result-Zeilen werden direkt aufgebaut.
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

        addOrMergeRaceStarters([nextAthlete]);


        // clear row + refocus bib (start next entry)
        setNewDraft({ bib: "", firstName: "", lastName: "", nation: "" });
        setTimeout(() => newBibRef.current?.focus(), 0);

        return true;
    }

    // Import-Typalias nur für bessere Lesbarkeit der Handler-Signatur.
    type ImportPreviewRow = StarterImportRow;

        // Verarbeitet den CSV-/Listen-Import aus RaceStartersImport.
    // - replace: ersetzt die komplette Starterliste
    // - merge: fügt neue Starter hinzu bzw. merged bestehende und rematerialisiert Ergebnisse
    function handleImport(mode: "replace" | "merge", rows: ImportPreviewRow[]) {

        if (!race) return;

        if (mode === "replace") {
            const next = rowsToAthletes(rows, race.ageGroupId);
            updateRaceStarters(next);
            return;
        }

        // merge (aggregate-aware): neue/importierte Starter werden dedupliziert
        // und raceResults danach direkt neu materialisiert.
        addOrMergeRaceStarters(rowsToAthletes(rows, race.ageGroupId));

    }


    // Komfort-Navigation direkt in die Scoring-Ansicht des aktuellen Races.
    function goToScoring() {
        if (!race) return;
        cancelEdit();
        navigate(`/races/${race.id}/scoring`);
    }

    // Enter in der neuen Zeile speichert direkt einen Starter.
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
    // Wichtig: Guards erst nach allen Hooks, damit die Hook-Reihenfolge stabil bleibt.
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

    // Benutzerfreundliches Label für die Tabellenanzeige.
    const ageGroupLabel = raceAgeGroup ? `${raceAgeGroup.name} (${raceAgeGroup.gender})` : race.ageGroupId;

    return (
        <Box>
            <Card variant="outlined">
                <CardHeader
                    title={race.name}
                    action={
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                            <RaceSelector
                                races={fullEvent.races}
                                ageGroups={fullEvent.ageGroups}
                                value={race.id}
                                onChange={handleRaceSelect}
                                size="small"
                            />

                            <Tooltip title="Go to Scoring" arrow>
                                <span>
                                    <IconButton onClick={goToScoring} aria-label="Go to Scoring">
                                        <EmojiEventsIcon />
                                    </IconButton>
                                </span>
                            </Tooltip>

                            <Tooltip title="Delete all starters" arrow>
                                <span>
                                    <IconButton
                                        onClick={deleteAllStarters}
                                        aria-label="Delete all starters"
                                        color="error"
                                        disabled={startersCount === 0}
                                    >
                                        <DeleteSweepIcon />
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
                            {/* Vorhandene Starter in sortierter Reihenfolge */}
                            {startersSorted.map((a) => {
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
                                        onKeyDown={handleNewRowKeyDown}
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