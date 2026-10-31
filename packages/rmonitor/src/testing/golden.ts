/**
 * Shared pieces of the golden tests: checkpoint selection, the golden file format and
 * normalization for comparing the Java reference with the TypeScript port.
 *
 * Used by the generator script (scripts/generate-golden.mjs, feeds the Java app) and by the
 * vitest suite (replays the same lines through RaceStateStore).
 */
import { tokenize } from "../tokenize.js";
import { compareCompetitorTO, type CompetitorTO, type RaceTO } from "../state/toRaceTO.js";

export type CheckpointOptions = {
  /** Additional checkpoint every n lines. Default 1000. */
  interval?: number;
};

/**
 * Selects the points ("after n lines") at which the state is compared:
 * - after every `$B` and `$I` (race changes; repeated ones included, they are part of the behavior)
 * - after every `$F` whose flag differs from the previous `$F`
 * - every `interval` lines
 * - after the last line
 * Returns ascending, unique line counts (1-based: "after n lines").
 */
export function selectCheckpoints(messages: readonly string[], options: CheckpointOptions = {}): number[] {
  const interval = Math.max(1, options.interval ?? 1000);
  const points = new Set<number>();
  let lastFlag: string | null = null;

  messages.forEach((raw, index) => {
    const afterLines = index + 1;
    const tokens = tokenize(raw);
    const prefix = tokens[0];
    if (prefix === "$B" || prefix === "$I") points.add(afterLines);
    if (prefix === "$F") {
      const flag = (tokens[5] ?? "").trim().toUpperCase();
      if (lastFlag !== null && flag !== lastFlag) points.add(afterLines);
      lastFlag = flag;
    }
    if (afterLines % interval === 0) points.add(afterLines);
  });
  if (messages.length > 0) points.add(messages.length);

  return [...points].sort((a, b) => a - b);
}

/** One reference snapshot taken from the Java app. */
export type GoldenCheckpoint = {
  /** Number of recording lines sent before the snapshot. */
  afterLines: number;
  /** Raw line that was sent last (for readable diffs). */
  lastLine: string;
  /** Java `GET /races?filter=current` → its single element. */
  current: RaceTO;
  /** Java `GET /races`; only stored at race changes and at the end to keep files small. */
  races?: RaceTO[];
};

export type GoldenFile = {
  recording: string;
  reference: string;
  encoding: string;
  generatedAt: string;
  lineCount: number;
  checkpoints: GoldenCheckpoint[];
};

/** Competitor order is not part of the contract (Java: HashMap order); sort for comparison. */
export function normalizeRaceTO(race: RaceTO): RaceTO {
  return { ...race, competitors: [...race.competitors].sort(compareForNormalize) };
}

export function normalizeRaces(races: readonly RaceTO[]): RaceTO[] {
  return races.map(normalizeRaceTO).sort((a, b) => a.raceID - b.raceID);
}

function compareForNormalize(a: CompetitorTO, b: CompetitorTO): number {
  const c = compareCompetitorTO(a, b);
  if (c !== 0) return c;
  // Unclassified competitors may share an empty number; fall back to the full content.
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  return ja < jb ? -1 : ja > jb ? 1 : 0;
}
