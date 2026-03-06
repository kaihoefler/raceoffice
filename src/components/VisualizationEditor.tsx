// src/components/VisualizationEditor.tsx
//
// VisualizationEditor
// -------------------
// Zweck:
// - UI zum Erstellen/Bearbeiten einer Visualisierung (FullVisualization)
// - Speichert "lightweight" Daten (name) in der globalen VisualizationList (für VisualizationsPage Tabelle)
// - Speichert "heavy" Daten (FullVisualization: Farben, Paging, Spalten-Konfiguration) in einem per-Visualization Realtime-Dokument
//
// Prinzip analog zum EventEditor:
// - die Liste (VisualizationListProvider) ist die Quelle für den Namen in der Übersicht
// - pro Visualization existiert zusätzlich ein eigenes Realtime-Dokument: "Visualization-{id}"

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Divider,
  IconButton,
  InputAdornment,
  MenuItem,
  Popover,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import DeleteIcon from "@mui/icons-material/Delete";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";

import { useRealtimeDoc } from "../realtime/useRealtimeDoc";

import { useVisualizationList } from "../providers/VisualizationListProvider";

import type { FullVisualization, VisualizationColumn, VisualizationColumnAlign } from "../types/visualization";

export type VisualizationDraft = {
  name: string;
  backgroundColor: string;
  alternateRowBackgroundColor: string;
  usePaging: boolean;
  pagingLines: number;
  pagingTime: number;
  fontSize: string;
  fontWeight: string;
  fontColor: string;
  columns: VisualizationColumn[];
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

function normalizeColumnAlign(value: unknown): VisualizationColumnAlign {
  return value === "center" || value === "right" ? value : "left";
}

function normalizeNonNegativeInteger(value: unknown, fallback: number): number {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) && num >= 0 ? Math.floor(num) : fallback;
}

function normalizeColumns(raw: unknown): VisualizationColumn[] {
  if (!Array.isArray(raw)) return [];

  return raw.map((col) => ({
    columnTitle: typeof (col as any)?.columnTitle === "string" ? (col as any).columnTitle : "",
    columnWidth: typeof (col as any)?.columnWidth === "string" ? (col as any).columnWidth : "",
    columnAlign: normalizeColumnAlign((col as any)?.columnAlign),
    columnFallback: typeof (col as any)?.columnFallback === "string" ? (col as any).columnFallback : "",
    columnContent: typeof (col as any)?.columnContent === "string" ? (col as any).columnContent : "",
  }));
}

function normalizeEditableColumns(columns: VisualizationColumn[]): VisualizationColumn[] {
  return (Array.isArray(columns) ? columns : [])
    .map((col) => ({
      columnTitle: String(col?.columnTitle ?? "").trim(),
      columnWidth: String(col?.columnWidth ?? "").trim(),
      columnAlign: normalizeColumnAlign(col?.columnAlign),
      columnFallback: String(col?.columnFallback ?? "").trim(),
      columnContent: String(col?.columnContent ?? "").trim(),
    }))
    .filter((col) => col.columnTitle || col.columnWidth || col.columnContent || col.columnFallback);
}

function makeEmptyColumn(): VisualizationColumn {
  return {
    columnTitle: "",
    columnWidth: "",
    columnAlign: "left",
    columnFallback: "",
    columnContent: "",
  };
}

function normalizeFullVisualization(raw: unknown, visualizationId: string): FullVisualization {
  const obj = raw && typeof raw === "object" ? (raw as any) : {};

  return {
    id: typeof obj.id === "string" ? obj.id : visualizationId,
    name: typeof obj.name === "string" ? obj.name : "",
    backgroundColor: typeof obj.backgroundColor === "string" ? obj.backgroundColor : "#000000",
    alternateRowBackgroundColor:
      typeof obj.alternateRowBackgroundColor === "string" ? obj.alternateRowBackgroundColor : "",
    usePaging: typeof obj.usePaging === "boolean" ? obj.usePaging : false,
    pagingLines: normalizeNonNegativeInteger(obj.pagingLines, 10),
    pagingTime: normalizeNonNegativeInteger(obj.pagingTime, 0),
    fontSize: typeof obj.fontSize === "string" ? obj.fontSize : "16px",
    fontWeight: typeof obj.fontWeight === "string" ? obj.fontWeight : "400",
    fontColor: typeof obj.fontColor === "string" ? obj.fontColor : "#ffffff",
    columns: normalizeColumns(obj.columns),
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
  // Lokaler Editor-State
  // -----------------------
  const [name, setName] = useState("");
  const [backgroundColor, setBackgroundColor] = useState("#000000");
  const [alternateRowBackgroundColor, setAlternateRowBackgroundColor] = useState("");
  const [usePaging, setUsePaging] = useState(false);
  const [pagingLines, setPagingLines] = useState("10");
  const [pagingTime, setPagingTime] = useState("0");
  const [fontSize, setFontSize] = useState("16px");
  const [fontWeight, setFontWeight] = useState("400");
  const [fontColor, setFontColor] = useState("#ffffff");
  const [columns, setColumns] = useState<VisualizationColumn[]>([]);

  const nameInputRef = useRef<HTMLInputElement>(null);
  const [columnsHelpAnchorEl, setColumnsHelpAnchorEl] = useState<HTMLElement | null>(null);

  // Ausgangszustand für Dirty-Detection.
  // Wichtig: identisch zu den initialen useState-Werten, damit der Editor
  // beim ersten Laden nicht fälschlich als "dirty" gilt.
  const [baseJson, setBaseJson] = useState(() =>
    JSON.stringify({
      name: "",
      backgroundColor: "#000000",
      alternateRowBackgroundColor: "",
      usePaging: false,
      pagingLines: 10,
      pagingTime: 0,
      fontSize: "16px",
      fontWeight: "400",
      fontColor: "#ffffff",
      columns: [],
    }),
  );

  const draftJson = useMemo(() => {
    return JSON.stringify({
      name: name.trim(),
      backgroundColor: backgroundColor.trim(),
      alternateRowBackgroundColor: alternateRowBackgroundColor.trim(),
      usePaging,
      pagingLines: normalizeNonNegativeInteger(pagingLines, 10),
      pagingTime: normalizeNonNegativeInteger(pagingTime, 0),
      fontSize: fontSize.trim(),
      fontWeight: fontWeight.trim(),
      fontColor: fontColor.trim(),
      columns: normalizeEditableColumns(columns),
    });
  }, [name, backgroundColor, alternateRowBackgroundColor, usePaging, pagingLines, pagingTime, fontSize, fontWeight, fontColor, columns]);

  const isDirty = draftJson !== baseJson;

  // Editor aus den externen Datenquellen befüllen – aber nur solange lokal
  // noch nichts verändert wurde.
  // Priorität für den Namen: erst Listen-Eintrag, dann Full-Doc.
  useEffect(() => {
    if (!open) return;
    if (!visualizationId) return;

    if (isDirty) return;

    const sourceName = String(listEntry?.name ?? normalized?.name ?? "");
    const sourceBg = String(normalized?.backgroundColor ?? "#000000");
    const sourceAltRowBg = String(normalized?.alternateRowBackgroundColor ?? "");
    const sourceUsePaging = Boolean(normalized?.usePaging ?? false);
    const sourcePagingLines = String(normalized?.pagingLines ?? 10);
    const sourcePagingTime = String(normalized?.pagingTime ?? 0);
    const sourceFontSize = String(normalized?.fontSize ?? "16px");
    const sourceFontWeight = String(normalized?.fontWeight ?? "400");
    const sourceFontColor = String(normalized?.fontColor ?? "#ffffff");
    const sourceColumns = normalizeEditableColumns(normalized?.columns ?? []);

    setName(sourceName);
    setBackgroundColor(sourceBg);
    setAlternateRowBackgroundColor(sourceAltRowBg);
    setUsePaging(sourceUsePaging);
    setPagingLines(sourcePagingLines);
    setPagingTime(sourcePagingTime);
    setFontSize(sourceFontSize);
    setFontWeight(sourceFontWeight);
    setFontColor(sourceFontColor);
    setColumns(sourceColumns);

    setBaseJson(
      JSON.stringify({
        name: sourceName.trim(),
        backgroundColor: sourceBg.trim(),
        alternateRowBackgroundColor: sourceAltRowBg.trim(),
        usePaging: sourceUsePaging,
        pagingLines: normalizeNonNegativeInteger(sourcePagingLines, 10),
        pagingTime: normalizeNonNegativeInteger(sourcePagingTime, 0),
        fontSize: sourceFontSize.trim(),
        fontWeight: sourceFontWeight.trim(),
        fontColor: sourceFontColor.trim(),
        columns: sourceColumns,
      }),
    );
  }, [
    open,
    visualizationId,
    listEntry?.name,
    normalized?.name,
    normalized?.backgroundColor,
    normalized?.alternateRowBackgroundColor,
    normalized?.usePaging,
    normalized?.pagingLines,
    normalized?.pagingTime,
    normalized?.fontSize,
    normalized?.fontWeight,
    normalized?.fontColor,
    normalized?.columns,
    isDirty,
  ]);

  // Beim Öffnen direkt das Namensfeld fokussieren.
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

  function updateColumnAt(index: number, patch: Partial<VisualizationColumn>) {
    setColumns((prev) => prev.map((col, i) => (i === index ? { ...col, ...patch } : col)));
  }

  function removeColumnAt(index: number) {
    setColumns((prev) => prev.filter((_, i) => i !== index));
  }

  function moveColumn(index: number, direction: -1 | 1) {
    setColumns((prev) => {
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;

      const next = prev.slice();
      const [item] = next.splice(index, 1);
      next.splice(targetIndex, 0, item);
      return next;
    });
  }

  function addColumn() {
    setColumns((prev) => [...prev, makeEmptyColumn()]);
  }

  function handleSave() {
    const id = visualizationId;
    if (!id) return;

    const trimmedName = name.trim();
    if (!trimmedName) return;

    // 1) Leichten Listen-Eintrag aktualisieren.
    // Dieser ist die primäre Quelle für den Namen in der Visualizations-Übersicht.
    saveVisualization(id, { name: trimmedName });

    // 2) Vollständiges Realtime-Dokument der Visualization aktualisieren.
    // Der Name wird dabei bewusst synchron zur Liste gehalten.
    update((prev) => {
      const current = normalizeFullVisualization(prev, id);

      const next: Partial<FullVisualization> = {
        ...current,
        id,
        name: trimmedName,
        backgroundColor: String(backgroundColor ?? "").trim() || "#000000",
        alternateRowBackgroundColor: String(alternateRowBackgroundColor ?? "").trim(),
        usePaging,
        pagingLines: normalizeNonNegativeInteger(pagingLines, 10),
        pagingTime: normalizeNonNegativeInteger(pagingTime, 0),
        fontSize: String(fontSize ?? "").trim() || "16px",
        fontWeight: String(fontWeight ?? "").trim() || "400",
        fontColor: String(fontColor ?? "").trim() || "#ffffff",
        columns: normalizeEditableColumns(columns),
      };

      return next;
    });

    // Neuen Zustand als gespeicherte Basis übernehmen.
    setBaseJson(draftJson);

    // UX: neu angelegte Visualization direkt aktiv setzen.
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

            <ColorField
              label="Alternate row background"
              value={alternateRowBackgroundColor}
              onChange={setAlternateRowBackgroundColor}
              helperText='Optional hex color, e.g. "#111111". Leave empty to disable.'
              pickerFallback="#111111"
            />

            <TextField
              label="Font size"
              value={fontSize}
              onChange={(e) => setFontSize(e.target.value)}
              fullWidth
              helperText='e.g. "16px"'
            />

            <TextField
              label="Font weight"
              value={fontWeight}
              onChange={(e) => setFontWeight(e.target.value)}
              fullWidth
              helperText='e.g. "400", "700", "normal" or "bold"'
            />

            <ColorField
              label="Font color"
              value={fontColor}
              onChange={setFontColor}
              helperText='Hex, e.g. "#ffffff"'
              pickerFallback="#ffffff"
            />
          </Stack>

          <Stack direction={{ xs: "column", sm: "row" }} spacing={3} sx={{ mb: 3 }}>
            <TextField
              select
              label="Use paging"
              value={usePaging ? "true" : "false"}
              onChange={(e) => setUsePaging(e.target.value === "true")}
              fullWidth
              helperText="Enable multi-page result display."
            >
              <MenuItem value="false">No</MenuItem>
              <MenuItem value="true">Yes</MenuItem>
            </TextField>

            <TextField
              label="Paging lines"
              value={pagingLines}
              onChange={(e) => setPagingLines(e.target.value)}
              fullWidth
              helperText='Number of visible rows per page, e.g. "10"'
            />

            <TextField
              label="Paging time (seconds)"
              value={pagingTime}
              onChange={(e) => setPagingTime(e.target.value)}
              fullWidth
              helperText='Seconds before auto page switch. Use "0" for no auto switch.'
            />
          </Stack>

          <Box sx={{ mb: 3 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
              <Typography variant="subtitle2">Columns</Typography>

              <IconButton
                size="small"
                onClick={(e) => setColumnsHelpAnchorEl(e.currentTarget)}
                aria-label="Column help"
              >
                <HelpOutlineIcon fontSize="small" />
              </IconButton>
            </Box>

            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
              Configure the table columns, placeholders and ordering for the visualization page.
            </Typography>

            <Stack spacing={1.5}>
              {columns.map((column, idx) => (
                <Stack key={idx} direction={{ xs: "column", md: "row" }} spacing={1.5} alignItems={{ md: "flex-start" }}>
                  <Stack direction={{ xs: "row", md: "column" }} spacing={1} sx={{ pt: { md: 0.5 } }}>
                    <IconButton
                      size="small"
                      onClick={() => moveColumn(idx, -1)}
                      disabled={idx === 0}
                      aria-label={`Move column ${idx + 1} up`}
                    >
                      <ArrowUpwardIcon fontSize="small" />
                    </IconButton>

                    <IconButton
                      size="small"
                      onClick={() => moveColumn(idx, 1)}
                      disabled={idx === columns.length - 1}
                      aria-label={`Move column ${idx + 1} down`}
                    >
                      <ArrowDownwardIcon fontSize="small" />
                    </IconButton>
                  </Stack>

                  <TextField
                    label="Column title"
                    value={column.columnTitle}
                    onChange={(e) => updateColumnAt(idx, { columnTitle: e.target.value })}
                    sx={{ width: { xs: "100%", md: 180 } }}
                    helperText='e.g. "Rank", "Bib", "Name"'
                  />

                  <TextField
                    label="Column width"
                    value={column.columnWidth}
                    onChange={(e) => updateColumnAt(idx, { columnWidth: e.target.value })}
                    sx={{ width: { xs: "100%", md: 180 } }}
                    helperText='e.g. "90px", "20%", "12rem"'
                  />

                  <TextField
                    select
                    label="Align"
                    value={column.columnAlign}
                    onChange={(e) => updateColumnAt(idx, { columnAlign: normalizeColumnAlign(e.target.value) })}
                    sx={{ width: { xs: "100%", md: 200 } }}
                    helperText="left, center or right"
                  >
                    <MenuItem value="left">Left</MenuItem>
                    <MenuItem value="center">Center</MenuItem>
                    <MenuItem value="right">Right</MenuItem>
                  </TextField>

                  <TextField
                    label="Fallback"
                    value={column.columnFallback}
                    onChange={(e) => updateColumnAt(idx, { columnFallback: e.target.value })}
                    sx={{ width: { xs: "100%", md: 160 } }}
                    helperText='shown if content resolves empty; e.g. "-"'
                  />

                  <TextField
                    label="Column content"
                    value={column.columnContent}
                    onChange={(e) => updateColumnAt(idx, { columnContent: e.target.value })}
                    fullWidth
                    helperText='e.g. "{{result.bib}}", "{{dynamicResult}}" or "{{athlete.firstName}} {{athlete.lastName}}"'
                  />

                  <IconButton
                    color="error"
                    onClick={() => removeColumnAt(idx)}
                    aria-label={`Remove column ${idx + 1}`}
                    sx={{ alignSelf: { xs: "flex-end", md: "flex-start" }, mt: { md: 0.5 } }}
                  >
                    <DeleteIcon />
                  </IconButton>
                </Stack>
              ))}

              <Box>
                <Button variant="outlined" onClick={addColumn}>
                  Add column
                </Button>
              </Box>
            </Stack>

            <Popover
              open={Boolean(columnsHelpAnchorEl)}
              anchorEl={columnsHelpAnchorEl}
              onClose={() => setColumnsHelpAnchorEl(null)}
              anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
              transformOrigin={{ vertical: "top", horizontal: "left" }}
            >
              <Box sx={{ p: 2, maxWidth: 520 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Available column templates
                </Typography>

                <Typography variant="body2" sx={{ mb: 1 }}>
                  Use placeholders in double curly braces. You can combine multiple placeholders, plain text and special cases like flags or dynamic results.
                </Typography>

                <Typography variant="body2" sx={{ mb: 0.5, fontWeight: 700 }}>
                  RaceResult fields
                </Typography>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  {"{{result.bib}}, {{result.rank}}, {{result.points}}, {{result.finishRank}}, {{result.finishTime}}, {{result.eliminated}}, {{result.eliminationLap}}, {{result.dns}}, {{result.dsq}}, {{result.lapsCompleted}}, {{dynamicResult}}"}
                </Typography>

                <Typography variant="body2" sx={{ mb: 0.5, fontWeight: 700 }}>
                  Athlete fields
                </Typography>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  {"{{athlete.firstName}}, {{athlete.lastName}}, {{athlete.bib}}, {{athlete.ageGroupId}}, {{athlete.nation}}, {{athlete.id}}"}
                </Typography>

                <Typography variant="body2" sx={{ mb: 0.5, fontWeight: 700 }}>
                  Column title
                </Typography>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  The title is plain text for the table header, e.g. "Rank", "Bib", "Name" or "Points".
                </Typography>

                <Typography variant="body2" sx={{ mb: 0.5, fontWeight: 700 }}>
                  Align, fallback, order, row styling and paging
                </Typography>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  Choose left, center or right alignment per column. If the rendered content is empty, the fallback text is shown instead. If no fallback is set, the cell stays empty. Use the arrow buttons to change the column order. The alternate row background color is optional and only applied when set. Font size, font weight and font color define the default typography for the visualization. Paging can limit the number of visible rows and optionally auto-switch pages after the configured number of seconds.
                </Typography>

                <Typography variant="body2" sx={{ mb: 0.5, fontWeight: 700 }}>
                  Nation flag special case
                </Typography>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  The placeholder {"{{athlete.nation}}"} renders the matching SVG flag from src/assets/flags when available, for example GER.svg. This also works inside mixed content like {"{{athlete.nation}} {{athlete.lastName}}"}.
                </Typography>

                <Typography variant="body2" sx={{ mb: 0.5, fontWeight: 700 }}>
                  Dynamic result special case
                </Typography>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  The placeholder {"{{dynamicResult}}"} reproduces the default last-column behavior. For points races it shows points, but still shows ELIM or DSQ when present. For non-points races it shows the finish time, but still shows ELIM or DSQ when present.
                </Typography>

                <Typography variant="body2" sx={{ mb: 0.5, fontWeight: 700 }}>
                  Keyboard paging controls
                </Typography>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  In the visualization display, Enter starts or stops the automatic page timer. Left/Up switches to the previous page, Right/Down switches to the next page.
                </Typography>

                <Typography variant="body2" sx={{ mb: 0.5, fontWeight: 700 }}>
                  Examples
                </Typography>
                <Typography variant="body2">
                  Title: Rank → Align: right → Content: {"{{result.rank}}"}
                </Typography>
                <Typography variant="body2">
                  Title: Name → Align: left → Content: {"{{athlete.firstName}} {{athlete.lastName}}"}
                </Typography>
                <Typography variant="body2">
                  Title: Nation → Content: {"{{athlete.nation}}"}
                </Typography>
                <Typography variant="body2">
                  Title: Rider → Content: {"{{athlete.nation}} {{athlete.lastName}}"}
                </Typography>
                <Typography variant="body2">
                  Title: Result → Align: right → Content: {"{{dynamicResult}}"}
                </Typography>
                <Typography variant="body2">
                  Title: Points → Align: right → Content: {"{{result.points}} Pts"}
                </Typography>
              </Box>
            </Popover>
          </Box>

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
