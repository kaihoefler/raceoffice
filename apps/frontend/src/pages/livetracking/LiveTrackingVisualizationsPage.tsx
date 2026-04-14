import { useMemo, useRef, useState } from "react";

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

import LiveTrackingVisualizationEditor from "../../components/livetracking/LiveTrackingVisualizationEditor";
import { useLiveTrackingVisualizationList } from "../../providers/LiveTrackingVisualizationListProvider";
import type { LiveTrackingVisualization } from "../../types/liveTrackingVisualization";

export default function LiveTrackingVisualizationsPage() {
  const { visualizationList, setActiveVisualization, saveVisualization, deleteVisualization } = useLiveTrackingVisualizationList();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const newNameRef = useRef<HTMLInputElement | null>(null);

  const rows = useMemo(() => {
    const list = Array.isArray(visualizationList?.visualizations) ? visualizationList.visualizations : [];
    return [...list];
  }, [visualizationList?.visualizations]);

  if (!visualizationList) return null;

  function openVisualizer(visualizationId?: string | null) {
    const id = String(visualizationId ?? "").trim();
    const url = id ? `/live-tracking/visualizer/${id}` : "/live-tracking/visualizer";
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function startEdit(v: LiveTrackingVisualization) {
    setEditingId(v.id);
    setShowEditor(true);
  }

  function resetEditor() {
    setShowEditor(false);
    setEditingId(null);
  }

  function cancelCreate() {
    setCreateOpen(false);
    setNewName("");
  }

  function handleCreate() {
    const name = newName.trim();
    if (!name) return;

    const id = crypto.randomUUID();
    saveVisualization(id, { name });
    setEditingId(id);
    setShowEditor(true);
    cancelCreate();
  }

  function handleDelete(v: LiveTrackingVisualization) {
    const ok = window.confirm(`Visualization "${v.name}" wirklich löschen?`);
    if (!ok) return;
    deleteVisualization(v);
  }

  return (
    <Box>
      <Card variant="outlined">
        <CardHeader
          title="Live Tracking Visualizations"
          action={
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <Tooltip title="Open visualizer (new window)" arrow>
                <span>
                  <IconButton
                    aria-label="Open visualizer"
                    onClick={() => openVisualizer(visualizationList.activeVisualizationId)}
                    disabled={!visualizationList.activeVisualizationId}
                  >
                    <DesktopWindowsIcon />
                  </IconButton>
                </span>
              </Tooltip>

              <Tooltip title="New visualization" arrow>
                <span>
                  <IconButton
                    aria-label="New visualization"
                    onClick={() => {
                      setCreateOpen(true);
                      setTimeout(() => newNameRef.current?.focus(), 0);
                    }}
                    disabled={createOpen}
                  >
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
                        <IconButton size="small" onClick={() => openVisualizer(v.id)} aria-label="Open visualizer">
                          <DesktopWindowsIcon />
                        </IconButton>
                      </Tooltip>

                      <Tooltip title="Edit" arrow>
                        <IconButton size="small" onClick={() => startEdit(v)} aria-label="Edit visualization" sx={{ ml: 0.5 }}>
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

      <LiveTrackingVisualizationEditor
        key={editingId ?? "none"}
        open={showEditor}
        visualizationId={editingId}
        onCancel={resetEditor}
        onAfterSave={resetEditor}
      />
    </Box>
  );
}
