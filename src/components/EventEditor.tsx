// src/components/EventEditor.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Divider,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

import AgeGroupsEditor from "./AgeGroupsEditor";
import type { AgeGroup } from "../types/agegroup";
import type { FullEvent } from "../types/event";

import { useRealtimeDoc } from "../realtime/useRealtimeDoc";
import { useEventList } from "../providers/EventListProvider";

export type EventDraft = {
  name: string;
  slug: string;
};

type Props = {
  open: boolean;
  mode: "new" | "edit";
  eventId: string | null;
  onCancel: () => void;
  onAfterSave?: () => void;
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

function normalizeFullEvent(raw: unknown, eventId: string): FullEvent {
  const obj = raw && typeof raw === "object" ? (raw as any) : {};

  const races = Array.isArray(obj.races) ? obj.races : [];

  return {
    id: typeof obj.id === "string" ? obj.id : eventId,
    name: typeof obj.name === "string" ? obj.name : "",
    slug: typeof obj.slug === "string" ? obj.slug : "",
    ageGroups: Array.isArray(obj.ageGroups) ? obj.ageGroups : [],
    races: races.map((r: any) => ({
      ...r,
      raceResults: Array.isArray(r?.raceResults) ? r.raceResults : [],
      raceStarters: Array.isArray(r?.raceStarters) ? r.raceStarters : [],
      raceActivities: Array.isArray(r?.raceActivities) ? r.raceActivities : [],
      finishLineResults: Array.isArray(r?.finishLineResults) ? r.finishLineResults : [],
      
    })),
    athletes: Array.isArray(obj.athletes) ? obj.athletes : [],
  };
}


export default function EventEditor({ open, mode, eventId, onCancel, onAfterSave }: Props) {
  const { eventList, saveEvent, setActiveEvent } = useEventList();

  const docId = eventId ? `Event-${eventId}` : null;
  const { data: raw, update, status, error } = useRealtimeDoc<Partial<FullEvent>>(docId);

  const normalized = useMemo(() => {
    if (!eventId) return null;
    return normalizeFullEvent(raw, eventId);
  }, [raw, eventId]);

  // Prefer the EventList entry for name/slug (it’s what the list UI shows).
  const listEntry = useMemo(() => {
    if (!eventId) return null;
    return eventList?.events.find((e) => e.id === eventId) ?? null;
  }, [eventList, eventId]);

  // Editor-local state
  const [name, setName] = useState("");
  const [ageGroups, setAgeGroups] = useState<AgeGroup[]>([]);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Baseline used for dirty detection (what we last "synced in")
  const [baseName, setBaseName] = useState("");
  const [baseAgeGroupsJson, setBaseAgeGroupsJson] = useState("[]");

  const slug = useMemo(() => slugify(name), [name]);

  const isDirty = useMemo(() => {
    const nameDirty = name.trim() !== baseName.trim();
    const ageGroupsDirty = JSON.stringify(ageGroups) !== baseAgeGroupsJson;
    return nameDirty || ageGroupsDirty;
  }, [name, ageGroups, baseName, baseAgeGroupsJson]);

  // Hydrate from remote sources when opening / switching docs / receiving updates,
  // but do NOT overwrite if the user has local edits (isDirty).
  useEffect(() => {
    if (!open) return;
    if (!eventId) return;

    const sourceName = (listEntry?.name ?? normalized?.name ?? "").toString();
    const sourceAgeGroups = normalized?.ageGroups ?? [];

    // If user is editing, don't stomp local state.
    if (isDirty) return;

    setName(sourceName);
    setAgeGroups(sourceAgeGroups);

    // Update dirty baseline to the newly synced values
    setBaseName(sourceName);
    setBaseAgeGroupsJson(JSON.stringify(sourceAgeGroups));
  }, [
    open,
    eventId,
    // re-run when these upstream values change
    listEntry?.name,
    normalized?.name,
    normalized?.ageGroups,
    // control overwriting local changes
    isDirty,
  ]);

  useEffect(() => {
    if (!open) return;
    setTimeout(() => nameInputRef.current?.focus(), 0);
  }, [open]);

  if (!open) return null;

  if (!eventId) {
    return (
      <Box sx={{ mt: 5 }}>
        <Card variant="outlined">
          <CardHeader title="Event" />
          <Divider />
          <CardContent>
            <Typography color="error">EventEditor requires an eventId.</Typography>
            <Button sx={{ mt: 2 }} variant="outlined" onClick={onCancel}>
              Close
            </Button>
          </CardContent>
        </Card>
      </Box>
    );
  }

  const hasSnapshot = raw !== null;
  const canSave = hasSnapshot && !!name.trim();

  function handleSave() {
    const id = eventId;
    if (!id) return;

    const trimmedName = name.trim();
    if (!trimmedName) return;

    // 1) Update lightweight list entry in EventList doc (drives EventsPage table)
    saveEvent(id, { name: trimmedName, slug });

    // 2) Update per-event FullEvent doc (ageGroups etc.)
    update((prev) => {
      const current = normalizeFullEvent(prev, id);

      const normalizedAgeGroups = ageGroups
        .filter((ag) => ag.name.trim() !== "")
        .map((ag) => ({
          ...ag,
          name: ag.name.trim(),
          eventId: id,
        }));

      const next: Partial<FullEvent> = {
        ...current,
        id,
        name: trimmedName,
        slug,
        ageGroups: normalizedAgeGroups,
      };

      return next;
    });

    // If we stay open (e.g. you remove onAfterSave later), reset baseline now.
    setBaseName(trimmedName);
    setBaseAgeGroupsJson(JSON.stringify(ageGroups));

    if (mode === "new") setActiveEvent(id);

    onAfterSave?.();
  }

  return (
    <Box sx={{ mt: 5 }}>
      <Card variant="outlined">
        <CardHeader
          title={mode === "edit" ? "Edit Event" : "New Event"}
          subheader={
            <Typography variant="caption" color={error ? "error" : "text.secondary"}>
              Realtime: {status}
              {error ? ` (${error})` : ""}
              {!hasSnapshot ? " (loading snapshot…)" : ""}
            </Typography>
          }
        />
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
            <Button variant="contained" onClick={handleSave} disabled={!canSave}>
              {mode === "edit" ? "Update" : "Create"}
            </Button>

            
              <Button variant="outlined" onClick={onCancel}>
                Cancel
              </Button>
        
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}