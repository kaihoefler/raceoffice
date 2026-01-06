// src/components/AgeGroupsEditor.tsx
import { useState } from "react";
import {
    Box,
    IconButton,
    MenuItem,
    Paper,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    TextField,
    Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import SaveIcon from "@mui/icons-material/Save";
import CloseIcon from "@mui/icons-material/Close";
import DeleteIcon from "@mui/icons-material/Delete";

import type { AgeGroup } from "../types/agegroup";

type Props = {
    value: AgeGroup[];
    onChange: (next: AgeGroup[]) => void;

    /**
     * Used for new rows. When creating a new Event, this can be null/undefined,
     * and will be normalized when the Event is saved.
     */
    eventId?: string | null;

    title?: string;
};


export default function AgeGroupsEditor({ value, onChange, eventId, title = "Age Groups" }: Props) {
    const [editingAgeGroupId, setEditingAgeGroupId] = useState<string | null>(null);
    const [editingBackup, setEditingBackup] = useState<AgeGroup | null>(null);

    function addRow() {
        const id = crypto.randomUUID();
        const newRow: AgeGroup = {
            id,
            name: "",
            gender: "mixed",
            eventId: eventId ?? "",
        };

        onChange([...value, newRow]);
        setEditingBackup(null); // new row => no backup
        setEditingAgeGroupId(id);
    }

    function startEditRow(id: string) {
        const row = value.find((a) => a.id === id) ?? null;
        setEditingBackup(row ? { ...row } : null);
        setEditingAgeGroupId(id);
    }

    function cancelEdit() {
        if (!editingAgeGroupId) return;

        if (!editingBackup) {
            // new row -> remove it again
            onChange(value.filter((a) => a.id !== editingAgeGroupId));
        } else {
            // restore backup
            onChange(value.map((a) => (a.id === editingAgeGroupId ? editingBackup : a)));
        }

        setEditingAgeGroupId(null);
        setEditingBackup(null);
    }

    function saveEdit() {
        // data already lives in "value" through onChange calls
        setEditingAgeGroupId(null);
        setEditingBackup(null);
    }

    function deleteRow(id: string) {
        // falls gerade diese Zeile editiert wird, Edit-Mode verlassen
        if (editingAgeGroupId === id) {
            setEditingAgeGroupId(null);
            setEditingBackup(null);
        }

        onChange(value.filter((a) => a.id !== id));
    }

    function updateField(id: string, patch: Partial<AgeGroup>) {
        onChange(value.map((a) => (a.id === id ? { ...a, ...patch } : a)));
    }

    return (
        <Box sx={{ mt: 1 }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                <Typography variant="h6">{title}</Typography>
                <IconButton onClick={addRow} size="small" aria-label="Add age group">
                    <AddIcon />
                </IconButton>
            </Stack>

            <Paper variant="outlined">
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>Name</TableCell>
                            <TableCell>Gender</TableCell>
                            <TableCell align="right">Actions</TableCell>
                        </TableRow>
                    </TableHead>

                    <TableBody>
                        {value.map((ag) => {
                            const isRowEditing = editingAgeGroupId === ag.id;

                            return (
                                <TableRow key={ag.id}>
                                    <TableCell>
                                        {isRowEditing ? (
                                            <TextField
                                                value={ag.name}
                                                size="small"
                                                onChange={(ev) => updateField(ag.id, { name: ev.target.value })}
                                                placeholder="Age group name"
                                                fullWidth
                                            />
                                        ) : (
                                            ag.name
                                        )}
                                    </TableCell>

                                    <TableCell>
                                        {isRowEditing ? (
                                            <TextField
                                                select
                                                value={ag.gender}
                                                size="small"
                                                onChange={(ev) =>
                                                    updateField(ag.id, { gender: ev.target.value as AgeGroup["gender"] })
                                                }
                                                fullWidth
                                            >
                                                <MenuItem value="men">men</MenuItem>
                                                <MenuItem value="ladies">ladies</MenuItem>
                                                <MenuItem value="mixed">mixed</MenuItem>
                                            </TextField>
                                        ) : (
                                            ag.gender
                                        )}
                                    </TableCell>

                                    <TableCell align="right">
                                        {isRowEditing ? (
                                            <>
                                                <IconButton size="small" onClick={saveEdit} aria-label="Save age group">
                                                    <SaveIcon />
                                                </IconButton>
                                                <IconButton size="small" onClick={cancelEdit} aria-label="Cancel edit">
                                                    <CloseIcon />
                                                </IconButton>
                                                <IconButton size="small" onClick={() => deleteRow(ag.id)} aria-label="Delete age group">
                                                    <DeleteIcon />
                                                </IconButton>
                                            </>
                                        ) : (
                                            <>
                                                <IconButton
                                                    size="small"
                                                    onClick={() => startEditRow(ag.id)}
                                                    aria-label="Edit age group"
                                                >
                                                    <EditIcon />
                                                </IconButton>
                                                <IconButton size="small" onClick={() => deleteRow(ag.id)} aria-label="Delete age group">
                                                    <DeleteIcon />
                                                </IconButton>
                                            </>
                                        )}
                                    </TableCell>
                                </TableRow>
                            );
                        })}

                        {value.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={3}>
                                    <Typography color="text.secondary">No age groups yet.</Typography>
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </Paper>
        </Box>
    );
}