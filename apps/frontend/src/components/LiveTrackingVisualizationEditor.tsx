import { useEffect, useMemo, useRef, useState } from "react";

import { Box, Button, Card, CardContent, CardHeader, Divider, InputAdornment, MenuItem, Stack, TextField, Typography } from "@mui/material";

import { useLiveTrackingVisualizationList } from "../providers/LiveTrackingVisualizationListProvider";
import { useRealtimeDoc } from "../realtime/useRealtimeDoc";
import type { FullLiveTrackingVisualization } from "../types/liveTrackingVisualization";

type Props = {
  open: boolean;
  visualizationId: string | null;
  onCancel: () => void;
  onAfterSave?: () => void;
};

function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(String(value ?? "").trim());
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

function normalizeFullLiveTrackingVisualization(raw: unknown, visualizationId: string): FullLiveTrackingVisualization {
  const obj = raw && typeof raw === "object" ? (raw as any) : {};

  return {
    id: typeof obj.id === "string" ? obj.id : visualizationId,
    name: typeof obj.name === "string" ? obj.name : "",
    backgroundColor: typeof obj.backgroundColor === "string" ? obj.backgroundColor : "#000000",
    alternateRowBackgroundColor: typeof obj.alternateRowBackgroundColor === "string" ? obj.alternateRowBackgroundColor : "",
    fontSize: typeof obj.fontSize === "string" ? obj.fontSize : "18px",
    fontWeight: typeof obj.fontWeight === "string" ? obj.fontWeight : "600",
    fontColor: typeof obj.fontColor === "string" ? obj.fontColor : "#ffffff",
    headerFontSize: typeof obj.headerFontSize === "string" ? obj.headerFontSize : "1.1em",
    activeStatusColor: typeof obj.activeStatusColor === "string" ? obj.activeStatusColor : "#22c55e",
    inactiveStatusColor: typeof obj.inactiveStatusColor === "string" ? obj.inactiveStatusColor : "#ef4444",
    qualificationRecentLines:
      typeof obj.qualificationRecentLines === "number" && Number.isFinite(obj.qualificationRecentLines)
        ? Math.max(1, Math.floor(obj.qualificationRecentLines))
        : 10,
    useQualificationPaging: typeof obj.useQualificationPaging === "boolean" ? obj.useQualificationPaging : false,
    qualificationPagingLines:
      typeof obj.qualificationPagingLines === "number" && Number.isFinite(obj.qualificationPagingLines)
        ? Math.max(1, Math.floor(obj.qualificationPagingLines))
        : 10,
    qualificationPagingTime:
      typeof obj.qualificationPagingTime === "number" && Number.isFinite(obj.qualificationPagingTime)
        ? Math.max(0, Math.floor(obj.qualificationPagingTime))
        : 0,
  };
}

export default function LiveTrackingVisualizationEditor({ open, visualizationId, onCancel, onAfterSave }: Props) {
  const { visualizationList, saveVisualization, setActiveVisualization } = useLiveTrackingVisualizationList();

  const docId = visualizationId ? `LiveTrackingVisualization-${visualizationId}` : null;
  const { data: raw, update, status, error } = useRealtimeDoc<Partial<FullLiveTrackingVisualization>>(docId);

  const listEntry = useMemo(() => {
    if (!visualizationId) return null;
    const list = Array.isArray(visualizationList?.visualizations) ? visualizationList.visualizations : [];
    return list.find((v) => v.id === visualizationId) ?? null;
  }, [visualizationList?.visualizations, visualizationId]);

  const normalized = useMemo(() => {
    if (!visualizationId) return null;
    return normalizeFullLiveTrackingVisualization(raw, visualizationId);
  }, [raw, visualizationId]);

  const [name, setName] = useState("");
  const [backgroundColor, setBackgroundColor] = useState("#000000");
  const [alternateRowBackgroundColor, setAlternateRowBackgroundColor] = useState("");
  const [fontSize, setFontSize] = useState("18px");
  const [fontWeight, setFontWeight] = useState("600");
  const [fontColor, setFontColor] = useState("#ffffff");
  const [headerFontSize, setHeaderFontSize] = useState("1.1em");
  const [activeStatusColor, setActiveStatusColor] = useState("#22c55e");
  const [inactiveStatusColor, setInactiveStatusColor] = useState("#ef4444");
  const [qualificationRecentLines, setQualificationRecentLines] = useState("10");
  const [useQualificationPaging, setUseQualificationPaging] = useState(false);
  const [qualificationPagingLines, setQualificationPagingLines] = useState("10");
  const [qualificationPagingTime, setQualificationPagingTime] = useState("0");

  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !visualizationId || !normalized) return;

    setName(String(listEntry?.name ?? normalized.name ?? ""));
    setBackgroundColor(normalized.backgroundColor);
    setAlternateRowBackgroundColor(normalized.alternateRowBackgroundColor);
    setFontSize(normalized.fontSize);
    setFontWeight(normalized.fontWeight);
    setFontColor(normalized.fontColor);
    setHeaderFontSize(normalized.headerFontSize);
    setActiveStatusColor(normalized.activeStatusColor);
    setInactiveStatusColor(normalized.inactiveStatusColor);
    setQualificationRecentLines(String(normalized.qualificationRecentLines));
    setUseQualificationPaging(normalized.useQualificationPaging);
    setQualificationPagingLines(String(normalized.qualificationPagingLines));
    setQualificationPagingTime(String(normalized.qualificationPagingTime));
  }, [open, visualizationId, normalized, listEntry?.name]);

  useEffect(() => {
    if (!open) return;
    setTimeout(() => nameInputRef.current?.focus(), 0);
  }, [open]);

  if (!open) return null;

  if (!visualizationId) {
    return (
      <Box sx={{ mt: 2 }}>
        <Card variant="outlined">
          <CardHeader title="Live Tracking Visualization" />
          <Divider />
          <CardContent>
            <Typography color="error">LiveTrackingVisualizationEditor requires a visualizationId.</Typography>
            <Button sx={{ mt: 2 }} variant="outlined" onClick={onCancel}>
              Close
            </Button>
          </CardContent>
        </Card>
      </Box>
    );
  }

  const stableVisualizationId = visualizationId;

  function handleSave() {
    const trimmedName = String(name ?? "").trim();
    if (!trimmedName) return;

    saveVisualization(stableVisualizationId, { name: trimmedName });

    update((prev) => {
      const current = normalizeFullLiveTrackingVisualization(prev, stableVisualizationId);
      return {
        ...current,
        id: stableVisualizationId,
        name: trimmedName,
        backgroundColor: String(backgroundColor ?? "").trim() || "#000000",
        alternateRowBackgroundColor: String(alternateRowBackgroundColor ?? "").trim(),
        fontSize: String(fontSize ?? "").trim() || "18px",
        fontWeight: String(fontWeight ?? "").trim() || "600",
        fontColor: String(fontColor ?? "").trim() || "#ffffff",
        headerFontSize: String(headerFontSize ?? "").trim() || "1.1em",
        activeStatusColor: String(activeStatusColor ?? "").trim() || "#22c55e",
        inactiveStatusColor: String(inactiveStatusColor ?? "").trim() || "#ef4444",
        qualificationRecentLines: Math.max(1, Math.floor(Number(qualificationRecentLines) || 10)),
        useQualificationPaging,
        qualificationPagingLines: Math.max(1, Math.floor(Number(qualificationPagingLines) || 10)),
        qualificationPagingTime: Math.max(0, Math.floor(Number(qualificationPagingTime) || 0)),
      };
    });

    setActiveVisualization(stableVisualizationId);
    onAfterSave?.();
  }

  return (
    <Box sx={{ mt: 2 }}>
      <Card variant="outlined">
        <CardHeader
          title="Edit Live Tracking Visualization"
          subheader={
            <Typography variant="caption" color={error ? "error" : "text.secondary"}>
              Realtime: {status}
              {error ? ` (${error})` : ""}
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

            <TextField label="ID" value={stableVisualizationId} fullWidth variant="filled" disabled />
          </Stack>

          <Stack spacing={2} sx={{ mb: 3 }}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <ColorField label="Background color" value={backgroundColor} onChange={setBackgroundColor} pickerFallback="#000000" />
              <ColorField
                label="Alternate row background"
                value={alternateRowBackgroundColor}
                onChange={setAlternateRowBackgroundColor}
                helperText='Optional hex color (empty = disabled)'
                pickerFallback="#111111"
              />
            </Stack>

            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField label="Font size" value={fontSize} onChange={(e) => setFontSize(e.target.value)} fullWidth helperText='e.g. "18px"' />
              <TextField
                label="Font weight"
                value={fontWeight}
                onChange={(e) => setFontWeight(e.target.value)}
                fullWidth
                helperText='e.g. "600", "700" or "bold"'
              />
              <ColorField label="Font color" value={fontColor} onChange={setFontColor} pickerFallback="#ffffff" />
              <TextField
                label="Header font size"
                value={headerFontSize}
                onChange={(e) => setHeaderFontSize(e.target.value)}
                fullWidth
                helperText='e.g. "1.1em" or "20px"'
              />
            </Stack>

            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <ColorField label="Active status color" value={activeStatusColor} onChange={setActiveStatusColor} pickerFallback="#22c55e" />
              <ColorField label="Inactive status color" value={inactiveStatusColor} onChange={setInactiveStatusColor} pickerFallback="#ef4444" />
            </Stack>

            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                label="Qualification live lines"
                value={qualificationRecentLines}
                onChange={(e) => setQualificationRecentLines(e.target.value)}
                fullWidth
                helperText="Visible rows in the left qualification table"
              />
              <TextField
                select
                label="Qualification ranking paging"
                value={useQualificationPaging ? "true" : "false"}
                onChange={(e) => setUseQualificationPaging(e.target.value === "true")}
                fullWidth
                helperText="Enable paging in right qualification table"
              >
                <MenuItem value="false">No</MenuItem>
                <MenuItem value="true">Yes</MenuItem>
              </TextField>
              <TextField
                label="Qualification paging lines"
                value={qualificationPagingLines}
                onChange={(e) => setQualificationPagingLines(e.target.value)}
                fullWidth
                helperText="Rows per page in right qualification table"
              />
              <TextField
                label="Qualification paging time (seconds)"
                value={qualificationPagingTime}
                onChange={(e) => setQualificationPagingTime(e.target.value)}
                fullWidth
                helperText='Seconds before auto page switch. Use "0" for no auto switch.'
              />
            </Stack>
          </Stack>

          <Stack direction="row" spacing={1}>
            <Button variant="contained" onClick={handleSave} disabled={!name.trim()}>
              Save
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
