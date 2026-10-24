import { useMemo } from "react";

import { Box, Chip, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import type { LiveTrackingRuntimePassingEvent } from "@raceoffice/domain";

type TimingPointColumn = {
  id: string;
  label: string;
};

type LiveTrackingPassingLogProps = {
  /** Raw decoder passings (runtime.recentPassings), oldest first. */
  passings: LiveTrackingRuntimePassingEvent[];
  /** Timing points in track order; one list per point. */
  timingPoints: TimingPointColumn[];
  /** Athlete name for a transponder, or undefined if the transponder is not in the pool. */
  resolveAthleteName: (transponderId: string) => string | undefined;
  /** Passings shown per timing point. */
  limit?: number;
};

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  const time = date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  return `${time}.${String(date.getMilliseconds()).padStart(3, "0")}`;
}

/**
 * Raw passing log per decoder (timing point), newest first. Unlike the live board this shows
 * every accepted decoder read, including unknown transponders, so the operator can check that
 * each loop actually reads.
 */
export default function LiveTrackingPassingLog({
  passings,
  timingPoints,
  resolveAthleteName,
  limit = 20,
}: LiveTrackingPassingLogProps) {
  const columns = useMemo(() => {
    const byTimingPointId = new Map<string, LiveTrackingRuntimePassingEvent[]>();
    // Iterate newest first so each list fills up with the latest passings.
    for (let i = passings.length - 1; i >= 0; i -= 1) {
      const passing = passings[i]!;
      const list = byTimingPointId.get(passing.timingPointId) ?? [];
      if (list.length >= limit) continue;
      list.push(passing);
      byTimingPointId.set(passing.timingPointId, list);
    }

    const known = new Set(timingPoints.map((point) => point.id));
    // Passings of points no longer in the setup stay visible instead of silently disappearing.
    const orphans = [...byTimingPointId.keys()].filter((id) => !known.has(id)).map((id) => ({ id, label: id }));

    return [...timingPoints, ...orphans].map((point) => ({ ...point, passings: byTimingPointId.get(point.id) ?? [] }));
  }, [passings, timingPoints, limit]);

  if (columns.length === 0) {
    return <Typography color="text.secondary">No timing points configured.</Typography>;
  }

  return (
    <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
      {columns.map((column) => (
        <Box key={column.id}>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            {column.label}
          </Typography>
          <Table size="small" aria-label={`Passings ${column.label}`}>
            <TableHead>
              <TableRow>
                <TableCell>Time</TableCell>
                <TableCell>Athlete / Transponder</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {column.passings.map((passing) => {
                if (passing.signalKind === "start_signal") {
                  return (
                    <TableRow key={passing.id}>
                      <TableCell sx={{ fontFamily: "monospace", whiteSpace: "nowrap" }}>{formatTime(passing.timestamp)}</TableCell>
                      <TableCell>
                        <Chip label="Start signal" size="small" color="info" variant="outlined" />
                        <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                          {passing.transponderId}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  );
                }
                const name = resolveAthleteName(passing.transponderId);
                return (
                  <TableRow key={passing.id}>
                    <TableCell sx={{ fontFamily: "monospace", whiteSpace: "nowrap" }}>{formatTime(passing.timestamp)}</TableCell>
                    <TableCell>
                      {name ?? passing.transponderId}
                      {name ? (
                        <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                          {passing.transponderId}
                        </Typography>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
              {column.passings.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2}>
                    <Typography variant="body2" color="text.secondary">No passings yet.</Typography>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </Box>
      ))}
    </Box>
  );
}
