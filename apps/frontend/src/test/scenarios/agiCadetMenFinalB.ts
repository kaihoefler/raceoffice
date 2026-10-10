// Feed states of the AGI 2024 Cadet Men 6000 Final B scenarios (elimination and points
// interpretation, see the *.md tables in this folder).
//
// States 1-33 and 35 are the recorded per-lap states. State 34 is added: the final order
// with flag GREEN, i.e. the moment the field has crossed the line before the timekeepers set
// FINISH. The per-lap recorder keeps only the last state of lap 30 (already FINISH), so this
// state is missing from the recording. It matters because the app switches live sync off on
// FINISH: the last sprint, the last DNF and the last elimination are scored in state 34.

import type { RaceStatusRace } from "@raceoffice/domain";
import { racesOf } from "@raceoffice/race-status-mock";
import { listRecordings, loadRecording } from "@raceoffice/race-status-mock/server";

export const RECORDING = "AGI-2024_race-11-Cadet-Men-6000-Elim-Final-B";
export const RACE_NAME = "Cadet Men 6000 Elim-Final B";

/** States 1..35 of the scenario tables (index 0 = state 1). */
export function scenarioStates(): RaceStatusRace[] {
  const file = listRecordings().find((f) => f.includes(RECORDING));
  if (!file) throw new Error(`Recording ${RECORDING} not found`);

  const recorded = racesOf(loadRecording(file)).map((r, i) => {
    if (!r) throw new Error(`Recorded state ${i + 1} has no active race`);
    return r;
  });

  const finish = recorded[recorded.length - 1]!;
  if (finish.flagStatus !== "FINISH") throw new Error("Last recorded state is expected to be FINISH");

  const finalOrderGreen: RaceStatusRace = { ...finish, flagStatus: "GREEN" };
  return [...recorded.slice(0, -1), finalOrderGreen, finish];
}
