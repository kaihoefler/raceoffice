// src/pages/VisualizationsPage.tsx
//
// VisualizationsPage
// -----------------
// Analog zur EventsPage:
// - Listet Visualisierungen
// - Aktivieren / Löschen
// - Neue Visualisierung nur bei Bedarf anlegen (über + im Header), Eingabe erscheint dann am Ende der Liste
// - Export je Zeile als <Name>.visualization.json
// - Import über Button im Header

import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

import {
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Divider,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";

import AddIcon from "@mui/icons-material/Add";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import DeleteIcon from "@mui/icons-material/Delete";
import DesktopWindowsIcon from "@mui/icons-material/DesktopWindows";
import EditIcon from "@mui/icons-material/Edit";
import FileDownloadIcon from "@mui/icons-material/FileDownload";
import FileUploadIcon from "@mui/icons-material/FileUpload";

import VisualizationEditor from "../components/VisualizationEditor";

import type { FullVisualization, Visualization } from "../types/visualization";

import { useVisualizationList } from "../providers/VisualizationListProvider";
import { useRealtimeDoc } from "../realtime/useRealtimeDoc";

function sanitizeFileName(input: string): string {
  return (
    String(input ?? "")
      .trim()
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, " ")
      .slice(0, 120) || "visualization"
  );
}

function normalizeImportedFullVisualization(raw: unknown, fallback: { id: string; name: string }): FullVisualization {
  const obj = raw && typeof raw === "object" ? (raw as any) : {};

  return {
    id: typeof obj.id === "string" && obj.id.trim() ? obj.id.trim() : fallback.id,
    name: typeof obj.name === "string" && obj.name.trim() ? obj.name.trim() : fallback.name,
    backgroundColor: typeof obj.backgroundColor === "string" ? obj.backgroundColor : "#000000",
    alternateRowBackgroundColor: typeof obj.alternateRowBackgroundColor === "string" ? obj.alternateRowBackgroundColor : "",
    usePaging: Boolean(obj.usePaging),
    showSkippedRowsIndicator: Boolean(obj.showSkippedRowsIndicator),
    pagingLines: Number.isFinite(Number(obj.pagingLines)) ? Math.max(0, Math.floor(Number(obj.pagingLines))) : 10,
    pagingTime: Number.isFinite(Number(obj.pagingTime)) ? Math.max(0, Math.floor(Number(obj.pagingTime))) : 0,
    fontSize: typeof obj.fontSize === "string" ? obj.fontSize : "16px",
    fontWeight: typeof obj.fontWeight === "string" ? obj.fontWeight : "400",
    fontColor: typeof obj.fontColor === "string" ? obj.fontColor : "#ffffff",
    showFooter: Boolean(obj.showFooter),
    footerBackgroundColor: typeof obj.footerBackgroundColor === "string" ? obj.footerBackgroundColor : "#111111",
    pageMarginTop: Number.isFinite(Number(obj.pageMarginTop)) ? Math.max(0, Math.floor(Number(obj.pageMarginTop))) : 48,
    pageMarginRight: Number.isFinite(Number(obj.pageMarginRight)) ? Math.max(0, Math.floor(Number(obj.pageMarginRight))) : 48,
    pageMarginBottom: Number.isFinite(Number(obj.pageMarginBottom)) ? Math.max(0, Math.floor(Number(obj.pageMarginBottom))) : 32,
    pageMarginLeft: Number.isFinite(Number(obj.pageMarginLeft)) ? Math.max(0, Math.floor(Number(obj.pageMarginLeft))) : 48,
    columns: Array.isArray(obj.columns) ? obj.columns : [],
  };
}

function VisualizationRow({
  visualization,
  isActive,
  onActivate,
  onOpenVisualizer,
  onEdit,
  onDelete,
}: {
  visualization: Visualization;
  isActive: boolean;
  onActivate: (id: string) => void;
  onOpenVisualizer: (id: string) => void;
  onEdit: (v: Visualization) => void;
  onDelete: (v: Visualization) => void;
}) {
  const { data: rawFullVisualization } = useRealtimeDoc<Partial<FullVisualization>>(`Visualization-${visualization.id}`);

  function handleExport() {
    const payload = normalizeImportedFullVisualization(rawFullVisualization, {
      id: visualization.id,
      name: visualization.name,
    });

    const fileName = `${sanitizeFileName(visualization.name)}.visualization.json`;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
  }

  return (
    <TableRow key={visualization.id}>
      <TableCell>
        <Tooltip title={`ID: ${visualization.id}`} arrow>
          <span>{visualization.name}</span>
        </Tooltip>
      </TableCell>

      <TableCell align="center">
        <Button
          size="small"
          onClick={() => onActivate(visualization.id)}
          disabled={isActive}
          variant="outlined"
          color={isActive ? "success" : "primary"}
          sx={
            isActive
              ? {
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

      <TableCell align="right">
        <Tooltip title="Open visualizer (new window)" arrow>
          <IconButton size="small" onClick={() => onOpenVisualizer(visualization.id)} aria-label="Open visualizer">
            <DesktopWindowsIcon />
          </IconButton>
        </Tooltip>

        <Tooltip title="Export visualization" arrow>
          <IconButton size="small" onClick={handleExport} aria-label="Export visualization" sx={{ ml: 0.5 }}>
            <FileDownloadIcon />
          </IconButton>
        </Tooltip>

        <Tooltip title="Edit" arrow>
          <IconButton size="small" onClick={() => onEdit(visualization)} aria-label="Edit visualization" sx={{ ml: 0.5 }}>
            <EditIcon />
          </IconButton>
        </Tooltip>

        <Tooltip title="Delete" arrow>
          <IconButton
            size="small"
            color="error"
            onClick={() => onDelete(visualization)}
            aria-label="Delete visualization"
            sx={{ ml: 0.5 }}
          >
            <DeleteIcon />
          </IconButton>
        </Tooltip>
      </TableCell>
    </TableRow>
  );
}

export default function VisualizationsPage() {
  const { visualizationList, setActiveVisualization, saveVisualization, deleteVisualization } = useVisualizationList();

  const [editorMode, setEditorMode] = useState<"new" | "edit">("edit");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const newNameRef = useRef<HTMLInputElement | null>(null);

  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [importTargetVisualizationId, setImportTargetVisualizationId] = useState<string | null>(null);
  const [pendingImportedFullVisualization, setPendingImportedFullVisualization] = useState<FullVisualization | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);

  const rows = useMemo(() => {
    const list = Array.isArray(visualizationList?.visualizations) ? visualizationList.visualizations : [];
    // Keep stored order (new items are appended by the provider).
    return [...list];
  }, [visualizationList?.visualizations]);

  useEffect(() => {
    if (!createOpen) return;
    // Focus input when opening the create row.
    newNameRef.current?.focus();
  }, [createOpen]);

  const importDocId = importTargetVisualizationId ? `Visualization-${importTargetVisualizationId}` : null;
  const { data: importTargetDocData, update: updateImportTargetDoc } = useRealtimeDoc<Partial<FullVisualization>>(importDocId);

  useEffect(() => {
    if (!pendingImportedFullVisualization) return;
    if (!importTargetVisualizationId) return;
    if (importTargetDocData == null) return;

    updateImportTargetDoc(() => ({
      ...pendingImportedFullVisualization,
      id: importTargetVisualizationId,
    }));

    setImportSuccess(`Imported visualization "${pendingImportedFullVisualization.name}".`);
    setPendingImportedFullVisualization(null);
    setImportTargetVisualizationId(null);
  }, [pendingImportedFullVisualization, importTargetVisualizationId, importTargetDocData, updateImportTargetDoc]);

  useEffect(() => {
    if (!importSuccess) return;
    const t = window.setTimeout(() => setImportSuccess(null), 3500);
    return () => window.clearTimeout(t);
  }, [importSuccess]);

  // IMPORTANT: Keep hooks unconditionally called (React rule of hooks).
  if (!visualizationList) return null;

  function startCreate() {
    setCreateOpen(true);
  }

  function startEdit(v: Visualization) {
    setEditorMode("edit");
    setEditingId(v.id);
    setShowEditor(true);
  }

  function startImport() {
    importInputRef.current?.click();
  }

  function resetEditor() {
    setShowEditor(false);
    setEditingId(null);
    setEditorMode("edit");
  }

  function cancelCreate() {
    setCreateOpen(false);
    setNewName("");
  }

  function handleCreate() {
    const name = newName.trim();
    if (!name) return;

    saveVisualization(null, { name });
    cancelCreate();
  }

  function handleDelete(v: Visualization) {
    const ok = window.confirm(`Visualization "${v.name}" wirklich löschen?`);
    if (!ok) return;
    deleteVisualization(v);
  }

  function handleOpenVisualizer(visualizationId?: string | null) {
    const id = String(visualizationId ?? "").trim();
    const url = id ? `/visualizer/${id}` : "/visualizer";
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function handleImportFile(e: ChangeEvent<HTMLInputElement>) {
    try {
      setImportError(null);
      setImportSuccess(null);

      const file = e.target.files?.[0];
      if (!file) return;

      const text = await file.text();
      const raw = JSON.parse(text);
      const fallbackName = file.name.replace(/\.visualization\.json$/i, "").trim() || "Imported visualization";

      const parsed = normalizeImportedFullVisualization(raw, {
        id: crypto.randomUUID(),
        name: fallbackName,
      });

      const existingIds = new Set(rows.map((x) => x.id));
      const importedId = existingIds.has(parsed.id) ? crypto.randomUUID() : parsed.id;

      saveVisualization(importedId, { name: parsed.name });
      setPendingImportedFullVisualization({ ...parsed, id: importedId });
      setImportTargetVisualizationId(importedId);
    } catch (err) {
      setImportError(`Import failed: ${String((err as Error)?.message ?? err)}`);
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  return (
    <Box>
      <Card variant="outlined">
        <CardHeader
          title="Visualizations"
          action={
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <Tooltip title="Open visualizer (new window)" arrow>
                <span>
                  <IconButton
                    aria-label="Open visualizer"
                    onClick={() => handleOpenVisualizer(visualizationList.activeVisualizationId)}
                    disabled={!visualizationList.activeVisualizationId}
                  >
                    <DesktopWindowsIcon />
                  </IconButton>
                </span>
              </Tooltip>

              <Tooltip title="Import visualization" arrow>
                <span>
                  <IconButton aria-label="Import visualization" onClick={startImport}>
                    <FileUploadIcon />
                  </IconButton>
                </span>
              </Tooltip>

              <Tooltip title="New visualization" arrow>
                <span>
                  <IconButton aria-label="New visualization" onClick={startCreate} disabled={createOpen}>
                    <AddIcon />
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
          }
        />
        <Divider />

        <CardContent>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,.visualization.json,application/json"
            style={{ display: "none" }}
            onChange={(e) => void handleImportFile(e)}
          />

          {importError ? (
            <Typography color="error" variant="body2" sx={{ mb: 1 }}>
              {importError}
            </Typography>
          ) : null}

          {importSuccess ? (
            <Typography color="success.main" variant="body2" sx={{ mb: 1 }}>
              {importSuccess}
            </Typography>
          ) : null}

          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell align="center">Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>

            <TableBody>
              {rows.map((v) => {
                const isActive = visualizationList.activeVisualizationId === v.id;

                return (
                  <VisualizationRow
                    key={v.id}
                    visualization={v}
                    isActive={isActive}
                    onActivate={setActiveVisualization}
                    onOpenVisualizer={handleOpenVisualizer}
                    onEdit={startEdit}
                    onDelete={handleDelete}
                  />
                );
              })}

              {createOpen ? (
                <TableRow>
                  <TableCell>
                    <TextField
                      inputRef={newNameRef}
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      size="small"
                      placeholder="New visualization name…"
                      fullWidth
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleCreate();
                        if (e.key === "Escape") cancelCreate();
                      }}
                    />
                  </TableCell>

                  <TableCell align="center">
                    <Button size="small" variant="outlined" disabled>
                      —
                    </Button>
                  </TableCell>

                  <TableCell align="right">
                    <Tooltip title="Save" arrow>
                      <span>
                        <IconButton size="small" onClick={handleCreate} aria-label="Save visualization" disabled={!newName.trim()}>
                          <CheckIcon />
                        </IconButton>
                      </span>
                    </Tooltip>

                    <Tooltip title="Cancel" arrow>
                      <IconButton size="small" onClick={cancelCreate} aria-label="Cancel create" sx={{ ml: 0.5 }}>
                        <CloseIcon />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ) : null}

              {rows.length === 0 && !createOpen ?
                (
                  <TableRow>
                    <TableCell colSpan={3}>
                      <Typography color="text.secondary">No visualizations yet.</Typography>
                    </TableCell>
                  </TableRow>
                )
                : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <VisualizationEditor
        key={`${editingId ?? "none"}:${editorMode}`}
        open={showEditor}
        mode={editorMode}
        visualizationId={editingId}
        onCancel={resetEditor}
        onAfterSave={resetEditor}
      />
    </Box>
  );
}
