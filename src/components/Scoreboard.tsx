import { useMemo } from "react";
import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";

export type ScoreboardRow = {
  place: number;
  bib: number;
  points: number;
};

type Props = {
  standings: ScoreboardRow[];
  title?: string;
  /** If provided, the table becomes scrollable within this max height. */
  maxHeight?: number;
};

export default function Scoreboard({ standings, title = "Scoreboard", maxHeight = 520 }: Props) {
  const rows = useMemo(() => standings.filter((r) => (r.points ?? 0) > 0), [standings]);

  return (
    <Box sx={{ p: 2, border: "1px solid", borderColor: "divider", borderRadius: 1, minWidth: 0 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
        <Typography variant="subtitle2">{title}</Typography>
        <Typography variant="caption" color="text.secondary">
          {rows.length}
        </Typography>
      </Box>

      {rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No points yet.
        </Typography>
      ) : (
        <TableContainer sx={{ maxHeight, overflow: "auto" }}>
            <Table size="small" stickyHeader aria-label="scoreboard"
              sx={{
                "& th, & td": {
                  px: 0.5, // horizontal padding (default is ~2)
                  py: 0.5, // vertical padding
                },
              }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 44, fontWeight: 700 }}>Place</TableCell>
                <TableCell sx={{ width: 52, fontWeight: 700 }}>BIB</TableCell>
                <TableCell sx={{ width: 52, fontWeight: 700 }} align="right">
                  Points
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.bib} hover>
                  <TableCell>{r.place}</TableCell>
                  <TableCell>{r.bib}</TableCell>
                  <TableCell align="right">{r.points}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
