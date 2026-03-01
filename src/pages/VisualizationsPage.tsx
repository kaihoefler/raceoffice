// src/pages/VisualizationsPage.tsx
//
// VisualizationsPage
// -----------------
// Analog zur EventsPage:
// - Listet Visualisierungen
// - Aktivieren / Löschen
// - Neue Visualisierung nur bei Bedarf anlegen (über + im Header), Eingabe erscheint dann am Ende der Liste

import { useEffect, useMemo, useRef, useState } from "react";

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
import EditIcon from "@mui/icons-material/Edit";
import DesktopWindowsIcon from "@mui/icons-material/DesktopWindows";

import VisualizationEditor from "../components/VisualizationEditor";

import type { Visualization } from "../types/visualization";

import { useVisualizationList } from "../providers/VisualizationListProvider";

export default function VisualizationsPage() {
  const { visualizationList, setActiveVisualization, saveVisualization, deleteVisualization } = useVisualizationList();

  const [editorMode, setEditorMode] = useState<"new" | "edit">("edit");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const newNameRef = useRef<HTMLInputElement | null>(null);

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
    if (!visualizationList) return;

    const name = newName.trim();
    if (!name) return;

    saveVisualization(null, { name });
    cancelCreate();
  }

  function handleDelete(v: Visualization) {
    if (!visualizationList) return;

    const ok = window.confirm(`Visualization "${v.name}" wirklich löschen?`);
    if (!ok) return;
    deleteVisualization(v);
  }

  function handleOpenVisualizer(visualizationId?: string | null) {
    // Opens the fullscreen visualization view in a new window/tab.
    // If visualizationId is provided, we open exactly that visualization.
    const id = String(visualizationId ?? "").trim();
    const url = id ? `/visualizer/${id}` : "/visualizer";
    window.open(url, "_blank", "noopener,noreferrer");
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
                  <TableRow key={v.id}>
                    <TableCell>
                      <Tooltip title={`ID: ${v.id}`} arrow>
                        <span>{v.name}</span>
                      </Tooltip>
                    </TableCell>

                    <TableCell align="center">
                      <Button
                        size="small"
                        onClick={() => setActiveVisualization(v.id)}
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
                        <IconButton
                          size="small"
                          onClick={() => handleOpenVisualizer(v.id)}
                          aria-label="Open visualizer"
                        >
                          <DesktopWindowsIcon />
                        </IconButton>
                      </Tooltip>

                      <Tooltip title="Edit" arrow>
                        <IconButton
                          size="small"
                          onClick={() => startEdit(v)}
                          aria-label="Edit visualization"
                          sx={{ ml: 0.5 }}
                        >
                          <EditIcon />
                        </IconButton>
                      </Tooltip>

                      <Tooltip title="Delete" arrow>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleDelete(v)}
                          aria-label="Delete visualization"
                          sx={{ ml: 0.5 }}
                        >
                          <DeleteIcon />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}

              {/* Create row (only visible after clicking +) */}
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
                        <IconButton
                          size="small"
                          onClick={handleCreate}
                          aria-label="Save visualization"
                          disabled={!newName.trim()}
                        >
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

              {rows.length === 0 && !createOpen ? (
                <TableRow>
                  <TableCell colSpan={3}>
                    <Typography color="text.secondary">No visualizations yet.</Typography>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Editor (rendered below the list) */}
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
