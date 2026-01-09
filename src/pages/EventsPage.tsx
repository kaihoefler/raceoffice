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

import EventEditor from "../components/EventEditor";
import type { Event } from "../types/event";

import { useEventList } from "../providers/EventListProvider";

export default function EventsPage() {
  const { eventList, setActiveEvent, deleteEvent } = useEventList();

  const [editorMode, setEditorMode] = useState<"new" | "edit">("new");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  if (!eventList) return null;

  function resetForm() {
    setShowEditor(false);
    setEditingId(null);
    setEditorMode("new");
  }

  function startEdit(e: Event) {
    setEditorMode("edit");
    setEditingId(e.id);
    setShowEditor(true);
  }

  function startNewEvent() {
    const newId = crypto.randomUUID();
    setEditorMode("new");
    setEditingId(newId);
    setShowEditor(true);
  }

  function handleDelete(e: Event) {
    const ok = window.confirm(`Event "${e.name}" wirklich löschen?`);
    if (!ok) return;

    deleteEvent(e);

    if (editingId === e.id) resetForm();
  }

  return (
    <Box>
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

                    <TableCell align="right">
                      <Tooltip title="Edit" arrow>
                        <IconButton size="small" onClick={() => startEdit(e)} aria-label="Edit Event">
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

      <EventEditor
        key={`${editingId ?? "none"}:${editorMode}`} // important: reset local editor state when switching events/mode
        open={showEditor}
        mode={editorMode}
        eventId={editingId}
        onCancel={resetForm}
        onAfterSave={resetForm}
      />
    </Box>
  );
}