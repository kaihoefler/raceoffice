// src/components/VisualizationEditor.tsx
//
// VisualizationEditor
// -------------------
// Zweck:
// - UI zum Erstellen/Bearbeiten einer Visualisierung (FullVisualization)
// - Speichert "lightweight" Daten (name) in der globalen VisualizationList (für VisualizationsPage Tabelle)
// - Speichert "heavy" Daten (FullVisualization: backgroundColor/fontSize/fontColor) in einem per-Visualization Realtime-Dokument
//
// Prinzip analog zum EventEditor:
// - Liste (VisualizationListProvider) ist Quelle für Name in der Tabelle
// - pro Visualization existiert ein eigenes Realtime-Dokument: "Visualization-{id}"

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Divider,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

import { useRealtimeDoc } from "../realtime/useRealtimeDoc";

import { useVisualizationList } from "../providers/VisualizationListProvider";

import type { FullVisualization } from "../types/visualization";

export type VisualizationDraft = {
  name: string;
  backgroundColor: string;
  fontSize: string;
  fontColor: string;
};

type Props = {
  /** Wenn false: Editor rendert null. */
  open: boolean;
  /** "new" -> neue Visualization anlegen, "edit" -> bestehende bearbeiten. */
  mode: "new" | "edit";
  /** Visualization-ID, auf die sich der Editor bezieht. */
  visualizationId: string | null;
  onCancel: () => void;
  onAfterSave?: () => void;
};

function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value.trim());
}

function normalizeFullVisualization(raw: unknown, visualizationId: string): FullVisualization {
  const obj = raw && typeof raw === "object" ? (raw as any) : {};

  return {
    id: typeof obj.id === "string" ? obj.id : visualizationId,
    name: typeof obj.name === "string" ? obj.name : "",
    backgroundColor: typeof obj.backgroundColor === "string" ? obj.backgroundColor : "#000000",
    fontSize: typeof obj.fontSize === "string" ? obj.fontSize : "16px",
    fontColor: typeof obj.fontColor === "string" ? obj.fontColor : "#ffffff",
  };
}

function ColorField(props: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  helperText?: string;
  pickerFallback?: string;
}) {
  const pickerValue = isHexColor(props.value) ? props.value.trim() : props.pickerFallback ?? "#000000";

  return (
    <TextField
      label={props.label}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      fullWidth
      helperText={props.helperText ?? 'Hex, e.g. "#000000"'}
      slotProps={{
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <Box
                component="input"
                type="color"
                value={pickerValue}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => props.onChange(e.target.value)}
                aria-label={`${props.label} picker`}
                style={{
                  width: 28,
                  height: 28,
                  padding: 0,
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                }}
              />
            </InputAdornment>
          ),
        },
      }}
    />
  );
}

export default function VisualizationEditor({ open, mode, visualizationId, onCancel, onAfterSave }: Props) {
  const { visualizationList, saveVisualization, setActiveVisualization } = useVisualizationList();

  const docId = visualizationId ? `Visualization-${visualizationId}` : null;
  const { data: raw, update, status, error } = useRealtimeDoc<Partial<FullVisualization>>(docId);

  const listEntry = useMemo(() => {
    if (!visualizationId) return null;
    const list = Array.isArray(visualizationList?.visualizations) ? visualizationList!.visualizations : [];
    return list.find((v) => v.id === visualizationId) ?? null;
  }, [visualizationList, visualizationId]);

  const normalized = useMemo(() => {
    if (!visualizationId) return null;
    return normalizeFullVisualization(raw, visualizationId);
  }, [raw, visualizationId]);

  // -----------------------
  // Local editor state
  // -----------------------
  const [name, setName] = useState("");
  const [backgroundColor, setBackgroundColor] = useState("#000000");
  const [fontSize, setFontSize] = useState("16px");
  const [fontColor, setFontColor] = useState("#ffffff");

  const nameInputRef = useRef<HTMLInputElement>(null);

  // Dirty detection baseline
  // IMPORTANT: initialize to the same values as our initial local state so we don't start out "dirty"
  // (otherwise hydration from realtime/list would be blocked).
  const [baseJson, setBaseJson] = useState(() =>
    JSON.stringify({
      name: "",
      backgroundColor: "#000000",
      fontSize: "16px",
      fontColor: "#ffffff",
    }),
  );

  const draftJson = useMemo(() => {
    return JSON.stringify({
      name: name.trim(),
      backgroundColor: backgroundColor.trim(),
      fontSize: fontSize.trim(),
      fontColor: fontColor.trim(),
    });
  }, [name, backgroundColor, fontSize, fontColor]);

  const isDirty = draftJson !== baseJson;

  // Hydration from upstream docs (only if not dirty)
  // Name precedence: list entry first (drives the table), then full doc snapshot.
  useEffect(() => {
    if (!open) return;
    if (!visualizationId) return;

    if (isDirty) return;

    const sourceName = String(listEntry?.name ?? normalized?.name ?? "");
    const sourceBg = String(normalized?.backgroundColor ?? "#000000");
    const sourceFontSize = String(normalized?.fontSize ?? "16px");
    const sourceFontColor = String(normalized?.fontColor ?? "#ffffff");

    setName(sourceName);
    setBackgroundColor(sourceBg);
    setFontSize(sourceFontSize);
    setFontColor(sourceFontColor);

    setBaseJson(
      JSON.stringify({
        name: sourceName.trim(),
        backgroundColor: sourceBg.trim(),
        fontSize: sourceFontSize.trim(),
        fontColor: sourceFontColor.trim(),
      }),
    );
  }, [open, visualizationId, listEntry?.name, normalized?.name, normalized?.backgroundColor, normalized?.fontSize, normalized?.fontColor, isDirty]);

  // Autofocus when opening
  useEffect(() => {
    if (!open) return;
    setTimeout(() => nameInputRef.current?.focus(), 0);
  }, [open]);

  if (!open) return null;

  if (!visualizationId) {
    return (
      <Box sx={{ mt: 2 }}>
        <Card variant="outlined">
          <CardHeader title="Visualization" />
          <Divider />
          <CardContent>
            <Typography color="error">VisualizationEditor requires a visualizationId.</Typography>
            <Button sx={{ mt: 2 }} variant="outlined" onClick={onCancel}>
              Close
            </Button>
          </CardContent>
        </Card>
      </Box>
    );
  }

  const canSave = !!name.trim();

  function handleSave() {
    const id = visualizationId;
    if (!id) return;

    const trimmedName = name.trim();
    if (!trimmedName) return;

    // 1) Update lightweight list entry (drives VisualizationsPage table)
    // -> the list entry is the primary source of truth for the name shown in the list.
    saveVisualization(id, { name: trimmedName });

    // 2) Update per-visualization full doc
    // -> keep the name in the full doc consistent with the list entry.
    update((prev) => {
      const current = normalizeFullVisualization(prev, id);

      const next: Partial<FullVisualization> = {
        ...current,
        id,
        name: trimmedName,
        backgroundColor: String(backgroundColor ?? "").trim() || "#000000",
        fontSize: String(fontSize ?? "").trim() || "16px",
        fontColor: String(fontColor ?? "").trim() || "#ffffff",
      };

      return next;
    });

    // Reset dirty baseline
    setBaseJson(draftJson);

    // UX: after creating a new visualization, make it active
    if (mode === "new") setActiveVisualization(id);

    onAfterSave?.();
  }

  return (
    <Box sx={{ mt: 2 }}>
      <Card variant="outlined">
        <CardHeader
          title={mode === "edit" ? "Edit Visualization" : "New Visualization"}
          subheader={
            <Typography variant="caption" color={error ? "error" : "text.secondary"}>
              Realtime: {status}
              {error ? ` (${error})` : ""}
              {isDirty ? " • unsaved changes" : ""}
            </Typography>
          }
        />
        <Divider />

        <CardContent>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={3} sx={{ mb: 3 }}>
            <TextField
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              fullWidth
              inputRef={nameInputRef}
            />

            <TextField label="ID" value={visualizationId ?? ""} fullWidth variant="filled" disabled />
          </Stack>

          <Stack direction={{ xs: "column", sm: "row" }} spacing={3} sx={{ mb: 3 }}>
            <ColorField
              label="Background color"
              value={backgroundColor}
              onChange={setBackgroundColor}
              helperText='Hex, e.g. "#000000"'
              pickerFallback="#000000"
            />

            <TextField
              label="Font size"
              value={fontSize}
              onChange={(e) => setFontSize(e.target.value)}
              fullWidth
              helperText='e.g. "16px"'
            />

            <ColorField
              label="Font color"
              value={fontColor}
              onChange={setFontColor}
              helperText='Hex, e.g. "#ffffff"'
              pickerFallback="#ffffff"
            />
          </Stack>

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
