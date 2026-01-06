// src/components/EventEditor.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, Card, CardContent, CardHeader, Checkbox, Divider, FormControlLabel, Stack, TextField } from "@mui/material";

import AgeGroupsEditor from "./AgeGroupsEditor";
import type { AgeGroup } from "../types/agegroup";

export type EventDraft = {
  name: string;
  slug: string;
  isActive: boolean;
  ageGroups: AgeGroup[];
};

type Props = {
  open: boolean;
  mode: "new" | "edit";
  initial: {
    name: string;
    isActive: boolean;
    ageGroups: AgeGroup[];
  };
  eventId?: string | null; // for passing to AgeGroupsEditor (optional)
  onSave: (draft: EventDraft) => void;
  onCancel: () => void;
};

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function EventEditor({ open, mode, initial, eventId, onSave, onCancel }: Props) {
  const [name, setName] = useState(initial.name);
  const [isActive, setIsActive] = useState(initial.isActive);
  const [ageGroups, setAgeGroups] = useState<AgeGroup[]>(initial.ageGroups);

  const nameInputRef = useRef<HTMLInputElement>(null);

  // keep state in sync when switching between edit/new or selecting different events
  useEffect(() => {
    setName(initial.name);
    setIsActive(initial.isActive);
    setAgeGroups(initial.ageGroups);
  }, [initial.name, initial.isActive, initial.ageGroups]);

  // focus name when the editor opens
  useEffect(() => {
    if (open) {
      setTimeout(() => nameInputRef.current?.focus(), 0);
    }
  }, [open]);

  const slug = useMemo(() => slugify(name), [name]);

const isDirty =
  name.trim() !== initial.name.trim() ||
  isActive !== initial.isActive ||
  ageGroups !== initial.ageGroups; 

  if (!open) return null;

  return (
    <Box sx={{ mt: 5 }}>
      <Card variant="outlined">
        <CardHeader title={mode === "edit" ? "Edit Event" : "New Event"} />
        <Divider />
        <CardContent>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={3} sx={{ mb: 3 }}>
            <TextField
              label="Name"
              value={name}
              onChange={(ev) => setName(ev.target.value)}
              fullWidth
              inputRef={nameInputRef}
            />

            <FormControlLabel
              control={<Checkbox checked={isActive} onChange={(ev) => setIsActive(ev.target.checked)} />}
              label="Active"
            />

            <TextField
              label="Slug"
              value={slug}
              fullWidth
              variant="filled"
              disabled
              helperText="Slug is derived from name"
            />
          </Stack>

          <AgeGroupsEditor value={ageGroups} onChange={setAgeGroups} eventId={eventId} title="Age Groups" />

          <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
            <Button
              variant="contained"
              onClick={() => onSave({ name, slug, isActive, ageGroups })}
              disabled={!name.trim()}
            >
              {mode === "edit" ? "Update" : "Create"}
            </Button>

            {isDirty && (
              <Button variant="outlined" onClick={onCancel}>
                Cancel
              </Button>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}