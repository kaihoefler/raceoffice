import { useState } from "react";

import { Box, Tab, Tabs } from "@mui/material";

import PointsScoring from "../../components/PointsScoring";
import FinishLineScoring from "../../components/FinishLineScoring";
import EliminationScoring from "../../components/EliminationScoring";
import LiveRaceStatus from "../../components/LiveRaceStatus";

import { useScoringViewModel } from "./ScoringViewModel";

import type { AgeGroup, Athlete, Race, RaceActivity, RaceResult } from "@raceoffice/domain";
import type { RaceDraft } from "../../components/RaceEditor";

type Props = {
  race: Race;
  activeEventId: string;
  ageGroups: AgeGroup[];
  onInsertRaceStarters: (incoming: Athlete[]) => void;
  onDeleteStarter: (starter: Athlete) => void;
  onAddRaceActivity: (activity: RaceActivity) => void;
  onAddRaceActivities: (activities: RaceActivity[]) => void;
  onChangeRaceResults: (nextResults: RaceResult[]) => void;
  onCreateRaceFromLive: (draft: RaceDraft, starters: Athlete[]) => void;
};

export default function ScoringLiveColumns({
  race,
  activeEventId,
  ageGroups,
  onInsertRaceStarters,
  onDeleteStarter,
  onAddRaceActivity,
  onAddRaceActivities,
  onChangeRaceResults,
  onCreateRaceFromLive,
}: Props) {
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [col1Tab, setCol1Tab] = useState<"points" | "finish" | "elimination">("points");

  const vm = useScoringViewModel(race, syncEnabled);

  function handleCreateMissingStartersFromLive() {
    const missing = vm.getMissingStarterBibsFromLive();
    if (!missing.length) return;
    onInsertRaceStarters(missing);
  }

  async function handleCreateStartersForBibs(bibs: number[]) {
    const toAdd = vm.buildStartersForBibs(bibs);
    if (!toAdd.length) return;
    onInsertRaceStarters(toAdd);
  }

  return (
    <>
      <Box
        sx={{
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 1,
          minHeight: 0,
          order: { xs: 1, md: 1 },
          gridColumn: { md: 1 },
        }}
      >
        <Tabs
          value={col1Tab}
          onChange={(_, v) => setCol1Tab(v)}
          variant="fullWidth"
          sx={{ borderBottom: "1px solid", borderColor: "divider" }}
        >
          <Tab value="points" label="Points" />
          <Tab value="finish" label="Finish" />
          <Tab value="elimination" label="Elimination" />
        </Tabs>

        <Box sx={{ p: 1 }}>
          {col1Tab === "points" ? (
            <PointsScoring
              race={race}
              resetKey={race.id}
              onAddRaceActivity={onAddRaceActivity}
              onCreateStarters={handleCreateStartersForBibs}
              onDeleteStarter={onDeleteStarter}
              missingInLiveBibs={vm.missingInLiveBibs}
              blockedBibs={vm.blockedBibs}
              syncEnabled={vm.syncEnabled}
              liveLapCount={vm.liveLapCount}
              liveLapsToGo={vm.liveLapsToGo}
              liveTopBibs={vm.liveTopBibs}
            />
          ) : col1Tab === "finish" ? (
            <FinishLineScoring
              race={race}
              resetKey={race.id}
              onChangeRaceResults={onChangeRaceResults}
              onCreateStarters={handleCreateStartersForBibs}
              onDeleteStarter={onDeleteStarter}
              missingInLiveBibs={vm.missingInLiveBibs}
              blockedBibs={vm.blockedBibs}
            />
          ) : (
            <EliminationScoring
              race={race}
              resetKey={race.id}
              onAddRaceActivity={onAddRaceActivity}
              onAddRaceActivities={onAddRaceActivities}
              onCreateStarters={handleCreateStartersForBibs}
              onDeleteStarter={onDeleteStarter}
              missingInLiveBibs={vm.missingInLiveBibs}
              blockedBibs={vm.blockedBibs}
              syncEnabled={vm.syncEnabled}
              liveLapCount={vm.liveLapCount}
              liveLastEligibleBibs={vm.liveLastEligibleBibs}
              liveZeroLapBibs={vm.liveZeroLapBibs}
              liveDnfSuggestedBibs={vm.liveDnfSuggestedBibs}
            />
          )}
        </Box>
      </Box>

      <Box
        sx={{
          order: { xs: 4, md: 4 },
          gridColumn: { md: 4 },
          minWidth: 0,
        }}
      >
        <LiveRaceStatus
          unknownLiveBibs={vm.unknownLiveBibs}
          onCreateStarters={handleCreateMissingStartersFromLive}
          syncEnabled={syncEnabled}
          onSyncEnabledChange={setSyncEnabled}
          raceResults={race.raceResults}
          eventId={activeEventId}
          ageGroups={ageGroups}
          onCreateRaceFromLive={onCreateRaceFromLive}
        />
      </Box>
    </>
  );
}
