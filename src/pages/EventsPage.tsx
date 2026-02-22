// src/pages/EventsPage.tsx
//
// EventsPage
// ----------
// Zweck:
// - Verwaltungsseite für Events (Auflisten, Aktivieren, Editieren, Löschen)
// - Nutzt EventListProvider (useEventList), der die Daten aus einem Realtime-Dokument liefert
// - Öffnet bei "New" oder "Edit" einen Dialog (EventEditor)
//
// UI/Logik-Überblick:
// - Tabelle zeigt: Name, Slug (mit Tooltip für ID), Status (Activate/Active), Actions (Edit/Delete)
// - "Active" Event wird optisch hervorgehoben (selected background, bold text)
// - Delete ist per confirm abgesichert
// - Editor-Dialog wird über lokale State-Maschine (editorMode/editingId/showEditor) gesteuert

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
  /**
   * Daten + API aus dem Provider:
   * - eventList: enthält events[] + activeEventId
   * - setActiveEvent: setzt activeEventId im Realtime-Dokument
   * - deleteEvent: entfernt Event aus eventList
   */
  const { eventList, setActiveEvent, deleteEvent } = useEventList();

  /**
   * Lokale UI-States für den EventEditor:
   * - editorMode: "new" oder "edit"
   * - editingId: welche Event-ID gerade bearbeitet/angelegt wird
   * - showEditor: Dialog sichtbar ja/nein
   */
  const [editorMode, setEditorMode] = useState<"new" | "edit">("new");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  /**
   * Guard: solange eventList noch nicht geladen/initialisiert ist,
   * rendern wir nichts.
   *
   * (Optional könntest du hier auch einen Loading-State anzeigen.)
   */
  if (!eventList) return null;

  /**
   * Setzt den Editor in den Ausgangszustand zurück:
   * - Dialog schließen
   * - editingId löschen
   * - Mode zurück auf "new"
   */
  function resetForm() {
    setShowEditor(false);
    setEditingId(null);
    setEditorMode("new");
  }

  /**
   * Startet den Edit-Flow für ein existierendes Event:
   * - Mode: edit
   * - editingId: ID des Events
   * - Dialog öffnen
   */
  function startEdit(e: Event) {
    setEditorMode("edit");
    setEditingId(e.id);
    setShowEditor(true);
  }

  /**
   * Startet den Create-Flow:
   * - erzeugt sofort eine neue ID (UUID)
   * - setzt Mode "new"
   * - öffnet Editor
   *
   * Hinweis: Event wird erst beim Speichern im EventEditor tatsächlich in die Liste geschrieben.
   */
  function startNewEvent() {
    const newId = crypto.randomUUID();
    setEditorMode("new");
    setEditingId(newId);
    setShowEditor(true);
  }

  /**
   * Delete-Handler:
   * - confirmation dialog
   * - ruft deleteEvent im Provider
   * - falls gerade dieses Event im Editor offen ist: Editor schließen/resetten
   */
  function handleDelete(e: Event) {
    const ok = window.confirm(`Event "${e.name}" wirklich löschen?`);
    if (!ok) return;

    deleteEvent(e);

    // Wenn das gelöschte Event gerade im Editor geöffnet ist, Editor schließen
    if (editingId === e.id) resetForm();
  }

  return (
    <Box>
      {/* Card: Event-Liste */}
      <Card variant="outlined">
        <CardHeader
          title="Events"
          action={
            // "New Event" Button im Header (Icon-only)
            <IconButton aria-label="New Event" onClick={startNewEvent}>
              <AddIcon />
            </IconButton>
          }
        />
        <Divider />

        <CardContent>
          {/* Tabelle der Events */}
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Slug</TableCell>
                <TableCell align="center">Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>

            <TableBody>
              {/* Rows: alle Events */}
              {eventList.events.map((e) => {
                const isActive = eventList.activeEventId === e.id;

                return (
                  <TableRow key={e.id}>
                    {/* Event-Name */}
                    <TableCell>{e.name}</TableCell>

                    {/* Slug + Tooltip mit ID (praktisch zum Debuggen/Kopieren) */}
                    <TableCell sx={{ fontFamily: "monospace" }}>
                      <Tooltip title={`ID: ${e.id}`} arrow>
                        {/* span nötig, weil Tooltip ein "single child" erwartet */}
                        <span>{e.slug}</span>
                      </Tooltip>
                    </TableCell>

                    {/* Status-Aktion: aktivieren oder aktiv */}
                    <TableCell align="center">
                      <Button
                        size="small"
                        onClick={() => setActiveEvent(e.id)}
                        disabled={isActive} // aktive Events nicht erneut aktivieren
                        // Active soll NICHT als "filled" erscheinen, sondern nur grün (Text + Rahmen)
                        variant="outlined"
                        color={isActive ? "success" : "primary"}
                        sx={
                          isActive
                            ? {
                                // MUI disabled Buttons werden standardmäßig ausgegraut.
                                // Wir überschreiben das, damit "Active" weiterhin grün bleibt.
                                "&.Mui-disabled": {
                                  color: "success.main",
                                  borderColor: "success.main",
                                  opacity: 1,
                                },
                              }
                            : undefined
                        }
                      >
                        {isActive ? "Active" : "Activate"}
                      </Button>
                    </TableCell>

                    {/* Actions: Edit / Delete */}
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

              {/* Empty state */}
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

      {/* EventEditor Dialog:
          - key erzwingt ein Remount, wenn editingId/mode wechselt
            => lokale State im Editor wird zuverlässig zurückgesetzt */}
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