# Recordings of real races

Each `*.jsonl` file is one race recorded from the timing system's live feed with

```sh
npm run record:race-status -- --url http://<timing-host>:8080/races?filter=current \
  --out packages/race-status-mock/recordings/<event>-<race>.jsonl [--anonymize]
```

One line per **scoring-relevant change** of the feed: `{"t": <ms since start>, "payload": <raw feed response>}`.
Relevant are the active race, flag, race lap counter and per rider bib, position, laps, total time and name
(`relevantStateKey` in `src/recording.ts`). Clock-only changes (`elapsedTime`, `timeOfDay`) are skipped;
in a real race that drops about 9 of 10 responses. Older raw recordings can be reduced with `compactRecording`.

The recorder can be started before the feed is up (e.g. before a replay player): it retries once per second for
`--wait` seconds (default 30) and gives up with an error if the feed never answers. Recording time `t` starts with
the first answer. Short outages during the recording are logged and tolerated.

With `--per-lap` the recorder keeps **one state per race lap**: the last relevant state before the next lap starts
(the field after the last position change of that lap). A lap counter correction (lap 1 → 0 → 1) keeps its own
states. The running lap is held back until the next lap starts and is written when the recorder is stopped with
Ctrl+C; closing the terminal window instead loses it. Same rule for existing files: `compactRecordingPerLap`.
Use it when tests only need the field per lap; states within a lap (e.g. an elimination moment) are dropped.

Real feeds are not "clean": e.g. right after the start a finish-line passing can be recorded by mistake and is then
deleted by the timekeepers, so rider laps drop from 1 back to 0. Keep such recordings; that is what they are for.

Usage:
- `apps/frontend/src/domain/liveScoring.recordings.test.ts` runs every state of every file here through the live scoring rules (invariants). New files are picked up automatically.
- Tests can pick single states: `findRace(loadRecording(file), (r) => r.lapsComplete === 12)`.
- Manual testing: `npm run mock:race-status -- --recording <file> [--speed 4]` replays a race for the real frontend.

Naming: `<yyyy-mm-dd>-<event>-<race>.jsonl`, e.g. `2026-10-11-cup-juniors-ladies-elim-final-a.jsonl`.
Use `--anonymize` unless it is fine to keep athletes' names in the repository.
Keep recordings to the races that are actually needed; every changed state stores the full field.
