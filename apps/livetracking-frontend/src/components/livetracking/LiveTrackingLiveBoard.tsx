import { useMemo } from "react";

import { Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import type { LiveTrackingAthleteLiveState } from "@raceoffice/domain";

type SplitPointColumn = {
  id: string;
  name?: string | null;
};

type LiveTrackingLiveBoardProps = {
  athleteLiveStates: LiveTrackingAthleteLiveState[];
  resolveDisplayName: (row: LiveTrackingAthleteLiveState) => string;
  variant: "split-columns" | "split-inline";
  splitPoints?: SplitPointColumn[];
  timingPointLabelById?: Map<string, string>;
  emptyMessage?: string;
};

function formatMs(ms: number | null): string {
  if (ms == null) return "—";
  return `${Math.floor(ms / 1000)}.${String(ms % 1000).padStart(3, "0")}s`;
}

export default function LiveTrackingLiveBoard({
  athleteLiveStates,
  resolveDisplayName,
  variant,
  splitPoints = [],
  timingPointLabelById,
  emptyMessage = "No live athletes yet.",
}: LiveTrackingLiveBoardProps) {
  const rows = useMemo(() => {
    const filtered = [...athleteLiveStates].filter((row) => Boolean(row.lastPassingAt));
    filtered.sort((a, b) => {
      const ams = a.lastPassingAt ? Date.parse(a.lastPassingAt) : Number.NEGATIVE_INFINITY;
      const bms = b.lastPassingAt ? Date.parse(b.lastPassingAt) : Number.NEGATIVE_INFINITY;
      return bms - ams;
    });
    return filtered;
  }, [athleteLiveStates]);

  return (
    <Table size="small">
      <TableHead>
        {variant === "split-columns" ? (
          <TableRow>
            <TableCell>Athlete</TableCell>
            <TableCell>Status</TableCell>
            <TableCell align="right">Laps</TableCell>
            <TableCell align="right">Best lap</TableCell>
            <TableCell align="right">Last lap</TableCell>
            {splitPoints.map((point) => (
              <TableCell key={point.id} align="right">
                {String(point.name ?? "").trim() || point.id}
              </TableCell>
            ))}
          </TableRow>
        ) : (
          <TableRow>
            <TableCell>Athlete</TableCell>
            <TableCell>Status</TableCell>
            <TableCell align="right">Laps</TableCell>
            <TableCell align="right">Last Lap</TableCell>
            <TableCell align="right">Best Lap</TableCell>
            <TableCell>Splits (current lap)</TableCell>
          </TableRow>
        )}
      </TableHead>

      <TableBody>
        {rows.map((row) => {
          const splitByTimingPointId = new Map(row.currentLapSplits.map((split) => [split.timingPointId, split.splitTimeMs]));

          return (
            <TableRow key={row.athleteId}>
              <TableCell>{resolveDisplayName(row)}</TableCell>
              <TableCell>{row.activityStatus}</TableCell>
              <TableCell align="right">{row.lapsCompleted}</TableCell>

              {variant === "split-columns" ? (
                <>
                  <TableCell align="right">{formatMs(row.bestLapTimeMs)}</TableCell>
                  <TableCell align="right">{formatMs(row.lastLapTimeMs)}</TableCell>
                  {splitPoints.map((point) => (
                    <TableCell key={`${row.athleteId}:${point.id}`} align="right">
                      {formatMs(splitByTimingPointId.get(point.id) ?? null)}
                    </TableCell>
                  ))}
                </>
              ) : (
                <>
                  <TableCell align="right">{formatMs(row.lastLapTimeMs)}</TableCell>
                  <TableCell align="right">{formatMs(row.bestLapTimeMs)}</TableCell>
                  <TableCell>
                    {row.currentLapSplits.length > 0
                      ? row.currentLapSplits
                          .map((split) => `${timingPointLabelById?.get(split.timingPointId) ?? split.timingPointId}: ${formatMs(split.splitTimeMs)}`)
                          .join(" | ")
                      : "—"}
                  </TableCell>
                </>
              )}
            </TableRow>
          );
        })}

        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={variant === "split-columns" ? 5 + splitPoints.length : 6}>
              <Typography color="text.secondary">{emptyMessage}</Typography>
            </TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  );
}
