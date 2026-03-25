import { useEffect, useMemo, useState } from "react";

import {
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  TextField,
  Typography,
} from "@mui/material";

import type { Athlete } from "../types/athlete";

type PointsRemovalDialogRow = {
  key: string;
  bib: number;
  label: string;
  points: number;
};

type Props = {
  open: boolean;
  initialLap: number;
  starters: Athlete[];
  pointsByBib: ReadonlyMap<number, number>;
  formatAthleteLabel?: (a: Athlete) => string;
  onClose: () => void;
  onSave: (payload: { lap: number; bibs: number[] }) => Promise<void> | void;
};

function defaultAthleteLabel(a: Athlete): string {
  return `${a.bib ?? ""} - ${(a.lastName ?? "").trim()} ${(a.firstName ?? "").trim()}`.trim();
}

export default function PointsRemovalDialog({
  open,
  initialLap,
  starters,
  pointsByBib,
  formatAthleteLabel,
  onClose,
  onSave,
}: Props) {
  const [lap, setLap] = useState<number>(Math.max(1, Math.floor(Number(initialLap) || 1)));
  const [query, setQuery] = useState("");
  const [selectedBibs, setSelectedBibs] = useState<Set<number>>(new Set<number>());
  const [busy, setBusy] = useState(false);

  const labelOf = formatAthleteLabel ?? defaultAthleteLabel;

  const rows = useMemo<PointsRemovalDialogRow[]>(() => {
    const byBib = new Map<number, Athlete>();
    for (const a of Array.isArray(starters) ? starters : []) {
      if (typeof a?.bib === "number") byBib.set(a.bib, a);
    }

    const out: PointsRemovalDialogRow[] = [];
    for (const [bib, points] of pointsByBib.entries()) {
      if (!Number.isFinite(bib) || bib <= 0) continue;
      const p = Math.floor(Number(points));
      if (!Number.isFinite(p) || p <= 0) continue;

      const athlete = byBib.get(bib);
      out.push({
        key: athlete?.id ?? `unknown-${bib}`,
        bib,
        label: athlete ? labelOf(athlete) : `${bib} - Unknown starter`,
        points: p,
      });
    }

    out.sort((a, b) => {
      if (a.points !== b.points) return b.points - a.points;
      return a.bib - b.bib;
    });

    return out;
  }, [starters, pointsByBib, labelOf]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;

    return rows.filter((row) => {
      return String(row.bib).includes(q) || row.label.toLowerCase().includes(q);
    });
  }, [rows, query]);

  const selectedCount = selectedBibs.size;

  useEffect(() => {
    if (!open) return;
    setLap(Math.max(1, Math.floor(Number(initialLap) || 1)));
    setQuery("");
    setSelectedBibs(new Set<number>());
    setBusy(false);
  }, [open, initialLap]);

  function toggleBib(bib: number) {
    setSelectedBibs((prev) => {
      const next = new Set(prev);
      if (next.has(bib)) next.delete(bib);
      else next.add(bib);
      return next;
    });
  }

  async function handleSave() {
    if (busy) return;
    const bibs = Array.from(selectedBibs).sort((a, b) => a - b);
    if (!bibs.length) return;

    try {
      setBusy(true);
      await onSave({
        lap: Math.max(1, Math.floor(Number(lap) || 1)),
        bibs,
      });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      sx={{
        "& .MuiDialog-container": {
          alignItems: "flex-start",
          justifyContent: "flex-start",
          p: 2,
        },
      }}
    >
      <DialogTitle>Remove points</DialogTitle>

      <DialogContent>
        <DialogContentText sx={{ mb: 1.25 }}>
          Select riders whose loose their points up to and including the selected lap.
        </DialogContentText>

        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.25 }}>
          <TextField
            size="small"
            label="Lap"
            type="number"
            value={lap}
            onChange={(e) => setLap(Number(e.target.value))}
            slotProps={{ htmlInput: { min: 1, step: 1 } }}
            sx={{ width: 110 }}
          />

          <TextField
            size="small"
            label="Filter"
            placeholder="Bib or name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            sx={{ flex: 1, minWidth: 0 }}
          />

          <Chip size="small" variant="outlined" label={`${selectedCount} selected`} />
        </Box>

        {rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No riders with points.
          </Typography>
        ) : (
          <List dense sx={{ maxHeight: 360, overflow: "auto", py: 0 }}>
            {filteredRows.map((row) => {
              const checked = selectedBibs.has(row.bib);
              return (
                <ListItem key={row.key} disablePadding>
                  <ListItemButton onClick={() => toggleBib(row.bib)} dense>
                    <Checkbox edge="start" checked={checked} tabIndex={-1} disableRipple />
                    <ListItemText
                      primary={row.label}
                      secondary={`${row.points} ${row.points === 1 ? "Point" : "Points"}`}
                    />
                  </ListItemButton>
                </ListItem>
              );
            })}
          </List>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={handleSave} variant="contained" color="warning" disabled={busy || selectedCount === 0}>
          Remove points
        </Button>
      </DialogActions>
    </Dialog>
  );
}
