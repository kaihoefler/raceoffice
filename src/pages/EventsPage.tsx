// src/pages/EventsPage.tsx
import { useState } from "react";
import {
  Box,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
  Tooltip,
  Card,
  CardContent,
  CardHeader,
  Divider,
  IconButton,
} from "@mui/material";

import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";

import EventEditor, { type EventDraft } from "../components/EventEditor";
import type { Event } from "../types/event";
import type { AgeGroup } from "../types/agegroup";

import { useEventList } from "../providers/EventListProvider";

export default function EventsPage() {
  const { eventList, setActiveEvent, saveEvent, deleteEvent } = useEventList();

  const [editingId, setEditingId] = useState<string | null>(null);

  const [editorInitial, setEditorInitial] = useState({
    name: "",
    ageGroups: [] as AgeGroup[],
  });

  const [showEditor, setShowEditor] = useState(false);

  // solange kein snapshot da ist
  if (!eventList) return null;

  function resetForm() {
    setEditingId(null);
    setShowEditor(false);
    setEditorInitial({ name: "", ageGroups: [] as AgeGroup[] });
  }

  function startEdit(e: Event) {
    setEditingId(e.id);
    setEditorInitial({
      name: e.name,
      ageGroups: e.ageGroups ?? [],
    });
    setShowEditor(true);
  }

  function startNewEvent() {
    setEditingId(null);
    setEditorInitial({
      name: "",
      ageGroups: [],
    });
    setShowEditor(true);
  }

  function handleDelete(e: Event) {
    const ok = window.confirm(`Event "${e.name}" wirklich löschen?`);
    if (!ok) return;

    deleteEvent(e);

    // falls gerade dieses Event im Editor offen ist
    if (editingId === e.id) resetForm();
  }

  function handleSave(draft: EventDraft) {
    // UI-Validierung kann hier bleiben
    const name = draft.name.trim();
    if (!name) return;

    // Provider sollte Normalisierung/Trim etc. final übernehmen,
    // aber wir geben hier schon den getrimmten Namen weiter.
    saveEvent(editingId, { ...draft, name });

    resetForm();
  }

  return (
    <Box>
      {/* List Card */}
      <Card variant="outlined">
        <CardHeader
          title="Events"
          action={
            <IconButton aria-label="New Event" onClick={startNewEvent}>
              <AddIcon />
            </IconButton>
          }
        />
        <Divider />
        <CardContent>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Slug</TableCell>
                <TableCell align="right">Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>

            <TableBody>
              {eventList.events.map((e) => {
                const isActive = eventList.activeEventId === e.id;

                return (
                  <TableRow
                    key={e.id}
                    sx={{
                      ...(isActive && {
                        backgroundColor: "action.selected",
                        "& td": { fontWeight: 600 },
                      }),
                    }}
                  >
                    <TableCell>{e.name}</TableCell>

                    <TableCell sx={{ fontFamily: "monospace" }}>
                      <Tooltip title={`ID: ${e.id}`} arrow>
                        <span>{e.slug}</span>
                      </Tooltip>
                    </TableCell>

                    {/* Status control column */}
                    <TableCell align="right">
                      <Button
                        size="small"
                        onClick={() => setActiveEvent(e.id)}
                        disabled={isActive}
                        variant={isActive ? "contained" : "outlined"}
                        color={isActive ? "success" : "primary"}
                      >
                        {isActive ? "Active" : "Activate"}
                      </Button>
                    </TableCell>

                    {/* Actions */}
                    <TableCell align="right">
                      <Tooltip title="Edit" arrow>
                        <IconButton
                          size="small"
                          onClick={() => startEdit(e)}
                          aria-label="Edit Event"
                        >
                          <EditIcon />
                        </IconButton>
                      </Tooltip>

                      <Tooltip title="Delete" arrow>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleDelete(e)}
                          aria-label="Delete Event"
                          sx={{ ml: 0.5 }}
                        >
                          <DeleteIcon />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}

              {eventList.events.length === 0 && (
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

      {/* Edit/New */}
      <EventEditor
        open={showEditor}
        mode={editingId ? "edit" : "new"}
        initial={editorInitial}
        eventId={editingId}
        onSave={handleSave}
        onCancel={resetForm}
      />
    </Box>
  );
}