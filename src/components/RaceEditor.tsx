// src/components/RaceEditor.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Checkbox,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
} from "@mui/material";

import type { AgeGroup } from "../types/agegroup";
import type { Race } from "../types/race";

type RaceMode = Race["racemode"];
type RaceStage = Race["stage"];

export type RaceDraft = {
  id: string;
  eventId: string;

  ageGroupId: string;
  racemode: RaceMode;

  stage: RaceStage;
  stage_value: string;
  distance_value: string;

  name: string;
};

type Props = {
  open: boolean;
  mode: "new" | "edit";
  eventId: string;
  ageGroups: AgeGroup[];
  /**
   * Can be:
   * - the existing race when editing
   * - a template race when creating a "next" race from an existing one
   */
  initialRace: Race | null;

  onSave: (draft: RaceDraft) => void;
  onCancel: () => void;
};

function titleCaseStage(stage: RaceStage): string {
  if (stage === "") return "";
  if (stage === "heat") return "Heat";
  if (stage === "final") return "Final";
  return "Qualifying";
}

function formatGender(g: AgeGroup["gender"]): string {
  if (g === "men") return "Men";
  if (g === "ladies") return "Ladies";
  return "Mixed";
}

function formatRaceMode(mode: RaceMode): string {
  const parts: string[] = [];
  if (mode?.isPointsRace) parts.push("Points");
  if (mode?.isEliminationRace) parts.push("Elimination");
  return parts.length ? parts.join(" ") : "";
}

function buildAutoName(opts: {
  ageGroup: AgeGroup | null;
  distance_value: string;
  racemode: RaceMode;
  stage: RaceStage;
  stage_value: string;
}): string {
  const ag = opts.ageGroup;
  const agPart = ag ? `${ag.name} ${formatGender(ag.gender)}`.trim() : "Unknown age group";

  const distance = opts.distance_value.trim();
  const mode = formatRaceMode(opts.racemode);

  const parts: string[] = [agPart, distance, mode].filter((x) => x && x.length > 0);

  if (opts.stage !== "") {
    const stage = titleCaseStage(opts.stage);
    const stageValue = opts.stage_value.trim();
    if (stage) parts.push(stage);
    if (stageValue) parts.push(stageValue);
  }

  return parts.join(" ").trim();
}

export default function RaceEditor({ open, mode, eventId, ageGroups, initialRace, onSave, onCancel }: Props) {
  const nameInputRef = useRef<HTMLInputElement>(null);

  const [raceId, setRaceId] = useState<string>(crypto.randomUUID());

  const [ageGroupId, setAgeGroupId] = useState<string>(ageGroups[0]?.id ?? "");
  const [stage, setStage] = useState<RaceStage>("heat");
  const [stageValue, setStageValue] = useState<string>("");
  const [distanceValue, setDistanceValue] = useState<string>("");

  const [raceMode, setRaceMode] = useState<RaceMode>({ isPointsRace: false, isEliminationRace: false });

  const [name, setName] = useState<string>("");
  const [nameLocked, setNameLocked] = useState<boolean>(false);

  const ageGroup = useMemo(() => ageGroups.find((ag) => ag.id === ageGroupId) ?? null, [ageGroups, ageGroupId]);

  const autoName = useMemo(
    () =>
      buildAutoName({
        ageGroup,
        distance_value: distanceValue,
        racemode: raceMode,
        stage,
        stage_value: stageValue,
      }),
    [ageGroup, distanceValue, raceMode, stage, stageValue]
  );

  // Initialize whenever we open / switch initialRace / mode
  useEffect(() => {
    if (!open) return;

    // NEW: in "new" mode, always generate a fresh id even if we got a template race
    const nextRaceId = mode === "new" ? crypto.randomUUID() : initialRace?.id ?? crypto.randomUUID();
    setRaceId(nextRaceId);

    const nextAgeGroupId = initialRace?.ageGroupId ?? (ageGroups[0]?.id ?? "");
    setAgeGroupId(nextAgeGroupId);

    setStage(initialRace?.stage ?? "heat");
    setStageValue(initialRace?.stage_value ?? "");
    setDistanceValue(initialRace?.distance_value ?? "");
    setRaceMode(initialRace?.racemode ?? { isPointsRace: false, isEliminationRace: false });

    if (mode === "new") {
      // For new (incl. "copy/next"), let the name be auto-managed by default
      setNameLocked(false);
      setName(""); // will be filled by autoName effect
    } else {
      const initialName = initialRace?.name ?? "";
      setName(initialName);

      const initialAg = ageGroups.find((ag) => ag.id === nextAgeGroupId) ?? null;
      const computedAtOpen = buildAutoName({
        ageGroup: initialAg,
        distance_value: initialRace?.distance_value ?? "",
        racemode: initialRace?.racemode ?? { isPointsRace: false, isEliminationRace: false },
        stage: initialRace?.stage ?? "heat",
        stage_value: initialRace?.stage_value ?? "",
      });

      setNameLocked(initialName.trim().length > 0 && initialName.trim() !== computedAtOpen.trim());
    }

    setTimeout(() => nameInputRef.current?.focus(), 0);
  }, [open, mode, initialRace, ageGroups]);

  // Auto-update name when fields change, but only if name is not locked.
  useEffect(() => {
    if (!open) return;
    if (nameLocked) return;
    setName(autoName);
  }, [open, autoName, nameLocked]);

  if (!open) return null;

  const showRefreshName = name.trim() !== autoName.trim();
  const canSave = !!ageGroupId && !!name.trim();

  function handleRefreshName() {
    setName(autoName);
    setNameLocked(false);
  }

  function handleSave() {
    if (!canSave) return;

    onSave({
      id: raceId,
      eventId,
      ageGroupId,
      racemode: raceMode,
      stage,
      stage_value: stage === "" ? "" : stageValue, // safety
      distance_value: distanceValue,
      name: name.trim(),
    });
  }

  return (
    <Box sx={{ mt: 3 }}>
      <Card variant="outlined">
        <CardHeader title={mode === "edit" ? "Edit Race" : "New Race"} />
        <Divider />
        <CardContent>
          <Stack spacing={2}>
            <FormControl size="small" fullWidth>
              <InputLabel>Age Group</InputLabel>
              <Select
                size="small"
                label="Age Group"
                value={ageGroupId}
                onChange={(e) => setAgeGroupId(e.target.value)}
              >
                {ageGroups.map((ag) => (
                  <MenuItem key={ag.id} value={ag.id}>
                    {ag.name} ({ag.gender})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <FormControl size="small" fullWidth>
                <InputLabel>Stage</InputLabel>
                <Select
                  size="small"
                  label="Stage"
                  value={stage}
                  onChange={(e) => {
                    const nextStage = e.target.value as RaceStage;
                    setStage(nextStage);
                    if (nextStage === "") setStageValue("");
                  }}
                >
                  <MenuItem value="">(none)</MenuItem>
                  <MenuItem value="heat">heat</MenuItem>
                  <MenuItem value="qualifying">qualifying</MenuItem>
                  <MenuItem value="final">final</MenuItem>
                </Select>
              </FormControl>

              <TextField
                size="small"
                label="Stage value"
                value={stageValue}
                onChange={(e) => setStageValue(e.target.value)}  // FIX: was incorrectly setting stage
                fullWidth
                placeholder='e.g. "1", "2", "A"'
                disabled={stage === ""}
              />

              <TextField
                size="small"
                label="Distance"
                value={distanceValue}
                onChange={(e) => setDistanceValue(e.target.value)}
                fullWidth
                placeholder='e.g. "5k", "200m"'
              />
            </Stack>

            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={!!raceMode.isPointsRace}
                    onChange={(e) => setRaceMode((m) => ({ ...m, isPointsRace: e.target.checked }))}
                  />
                }
                label="Points"
              />

              <FormControlLabel
                control={
                  <Checkbox
                    checked={!!raceMode.isEliminationRace}
                    onChange={(e) => setRaceMode((m) => ({ ...m, isEliminationRace: e.target.checked }))}
                  />
                }
                label="Elimination"
              />
            </Stack>

            <TextField
              size="small"
              label="Name"
              value={name}
              inputRef={nameInputRef}
              onChange={(e) => {
                setName(e.target.value);
                setNameLocked(true);
              }}
              fullWidth
              helperText={
                showRefreshName ? `Auto name would be: "${autoName}"` : "Name is auto-generated from the fields above."
              }
            />

            <Stack direction="row" spacing={1} alignItems="center">
              {showRefreshName && (
                <Button variant="outlined" onClick={handleRefreshName}>
                  Refresh name
                </Button>
              )}

              <Box sx={{ flex: 1 }} />

              <Button variant="contained" onClick={handleSave} disabled={!canSave}>
                {mode === "edit" ? "Update" : "Create"}
              </Button>

              <Button variant="outlined" onClick={onCancel}>
                Cancel
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}