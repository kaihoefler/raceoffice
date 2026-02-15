import {
  Box,
  List,
  ListItem,
  ListItemText,
  Typography,
} from "@mui/material";

import type { Athlete } from "../types/athlete";

type Props = {
  starters: Athlete[];
  /** Bibs that are missing in the live status feed (highlighted in red). */
  missingInLiveBibs?: ReadonlySet<number>;
  /** Athlete IDs that should be highlighted as "selected". */
  selectedIds?: ReadonlySet<string>;
  /** Customize how a starter is displayed. */
  formatAthleteLabel?: (a: Athlete) => string;
  title?: string;
  maxHeight?: number;
};

function defaultAthleteLabel(a: Athlete) {
  return `${a.bib ?? ""} - ${(a.lastName ?? "").trim()} ${(a.firstName ?? "").trim()}`.trim();
}

export default function ScoringStarterList({
  starters,
  missingInLiveBibs,
  selectedIds,
  formatAthleteLabel,
  title = "Starters",
  maxHeight = 420,
}: Props) {
  const labelOf = formatAthleteLabel ?? defaultAthleteLabel;

  return (
    <Box sx={{ p: 2, border: "1px solid", borderColor: "divider", borderRadius: 1, minHeight: 0 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
        <Typography variant="subtitle2">{title}</Typography>
        <Typography variant="caption" color="text.secondary">
          {starters.length}
        </Typography>
      </Box>

      {starters.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No starters.
        </Typography>
      ) : (
        <List dense sx={{ maxHeight, overflow: "auto", py: 0 }}>
          {starters.map((a) => {
            const bib = a.bib ?? null;
            const missing = bib != null && missingInLiveBibs?.has(bib);
            const isSelected = selectedIds?.has(a.id) ?? false;

            return (
              <ListItem
                key={a.id}
                sx={{
                  px: 1,
                  borderRadius: 1,
                  bgcolor: isSelected ? "action.selected" : "transparent",
                }}
              >
                <ListItemText
                  primary={labelOf(a)}
                  slotProps={{
                    primary: {
                      variant: "body2",
                      sx: missing ? { color: "error.main", fontWeight: 700 } : undefined,
                    },
                  }}
                />
              </ListItem>
            );
          })}
        </List>
      )}
    </Box>
  );
}
