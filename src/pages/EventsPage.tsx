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
import EventEditor, { type EventDraft } from "../components/EventEditor";
import type { Event, EventList } from "../types/event";
import type { AgeGroup } from "../types/agegroup";

import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";

export default function EventsPage() {
  const [eventList, setEventList] = useState<EventList>({
    activeEventId: null,
    events: [],
  });

  const [editingId, setEditingId] = useState<string | null>(null);

  const [editorInitial, setEditorInitial] = useState({
    name: "",
    ageGroups: [] as AgeGroup[],
  });

  const [showEditor, setShowEditor] = useState(false);

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

  function activateEvent(id: string) {
    setEventList((prev) => ({
      ...prev,
      activeEventId: id,
    }));
  }

  function handleSave(draft: EventDraft) {
    const name = draft.name.trim();
    if (!name) return;

    const slug = draft.slug;

    // CREATE
    if (editingId === null) {
      const newEventId = crypto.randomUUID();

      const newEvent: Event = {
        id: newEventId,
        name,
        slug,
        ageGroups: draft.ageGroups
          .filter((ag) => ag.name.trim() !== "")
          .map((ag) => ({
            ...ag,
            name: ag.name.trim(),
            eventId: newEventId,
          })),
      };

      setEventList((prev) => ({
        ...prev,
        events: [newEvent, ...prev.events],
      }));

      resetForm();
      return;
    }

    // UPDATE
    const normalizedAgeGroups = draft.ageGroups
      .filter((ag) => ag.name.trim() !== "")
      .map((ag) => ({
        ...ag,
        name: ag.name.trim(),
        eventId: editingId,
      }));

    setEventList((prev) => ({
      ...prev,
      events: prev.events.map((e) =>
        e.id === editingId ? { ...e, name, slug, ageGroups: normalizedAgeGroups } : e
      ),
    }));

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
                {/* status column and actions at far right */}
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
                        onClick={() => activateEvent(e.id)}
                        disabled={isActive}
                        variant={isActive ? "contained" : "outlined"}
                        color={isActive ? "success" : "primary"}
                      >
                        {isActive ? "Active" : "Activate"}
                      </Button>
                    </TableCell>

                    {/* Actions (edit etc.) */}
                    <TableCell align="right">
                      <IconButton size="small" onClick={() => startEdit(e)} aria-label="Edit Event">
                        <EditIcon />
                      </IconButton>
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

      {/* Edit/New Card */}
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