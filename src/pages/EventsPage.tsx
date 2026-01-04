// src/pages/EventsPage.tsx
import { useMemo, useState } from "react";
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
} from "@mui/material";
import type { Event, EventList } from "../event";

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
    isActive: true,
  });

  const computedSlug = useMemo(() => slugify(form.name), [form.name]);

  const isEditing = editingId !== null;

  const isDirty = isEditing || form.name.trim() !== "" || form.isActive !== true;

  function resetForm() {
    setEditingId(null);
    setForm({ name: "", isActive: true });
  }

  
  function startEdit(e: Event) {
    setEditingId(e.id);
    setForm({ name: e.name, isActive: e.isActive });
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
      const newEvent: Event = {
        id: createId(),
        name,
        slug,
        isActive: form.isActive,
      };

        setEvents((prev) => [
        newEvent,
        ...prev.map((e) => ({ ...e, isActive: newEvent.isActive ? false : e.isActive })),
        ]);

      resetForm();
      return;
    }

    setEvents((prev) =>
        prev.map((e) => {
            const updated =
            e.id === editingId
                ? { ...e, name, slug, isActive: form.isActive }
                : { ...e };

            // Exklusiv-Regel: wenn das bearbeitete Event aktiv ist, alle anderen deaktivieren
            if (form.isActive) {
            updated.isActive = updated.id === editingId;
            }

            return updated;
        })
    );
    resetForm();
  }

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Events
      </Typography>

      <Box sx={{ mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          {isEditing ? "Update Event" : "Create Event"}
        </Typography>

        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 2 }}>
          <TextField
            label="Name"
            value={form.name}
            onChange={(ev) => setForm((p) => ({ ...p, name: ev.target.value }))}
            fullWidth
          />

          <TextField
            label="Slug"
            value={computedSlug}
            fullWidth
            InputProps={{ readOnly: true }}
            helperText="Slug is derived from name"
          />
        </Stack>

        <FormControlLabel
          control={
            <Checkbox
              checked={form.isActive}
              onChange={(ev) => setForm((p) => ({ ...p, isActive: ev.target.checked }))}
            />
          }
          label="Active"
        />

        <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
          <Button variant="contained" onClick={save} disabled={!form.name.trim()}>
            {isEditing ? "Update" : "Create"}
          </Button>
           {isDirty && (<Button variant="outlined" onClick={resetForm}>
            Cancel
          </Button>)}
        </Stack>
      </Box>

      <Typography variant="h6" gutterBottom>
        Event List
      </Typography>

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
            <TableRow key={e.id}>
            <TableCell>{e.name}</TableCell>

            <TableCell sx={{ fontFamily: "monospace" }}>
                <Tooltip title={`ID: ${e.id}`} arrow>
                <span>{e.slug}</span>
                </Tooltip>
            </TableCell>

            <TableCell>{e.isActive ? "Yes" : "No"}</TableCell>

            <TableCell align="right">
                <Button size="small" onClick={() => startEdit(e)}>
                    Edit
                </Button>

                <Button
                    size="small"
                    onClick={() => activateEvent(e.id)}
                    disabled={e.isActive}
                >
                    Activate
                </Button>
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
    </Box>
  );
}

