// src/pages/EventsPage.tsx
import { useMemo, useState, useRef } from "react";
import {
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
  Tooltip,
  Card, CardContent, CardHeader, Divider,
  IconButton, MenuItem, Paper,
} from "@mui/material";
import type { Event, EventList } from "../types/event";
import type { AgeGroup } from "../types/agegroup";

import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import SaveIcon from "@mui/icons-material/Save";
import CloseIcon from "@mui/icons-material/Close";

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    // replace german umlauts (simple version)
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    // replace non-alphanumeric by "-"
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function createId(): string {
  // Browser API (modern)
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // fallback (good enough for demo)
  return String(Date.now()) + "-" + Math.random().toString(16).slice(2);
}

type FormState = {
  name: string;
  isActive: boolean;
};

export default function EventsPage() {
  const [events, setEvents] = useState<EventList>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>({
    name: "",
    isActive: false,
  });

  const [showEditor, setShowEditor] = useState(false);

  const [ageGroupsDraft, setAgeGroupsDraft] = useState<AgeGroup[]>([]);
  const [editingAgeGroupId, setEditingAgeGroupId] = useState<string | null>(null);
  const [editingAgeGroupBackup, setEditingAgeGroupBackup] = useState<AgeGroup | null>(null);

  const eventNameInputRef = useRef<HTMLInputElement>(null);

  const computedSlug = useMemo(() => slugify(form.name), [form.name]);

  const isEditing = editingId !== null;

  const isDirty = isEditing || form.name.trim() !== "" || form.isActive !== true;

  function resetForm() {
    setEditingId(null);
    setForm({ name: "", isActive: true });
    setAgeGroupsDraft([]);
    setEditingAgeGroupId(null);
    setEditingAgeGroupBackup(null);
    setShowEditor(false);
  }

  
  function startEdit(e: Event) {
    setEditingId(e.id);
    setForm({ name: e.name, isActive: e.isActive });
    setAgeGroupsDraft(e.ageGroups ?? []);
    setEditingAgeGroupId(null);
    setEditingAgeGroupBackup(null);
    setShowEditor(true);
    setTimeout(() => eventNameInputRef.current?.focus(), 0);
  }

  function startNewEvent() {
    setEditingId(null);
    setForm({ name: "", isActive: false });
    setAgeGroupsDraft([]);
    setEditingAgeGroupId(null);
    setEditingAgeGroupBackup(null);
    setShowEditor(true);
    // focus after render
    setTimeout(() => eventNameInputRef.current?.focus(), 0);
  }

  function activateEvent(id: string) {
    setEvents((prev) =>
        prev.map((e) => ({
        ...e,
        isActive: e.id === id,
        }))
    );
  }

  function save() {
    const name = form.name.trim();
    if (!name) return;

    const slug = slugify(name);

    if (!isEditing) {
      const newEventId = createId();
      const newEvent: Event = {
        id: newEventId,
        name,
        slug,
        ageGroups: ageGroupsDraft
          .filter((ag) => ag.name.trim() !== "") // optional: leere Zeilen ignorieren
          .map((ag) => ({
                          ...ag,
                          eventId: newEventId,
                          name: ag.name.trim(),
          })),
        isActive: form.isActive,
      };

       setEvents((prev) => [
        newEvent,
        ...prev.map((e) => ({ ...e, isActive: newEvent.isActive ? false : e.isActive })),
        ]);

      resetForm();
      return;
    }

    // Bearbeitungsmodus
    const normalizedAgeGroups = ageGroupsDraft
      .filter((ag) => ag.name.trim() !== "")
      .map((ag) => ({
              ...ag,
              eventId: editingId!, // eventId auf das Event setzen
              name: ag.name.trim(),
      }));

    setEvents((prev) =>
      prev.map((e) => {
        const updated =
          e.id === editingId
            ? { ...e, name, slug, isActive: form.isActive, ageGroups: normalizedAgeGroups }
            : { ...e };

        if (form.isActive) {
          updated.isActive = updated.id === editingId;
        }

        return updated;
      })
    );
    resetForm();
  }


  // Age Group specific functions

  function addAgeGroupRow() {
  // neue Zeile (leer) anlegen und direkt editierbar machen
  const id = createId();
  const newRow: AgeGroup = {
    id,
    name: "",
    gender: "mixed",
    eventId: editingId ?? "", // bei "New Event" ist editingId noch null -> wird beim Event-Save korrigiert
  };

  setAgeGroupsDraft((prev) => [...prev, newRow]);
  setEditingAgeGroupBackup(null); // new row => no backup
  setEditingAgeGroupId(id);
}

function startEditAgeGroup(id: string) {
  const row = ageGroupsDraft.find((a) => a.id === id) ?? null;
  setEditingAgeGroupBackup(row ? { ...row } : null);
  setEditingAgeGroupId(id);
}

function cancelEditAgeGroup() {
  if (!editingAgeGroupId) return;

  // Wenn es eine neue Zeile war (kein Backup), entfernen wir sie wieder
  if (!editingAgeGroupBackup) {
    setAgeGroupsDraft((prev) => prev.filter((a) => a.id !== editingAgeGroupId));
  } else {
    // Sonst Original wiederherstellen
    setAgeGroupsDraft((prev) =>
      prev.map((a) => (a.id === editingAgeGroupId ? editingAgeGroupBackup : a))
    );
  }

  setEditingAgeGroupId(null);
  setEditingAgeGroupBackup(null);
}

function saveEditAgeGroup() {
  // Inline-Edit ist bereits in ageGroupsDraft gespeichert (onChange),
  // daher müssen wir hier nur Edit-Mode verlassen.
  setEditingAgeGroupId(null);
  setEditingAgeGroupBackup(null);
}

function updateAgeGroupField(id: string, patch: Partial<AgeGroup>) {
  setAgeGroupsDraft((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
}

  return (
    <Box>


    {/* List Card */}
    <Card variant="outlined">
      <CardHeader title="Events" action={
           <IconButton aria-label="New Event" onClick={startNewEvent}>
              <AddIcon />
            </IconButton>
          } />
      <Divider />
      <CardContent>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Slug</TableCell>
                <TableCell>Active</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>

            <TableBody>
              {events.map((e) => (
                <TableRow key={e.id} sx={{...(e.isActive && { backgroundColor: "action.selected", "& td": { fontWeight: 600 }, }), }}>
                <TableCell>{e.name}</TableCell>

                <TableCell sx={{ fontFamily: "monospace" }}>
                    <Tooltip title={`ID: ${e.id}`} arrow>
                    <span>{e.slug}</span>
                    </Tooltip>
                </TableCell>

                <TableCell>{e.isActive ? "Yes" : "No"}</TableCell>

                <TableCell align="right">
                    {!e.isActive && (
                      <Button
                        size="small"
                        onClick={() => activateEvent(e.id)}
                        disabled={e.isActive}
                      >
                        Activate
                      </Button>
                      )}
                    <IconButton size="small" onClick={() => startEdit(e)} aria-label="Edit Event">
                        <EditIcon />
                    </IconButton>
                </TableCell>
                </TableRow>          ))}

              {events.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4}>
                    <Typography color="text.secondary">No events yet.</Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
      </CardContent>
    </Card>

    {/* Edit/New Card */}
    {showEditor && ( <Box sx={{ mt: 5 }}>
      <Card variant="outlined">
        <CardHeader title={isEditing ? "Edit Event" : "New Event"} />
        <Divider />
        <CardContent>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={3} sx={{ mb: 3 }}>
            <TextField
              label="Name"
              value={form.name}
              onChange={(ev) => setForm((p) => ({ ...p, name: ev.target.value }))}
              fullWidth
              inputRef={eventNameInputRef}
            />

            <FormControlLabel
              control={
                <Checkbox
                  checked={form.isActive}
                  onChange={(ev) => setForm((p) => ({ ...p, isActive: ev.target.checked }))}
                />
              }
              label="Active"
            />

            <TextField
              label="Slug"
              value={computedSlug}
              fullWidth
              variant="filled"
              disabled
              helperText="Slug is derived from name"
            />
          </Stack>

          {/* AgeGroups */}
          <Box sx={{ mt: 1 }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
              <Typography variant="h6">Age Groups</Typography>
              <IconButton onClick={addAgeGroupRow} size="small" aria-label="Add age group">
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
                  {ageGroupsDraft.map((ag) => {
                    const isRowEditing = editingAgeGroupId === ag.id;

                    return (
                      <TableRow key={ag.id}>
                        <TableCell>
                          {isRowEditing ? (
                            <TextField
                              value={ag.name}
                              size="small"
                              onChange={(ev) =>
                                updateAgeGroupField(ag.id, { name: ev.target.value })
                              }
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
                                updateAgeGroupField(ag.id, {
                                  gender: ev.target.value as AgeGroup["gender"],
                                })
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
                              <IconButton
                                size="small"
                                onClick={saveEditAgeGroup}
                                aria-label="Save age group"
                              >
                                <SaveIcon />
                              </IconButton>
                              <IconButton
                                size="small"
                                onClick={cancelEditAgeGroup}
                                aria-label="Cancel edit"
                              >
                                <CloseIcon />
                              </IconButton>
                            </>
                          ) : (
                            <IconButton
                              size="small"
                              onClick={() => startEditAgeGroup(ag.id)}
                              aria-label="Edit age group"
                            >
                              <EditIcon />
                            </IconButton>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}

                  {ageGroupsDraft.length === 0 && (
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

          {/* Save/Cancel */}
          <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
            <Button variant="contained" onClick={save} disabled={!form.name.trim()}>
              {isEditing ? "Update" : "Create"}
            </Button>

            {isDirty && (
              <Button variant="outlined" onClick={resetForm}>
                Cancel
              </Button>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Box>)}

  </Box>
    
    

  );
}

