// src/pages/EventsPage.tsx
import {  useState } from "react";
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
  Card, CardContent, CardHeader, Divider,
  IconButton
} from "@mui/material";
import EventEditor, { type EventDraft } from "../components/EventEditor";
import type { Event, EventList } from "../types/event";
import type { AgeGroup } from "../types/agegroup";


import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";



export default function EventsPage() {
  const [events, setEvents] = useState<EventList>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [editorInitial, setEditorInitial] = useState({
    name: "",
    isActive: false,
    ageGroups: [] as AgeGroup[],
  });

  
  const [showEditor, setShowEditor] = useState(false);

  
  function resetForm() {
    setEditingId(null);
    setShowEditor(false);
    setEditorInitial({ name: "", isActive: false, ageGroups: [] as AgeGroup[] });
  }


  function startEdit(e: Event) {
    setEditingId(e.id);
    setEditorInitial({
      name: e.name,
      isActive: e.isActive,
      ageGroups: e.ageGroups ?? [],
    });
    setShowEditor(true);
  }

  function startNewEvent() {
    setEditingId(null);
    setEditorInitial({
      name: "",
      isActive: false,
      ageGroups: [],
    });
    setShowEditor(true);
  }


  function activateEvent(id: string) {
    setEvents((prev) =>
      prev.map((e) => ({
        ...e,
        isActive: e.id === id,
      }))
    );
  }

  function handleSave(draft: EventDraft) {
    const name = draft.name.trim();
    if (!name) return;

    const slug = draft.slug; // bereits im Editor berechnet

    if (editingId === null) {
      const newEventId = crypto.randomUUID();

      const newEvent: Event = {
        id: newEventId,
        name,
        slug,
        isActive: draft.isActive,
        ageGroups: draft.ageGroups
          .filter((ag) => ag.name.trim() !== "")
          .map((ag) => ({
            ...ag,
            name: ag.name.trim(),
            eventId: newEventId,
          })),
      };

      setEvents((prev) => [
        newEvent,
        ...prev.map((e) => ({ ...e, isActive: newEvent.isActive ? false : e.isActive })),
      ]);

      resetForm();
      return;
    }

    const normalizedAgeGroups = draft.ageGroups
      .filter((ag) => ag.name.trim() !== "")
      .map((ag) => ({
        ...ag,
        name: ag.name.trim(),
        eventId: editingId,
      }));

    setEvents((prev) =>
      prev.map((e) => {
        const updated =
          e.id === editingId
            ? { ...e, name, slug, isActive: draft.isActive, ageGroups: normalizedAgeGroups }
            : { ...e };

        if (draft.isActive) {
          updated.isActive = updated.id === editingId;
        }

        return updated;
      })
    );

    resetForm();
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
                <TableRow key={e.id} sx={{ ...(e.isActive && { backgroundColor: "action.selected", "& td": { fontWeight: 600 }, }), }}>
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
                </TableRow>))}

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

