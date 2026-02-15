// src/components/RaceActivitiesList.tsx
import { useMemo, useState } from "react";
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";

import EditIcon from "@mui/icons-material/Edit";
import SaveIcon from "@mui/icons-material/Save";
import CloseIcon from "@mui/icons-material/Close";
import DeleteIcon from "@mui/icons-material/Delete";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";

import type { Race } from "../types/race";
import type { RaceActivity, RaceActivityElimination, RaceActivityPointsSprint } from "../types/raceactivities";

type Props = {
  race: Race;
  /** Persist the updated activity back into the race (should update realtime doc in the page) */
  onUpdateActivity: (updated: RaceActivity) => void;

  /**
   * Replace the full activities array (used by "Remove all activities").
   * Implement in the page by updating race.raceActivities = nextActivities.
   */
  onReplaceActivities: (nextActivities: RaceActivity[]) => void;
};

function lapOf(a: RaceActivity): number {
  const lap = (a as any)?.data?.lap;
  return Number.isFinite(Number(lap)) ? Number(lap) : 0;
}

function isPointsSprint(a: RaceActivity): a is RaceActivityPointsSprint {
  return a.type === "pointsSprint";
}

function isElimination(a: RaceActivity): a is RaceActivityElimination {
  return a.type === "elimination";
}

function formatPointsResults(results: Array<{ bib: number; points: number }>): string {
  return (results ?? []).map((r) => `${r.points}P:${r.bib}`).join(", ");
}

function parsePointsResults(input: string): Array<{ bib: number; points: number }> | null {
  const t = input.trim();
  if (!t) return [];

  const parts = t
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  const out: Array<{ bib: number; points: number }> = [];
  for (const p of parts) {
    // erwartet: "pointsP:bib" z.B. "1P:334"
    const [ptsStr, bibStr] = p.split("P:").map((x) => x.trim());
    const bib = Number(bibStr);
    const points = Number(ptsStr);
    if (!Number.isFinite(bib) || !Number.isFinite(points)) return null;
    out.push({ bib: Math.floor(bib), points: Math.floor(points) });
  }
  return out;
}

function formatEliminationResults(results: Array<{ bib: number }>): string {
  return (results ?? []).map((r) => String(r.bib)).join(", ");
}

function parseEliminationResults(input: string): Array<{ bib: number }> | null {
  const t = input.trim();
  if (!t) return [];

  const parts = t
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  const out: Array<{ bib: number }> = [];
  for (const p of parts) {
    const bib = Number(p);
    if (!Number.isFinite(bib)) return null;
    out.push({ bib: Math.floor(bib) });
  }
  return out;
}

function historyOf(a: RaceActivity): any[] {
  const h = (a as any)?.data?.history;
  return Array.isArray(h) ? h : [];
}

function formatHistoryLine(a: RaceActivity, h: any): string {
  const changedAt = String(h?.changedAt ?? "");
  const lap = Number.isFinite(Number(h?.lap)) ? Number(h.lap) : 0;
  const isDeleted = Boolean(h?.isDeleted);

  const resultsStr = isPointsSprint(a)
    ? formatPointsResults(h?.results ?? [])
    : isElimination(a)
      ? formatEliminationResults(h?.results ?? [])
      : "";

  const deletedStr = isDeleted ? " • deleted" : "";
  return `${changedAt} • Lap ${lap}${deletedStr}${resultsStr ? ` • ${resultsStr}` : ""}`;
}

export default function RaceActivitiesList({ race, onUpdateActivity, onReplaceActivities }: Props) {
  const activities = useMemo(() => {
    const list = Array.isArray((race as any)?.raceActivities) ? ((race as any).raceActivities as RaceActivity[]) : [];
    return [...list].sort((a, b) => {
      const la = lapOf(a);
      const lb = lapOf(b);
      if (la !== lb) return lb - la; // descending
      return String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""));
    });
  }, [race]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLap, setDraftLap] = useState<number>(1);
  const [draftDeleted, setDraftDeleted] = useState<boolean>(false);
  const [draftResults, setDraftResults] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  // NEW: remove-all confirmation
  const [removeAllOpen, setRemoveAllOpen] = useState(false);

  function startEdit(a: RaceActivity) {
    setEditingId(a.id);
    setError(null);

    setDraftLap(lapOf(a) || 1);
    setDraftDeleted(Boolean((a as any)?.data?.isDeleted));

    if (isPointsSprint(a)) {
      setDraftResults(formatPointsResults(a.data?.results ?? []));
      return;
    }

    if (isElimination(a)) {
      setDraftResults(formatEliminationResults((a.data as any)?.results ?? []));
      return;
    }

    setDraftResults("");
  }

  function cancelEdit() {
    setEditingId(null);
    setError(null);
  }

  function saveEdit(a: RaceActivity) {
    const nextLap = Math.max(0, Math.floor(Number(draftLap)));

    if (isPointsSprint(a)) {
      const nextResults = parsePointsResults(draftResults);
      if (nextResults === null) {
        setError("Invalid results format. Use: bib:points, bib:points");
        return;
      }

      const prevSnapshot = {
        changedAt: new Date().toISOString(),
        lap: a.data.lap,
        isDeleted: a.data.isDeleted,
        results: a.data.results,
      };
      const prevHistory = Array.isArray(a.data.history) ? a.data.history : [];

      const updated: RaceActivityPointsSprint = {
        ...a,
        data: {
          ...a.data,
          lap: nextLap,
          isDeleted: draftDeleted,
          results: nextResults,
          history: [prevSnapshot, ...prevHistory],
        },
      };

      onUpdateActivity(updated);
      cancelEdit();
      return;
    }

    if (isElimination(a)) {
      const nextResults = parseEliminationResults(draftResults);
      if (nextResults === null) {
        setError("Invalid results format. Use: pointsP:bib, pointsP:bib");
        return;
      }

      const prevSnapshot = {
        changedAt: new Date().toISOString(),
        lap: (a.data as any).lap,
        isDeleted: (a.data as any).isDeleted,
        results: (a.data as any).results,
      };
      const prevHistory = Array.isArray((a.data as any).history) ? (a.data as any).history : [];

      const updated: RaceActivityElimination = {
        ...a,
        data: {
          ...(a.data as any),
          lap: nextLap,
          isDeleted: draftDeleted,
          results: nextResults,
          history: [prevSnapshot, ...prevHistory],
        } as any,
      };

      onUpdateActivity(updated);
      cancelEdit();
      return;
    }

    setError("Editing not supported for this activity type");
  }

  function toggleDelete(a: RaceActivity) {
    const nextDeleted = !Boolean((a as any)?.data?.isDeleted);

    if (isPointsSprint(a)) {
      const prevSnapshot = {
        changedAt: new Date().toISOString(),
        lap: a.data.lap,
        isDeleted: a.data.isDeleted,
        results: a.data.results,
      };
      const prevHistory = Array.isArray(a.data.history) ? a.data.history : [];

      const updated: RaceActivityPointsSprint = {
        ...a,
        data: {
          ...a.data,
          isDeleted: nextDeleted,
          history: [prevSnapshot, ...prevHistory],
        },
      };

      onUpdateActivity(updated);
      return;
    }

    if (isElimination(a)) {
      const prevSnapshot = {
        changedAt: new Date().toISOString(),
        lap: (a.data as any).lap,
        isDeleted: (a.data as any).isDeleted,
        results: (a.data as any).results,
      };
      const prevHistory = Array.isArray((a.data as any).history) ? (a.data as any).history : [];

      const updated: RaceActivityElimination = {
        ...a,
        data: {
          ...(a.data as any),
          isDeleted: nextDeleted,
          history: [prevSnapshot, ...prevHistory],
        } as any,
      };

      onUpdateActivity(updated);
    }
  }

  function removeAllActivities() {
    // do NOT mark deleted; actually remove from race
    cancelEdit();
    onReplaceActivities([]);
    setRemoveAllOpen(false);
  }

  return (
    <Box sx={{ p: 2, border: "1px solid", borderColor: "divider", borderRadius: 1, minHeight: 0 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1, gap: 1 }}>
        <Box sx={{ display: "flex", alignItems: "baseline", gap: 1 }}>
          <Typography variant="subtitle2">Scoring Activities</Typography>
          <Typography variant="caption" color="text.secondary">
            {activities.length}
          </Typography>
        </Box>

        {/* NEW: remove all activities */}
        <Tooltip title="Remove all activities from this race" arrow>
          <span>
            <Button
              size="small"
              variant="outlined"
              color="error"
              startIcon={<DeleteSweepIcon />}
              disabled={activities.length === 0 || editingId != null}
              onClick={() => setRemoveAllOpen(true)}
            >
              Remove all
            </Button>
          </span>
        </Tooltip>
      </Box>

      {/* NEW: confirmation dialog */}
      <Dialog open={removeAllOpen} onClose={() => setRemoveAllOpen(false)}>
        <DialogTitle>Remove all activities?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will permanently remove <b>all</b> scoring activities from this race (count:{" "}
            <b>{activities.length}</b>).
            <br />
            <br />
            This does <b>not</b> mark them as deleted — it removes them from the race.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemoveAllOpen(false)}>Cancel</Button>
          <Button onClick={removeAllActivities} color="error" variant="contained" disabled={activities.length === 0}>
            Remove
          </Button>
        </DialogActions>
      </Dialog>

      {activities.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No activities.
        </Typography>
      ) : (
        <List dense sx={{ maxHeight: 420, overflow: "auto", py: 0 }}>
          {/* header */}
          <ListItem
            disableGutters
            sx={{
              px: 1,
              py: 0.5,
              borderBottom: "1px solid",
              borderColor: "divider",
              position: "sticky",
              top: 0,
              bgcolor: "background.paper",
              zIndex: 1,
            }}
          >
            <Box
              sx={{
                width: "100%",
                display: "grid",
                gridTemplateColumns: "28px 42px 1fr auto",
                columnGap: 1,
                alignItems: "center",
              }}
            >
              <Typography variant="caption" color="text.secondary">
                Lap
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Type
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Content
              </Typography>
              <Box />
            </Box>
          </ListItem>

          {activities.map((a) => {
            const isEditing = editingId === a.id;
            const lap = lapOf(a);
            const isDeleted = Boolean((a as any)?.data?.isDeleted);

            const label = isPointsSprint(a) ? "Points" : isElimination(a) ? "Elimination" : "Activity";

            const content = isPointsSprint(a)
              ? formatPointsResults(a.data?.results ?? [])
              : isElimination(a)
                ? formatEliminationResults((a.data as any)?.results ?? [])
                : "";

            const history = historyOf(a);
            const historyTitle = history.length ? (
              <Box sx={{ p: 0.5 }}>
                {history.slice(0, 10).map((h, idx) => (
                  <Typography key={idx} variant="caption" sx={{ display: "block" }}>
                    {formatHistoryLine(a, h)}
                  </Typography>
                ))}
                {history.length > 10 ? (
                  <Typography variant="caption" sx={{ display: "block" }}>
                    …and {history.length - 10} more
                  </Typography>
                ) : null}
              </Box>
            ) : (
              "No history"
            );

            return (
              <ListItem
                key={a.id}
                disableGutters
                sx={{
                  px: 1,
                  py: 0.75,
                  borderBottom: "1px solid",
                  borderColor: "divider",
                  bgcolor: isEditing ? "action.selected" : "transparent",
                }}
              >
                <Box
                  sx={{
                    width: "100%",
                    display: "grid",
                    gridTemplateColumns: "28px 42px 1fr auto",
                    columnGap: 1,
                    rowGap: 0.25,
                    alignItems: "center",
                  }}
                >
                  {/* row 1 */}
                  <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
                    {lap}
                  </Typography>

                  <Box sx={{ gridColumn: "2 / 4", display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                      {label}
                    </Typography>
                    {isDeleted ? <Chip size="small" label="deleted" color="warning" variant="outlined" /> : null}
                  </Box>

                  <Box sx={{ justifySelf: "end", alignSelf: "start" }}>
                    <Stack direction="row" spacing={0.1} sx={{ mt: 0.15 }}>
                      {isEditing ? (
                        <>
                          <Tooltip title="Save" arrow>
                            <span>
                              <IconButton size="small" onClick={() => saveEdit(a)} aria-label="Save activity">
                                <SaveIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                          <Tooltip title="Cancel" arrow>
                            <span>
                              <IconButton size="small" onClick={cancelEdit} aria-label="Cancel edit">
                                <CloseIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </>
                      ) : (
                        <Tooltip title="Edit" arrow>
                          <span>
                            <IconButton size="small" onClick={() => startEdit(a)} aria-label="Edit activity">
                              <EditIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      )}

                      <Tooltip title={isDeleted ? "Undelete" : "Delete"} arrow>
                        <span>
                          <IconButton
                            size="small"
                            onClick={() => toggleDelete(a)}
                            aria-label={isDeleted ? "Undelete activity" : "Delete activity"}
                            disabled={isEditing}
                            color={isDeleted ? "inherit" : "error"}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Stack>
                  </Box>

                  {/* row 2: content */}
                  <Box sx={{ gridColumn: "1 / 4", minWidth: 0 }}>
                    <Typography
                      variant="body2"
                      sx={{
                        minWidth: 0,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",

                        ...(isDeleted && {
                          textDecoration: "line-through",
                          color: "warning.main",
                        }),
                      }}
                    >
                      {content}
                    </Typography>
                  </Box>

                  {/* row 2: history (column 4) */}
                  <Box sx={{ gridColumn: "4 / 5", justifySelf: "end", alignSelf: "start" }}>
                    <Tooltip title={historyTitle} arrow placement="top-start">
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ whiteSpace: "nowrap", cursor: history.length ? "help" : "default" }}
                      >
                        History: {history.length}
                      </Typography>
                    </Tooltip>
                  </Box>

                  {/* row 3: edit panel */}
                  {isEditing ? (
                    <Box sx={{ gridColumn: "1 / 5", mt: 0.75, display: "flex", flexDirection: "column", gap: 1 }}>
                      <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                        <TextField
                          size="small"
                          label="Lap"
                          type="number"
                          value={draftLap}
                          onChange={(e) => setDraftLap(Number(e.target.value))}
                          sx={{ width: 110 }}
                        />
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                          <Typography variant="body2">Deleted</Typography>
                          <Switch size="small" checked={draftDeleted} onChange={(e) => setDraftDeleted(e.target.checked)} />
                        </Box>
                      </Box>

                      <TextField
                        size="small"
                        label={isPointsSprint(a) ? "Results (pointsP:bib, ...)" : "Results (bib, ...)"}
                        value={draftResults}
                        onChange={(e) => setDraftResults(e.target.value)}
                        fullWidth
                      />

                      {error ? (
                        <Typography variant="caption" color="error">
                          {error}
                        </Typography>
                      ) : null}
                    </Box>
                  ) : null}
                </Box>
              </ListItem>
            );
          })}
        </List>
      )}
    </Box>
  );
}
