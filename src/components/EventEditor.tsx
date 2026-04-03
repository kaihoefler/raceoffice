// src/components/EventEditor.tsx
//
// EventEditor
// -----------
// Zweck:
// - UI zum Erstellen/Bearbeiten eines Events
// - Speichert "lightweight" Daten (name/slug) in der globalen EventList (für EventsPage Tabelle)
// - Speichert "heavy" Daten (FullEvent: ageGroups, races, athletes, ...) in einem per-Event Realtime-Dokument
//
// Datenquellen:
// - EventListProvider (useEventList):
//   - liefert listEntry für name/slug (das ist die Quelle, die die Events-Liste anzeigt)
//   - saveEvent(...) aktualisiert/erstellt den EventList-Eintrag
//   - setActiveEvent(...) setzt optional das neue Event als aktiv
// - useRealtimeDoc<Partial<FullEvent>>(Event-{eventId}):
//   - liefert raw Snapshot des FullEvent Dokuments (ageGroups etc.)
//   - update(...) persistiert Änderungen am FullEvent Dokument
//
// Wichtige UI/State-Details:
// - slug wird immer aus name abgeleitet (slugify)
// - "dirty detection": lokale Änderungen werden nicht durch neue Remote-Snapshots überschrieben
// - beim Speichern werden:
//   1) EventList aktualisiert
//   2) FullEvent-Dokument aktualisiert (ageGroups normalisiert)

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
import type { AgeGroup, FullEvent } from "@raceoffice/domain";


import { useRealtimeDoc } from "../realtime/useRealtimeDoc";
import { useEventList } from "../providers/EventListProvider";
import { normalizeRaceActivitiesForRead, normalizeRaceResultsForRead } from "../domain/eventActions";

/**
 * Draft, der an EventListProvider.saveEvent(...) übergeben wird.
 * (Nur die Felder, die im globalen EventList-Dokument gespeichert werden.)
 */
export type EventDraft = {
  name: string;
  slug: string;
};

type Props = {
  /** Wenn false: Editor rendert null (kein Dialog/Panel sichtbar). */
  open: boolean;
  /** "new" -> neues Event anlegen, "edit" -> bestehendes Event bearbeiten. */
  mode: "new" | "edit";
  /** Event-ID, auf die sich der Editor bezieht. (Wird von EventsPage vergeben.) */
  eventId: string | null;
  onCancel: () => void;
  onAfterSave?: () => void;
};

/**
 * Slug-Generator:
 * - lower-case
 * - deutsche Umlaute vereinheitlichen
 * - alle Non-Alnum als "-"
 * - führende/trailing "-" entfernen
 */
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

/**
 * Defensive Normalisierung eines per-event Realtime-Dokuments.
 *
 * Hintergrund:
 * - useRealtimeDoc ist hier als Partial<FullEvent> typisiert
 * - Realtime-Dokumente können "halb initialisiert" sein (Arrays fehlen, falscher Typ, etc.)
 *
 * Ziel:
 * - der Editor und nachfolgende Updates können sicher mit Arrays arbeiten
 *   (ageGroups, races, raceResults, raceStarters, raceActivities, athletes)
 */
function normalizeFullEvent(raw: unknown, eventId: string): FullEvent {
  const obj = raw && typeof raw === "object" ? (raw as any) : {};

  const races = Array.isArray(obj.races) ? obj.races : [];

  return {
    id: typeof obj.id === "string" ? obj.id : eventId,
    name: typeof obj.name === "string" ? obj.name : "",
    slug: typeof obj.slug === "string" ? obj.slug : "",
    activeRaceId: typeof obj.activeRaceId === "string" ? obj.activeRaceId : null,
    ageGroups: Array.isArray(obj.ageGroups) ? obj.ageGroups : [],
    races: races.map((r: any) => ({
      ...r,
            // Defensive: Nested arrays normalisieren
            raceResults: normalizeRaceResultsForRead(r?.raceResults),
      raceStarters: Array.isArray(r?.raceStarters) ? r.raceStarters : [],
      raceActivities: normalizeRaceActivitiesForRead(r?.raceActivities),
    })),
    athletes: Array.isArray(obj.athletes) ? obj.athletes : [],
  };
}

export default function EventEditor({ open, mode, eventId, onCancel, onAfterSave }: Props) {
  /**
   * Zugriff auf globale EventList:
   * - listEntry ist maßgeblich für Name/Slug Anzeige in der Event-Liste
   * - saveEvent schreibt in die EventList
   */
  const { eventList, saveEvent, setActiveEvent } = useEventList();

  /**
   * Per-event Realtime-Dokument:
   * - docId: "Event-{eventId}"
   * - raw: Snapshot des FullEvent Dokuments
   * - update: persistiert Änderungen (funktionaler Update)
   * - status/error: Realtime Statusanzeige (nur informativ fürs UI)
   */
  const docId = eventId ? `Event-${eventId}` : null;
  const { data: raw, update, status, error } = useRealtimeDoc<Partial<FullEvent>>(docId);

  /**
   * Normalisiertes FullEvent (aus raw) für die UI.
   * - null wenn eventId fehlt
   */
  const normalized = useMemo(() => {
    if (!eventId) return null;
    return normalizeFullEvent(raw, eventId);
  }, [raw, eventId]);

  /**
   * Prefer EventList entry for name/slug:
   * - EventsPage zeigt genau diese Werte an
   * - deshalb nutzen wir listEntry als primäre Quelle für name
   */
  const listEntry = useMemo(() => {
    if (!eventId) return null;
    return eventList?.events.find((e) => e.id === eventId) ?? null;
  }, [eventList, eventId]);

  // -----------------------
  // Editor-lokaler Zustand
  // -----------------------
  const [name, setName] = useState("");
  const [ageGroups, setAgeGroups] = useState<AgeGroup[]>([]);
  const nameInputRef = useRef<HTMLInputElement>(null);

  /**
   * Baseline für Dirty-Detection:
   * - baseName/baseAgeGroupsJson repräsentieren den letzten "synchronisierten" Zustand
   * - solange isDirty true ist, überschreiben wir lokale Edits NICHT durch Remote-Updates
   */
  const [baseName, setBaseName] = useState("");
  const [baseAgeGroupsJson, setBaseAgeGroupsJson] = useState("[]");

  /**
   * Der Slug wird rein aus dem aktuellen name abgeleitet.
   * (Der Slug ist hier bewusst read-only.)
   */
  const slug = useMemo(() => slugify(name), [name]);

  /**
   * Dirty-Detection:
   * - nameDirty: lokaler name weicht von baseName ab
   * - ageGroupsDirty: JSON-Vergleich (einfacher Snapshot-Vergleich; für sehr große Daten evtl. optimieren)
   */
  const isDirty = useMemo(() => {
    const nameDirty = name.trim() !== baseName.trim();
    const ageGroupsDirty = JSON.stringify(ageGroups) !== baseAgeGroupsJson;
    return nameDirty || ageGroupsDirty;
  }, [name, ageGroups, baseName, baseAgeGroupsJson]);

  /**
   * Hydration/Sync-Effekt:
   * - wenn Editor geöffnet wird oder neue Daten reinkommen,
   *   übernehmen wir die Remote-Werte in den lokalen State
   *
   * ABER:
   * - wenn der User bereits lokal editiert (isDirty), überschreiben wir NICHT
   *   (verhindert "stomping" bei Realtime-Updates)
   */
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

  /**
   * Autofokus auf Name-Feld beim Öffnen.
   * setTimeout(0) stellt sicher, dass das Input nach dem Render existiert.
   */
  useEffect(() => {
    if (!open) return;
    setTimeout(() => nameInputRef.current?.focus(), 0);
  }, [open]);

  // Wenn Editor geschlossen, gar nichts rendern (vereinfachtes "Dialog" Pattern)
  if (!open) return null;

  /**
   * Guard: Editor benötigt eventId.
   * (Sollte in der Praxis nicht passieren, da EventsPage beim Öffnen eine ID setzt.)
   */
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

  /**
   * raw Snapshot:
   * - raw === null bedeutet hier: noch kein Snapshot geladen
   *   (je nach useRealtimeDoc-Implementation)
   */
  const hasSnapshot = raw !== null;

  /**
   * Save-Button-Enablement:
   * - erst speichern, wenn Snapshot da ist (damit update(prev=>...) sinnvoll normalisieren kann)
   * - und Name nicht leer ist
   */
  const canSave = hasSnapshot && !!name.trim();

  /**
   * Save-Handler:
   * 1) Speichert name/slug in die globale EventList (EventsPage Tabelle)
   * 2) Persistiert FullEvent-Anteile (ageGroups etc.) im per-event Dokument
   * 3) setzt Dirty-Baseline zurück
   * 4) im "new" Modus: setzt Event als aktiv
   */
  function handleSave() {
    const id = eventId;
    if (!id) return;

    const trimmedName = name.trim();
    if (!trimmedName) return;

    // 1) Update lightweight list entry in EventList doc (drives EventsPage table)
    saveEvent(id, { name: trimmedName, slug });

    // 2) Update per-event FullEvent doc (ageGroups etc.)
    update((prev) => {
      // normalize prev snapshot defensively so we can always spread/override safe arrays
      const current = normalizeFullEvent(prev, id);

      // AgeGroups normalisieren:
      // - leere Namen entfernen
      // - trimmen
      // - eventId setzen (wichtig für Referenzen)
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

    // Baseline aktualisieren (damit isDirty wieder false wird)
    setBaseName(trimmedName);
    setBaseAgeGroupsJson(JSON.stringify(ageGroups));

    // UX: nach Create das neue Event direkt aktiv setzen
    if (mode === "new") setActiveEvent(id);

    onAfterSave?.();
  }

  return (
    <Box sx={{ mt: 5 }}>
      <Card variant="outlined">
        <CardHeader
          title={mode === "edit" ? "Edit Event" : "New Event"}
          subheader={
            // Debug/Info: Realtime Status + Fehler anzeigen
            <Typography variant="caption" color={error ? "error" : "text.secondary"}>
              Realtime: {status}
              {error ? ` (${error})` : ""}
              {!hasSnapshot ? " (loading snapshot…)" : ""}
            </Typography>
          }
        />
        <Divider />
        <CardContent>
          {/* Name + Slug */}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={3} sx={{ mb: 3 }}>
            <TextField
              label="Name"
              value={name}
              onChange={(ev) => setName(ev.target.value)}
              fullWidth
              inputRef={nameInputRef}
            />

            {/* Slug ist abgeleitet und nicht editierbar */}
            <TextField
              label="Slug"
              value={slug}
              fullWidth
              variant="filled"
              disabled
              helperText="Slug is derived from name"
            />
          </Stack>

          {/* AgeGroups Editor: verwaltet die Liste lokal, wird beim Save persistiert */}
          <AgeGroupsEditor value={ageGroups} onChange={setAgeGroups} eventId={eventId} title="Age Groups" />

          {/* Actions */}
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