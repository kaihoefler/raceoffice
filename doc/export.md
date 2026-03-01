# Race Results CSV Export

This document describes the CSV export generated from the race results (`RaceResult`), as implemented in:

- `src/domain/raceResultsCsvExport.ts` (`buildRaceResultsCsv`)

## File name

The exported file name is built as:

```
{race.slug}_result.csv
```

Example:

```
junior_ladies_points_final_result.csv
```

## Encoding

- UTF-8
- The CSV content includes a UTF-8 BOM (`\uFEFF`) for better compatibility with Microsoft Excel.

## Separator

- Semicolon (`;`)

## Header row

The first row is always the header:

```
bib;rank;finish_time;points;eliminated;elimination_lap;laps_completed;dns;dsq;rank_at_finish;remark
```

## Column mapping

Each subsequent row represents one `RaceResult`.

| CSV column        | Source field / rule |
|------------------|---------------------|
| `bib`            | `RaceResult.bib` |
| `rank`           | `RaceResult.rank`, **but empty for DNS** (`dns === true`). If not DNS and `rank > 0` it is exported, otherwise empty. |
| `finish_time`    | `RaceResult.finishTime` (empty string if not present) |
| `points`         | `RaceResult.points` (defaults to `0`) |
| `eliminated`     | `RaceResult.eliminated` exported as `"true"` / `"false"` |
| `elimination_lap`| `RaceResult.eliminationLap` (defaults to `0`) |
| `laps_completed` | `RaceResult.lapsCompleted` (defaults to `0`) |
| `dns`            | `RaceResult.dns` exported as `"true"` / `"false"` |
| `dsq`            | `RaceResult.dsq` exported as `"true"` / `"false"` |
| `rank_at_finish` | `RaceResult.finishRank` if `finishRank > 0`, otherwise empty |
| `remark`         | `"DNS"` if `dns === true`, else `"DSQ"` if `dsq === true`, else empty |

## Sorting

Rows are exported in **standings order**, using the same sorting logic as in `src/domain/raceResultsActions.ts`:

- The export first runs `recomputeRaceResults(...)` to ensure `rank` values are consistent.
- Then it orders rows via `sortRaceResultsForStandings(...)` (same criteria as rank computation):
  1. Status bucket (best to worst):
     - normal
     - eliminated
     - DSQ
     - DNS
  2. `eliminationLap` (descending)
  3. `points` (descending)
  4. `finishRank` (ascending; `finishRank = 0` is treated as “no finish” and sorted last)
  5. Tie-breaker: `bib` ascending

## CSV escaping

Values are quoted using standard CSV quoting rules **only when needed**:

- Fields containing `"` or `;` or newlines are wrapped in double quotes
- Double quotes inside a quoted field are doubled (`"` → `""`)

## Example

Header:

```
bib;rank;finish_time;points;eliminated;elimination_lap;laps_completed;dns;dsq;rank_at_finish;remark
```

Example rows:

```
12;1;0:15,032;5;false;0;0;false;false;1;
34;;;
56;;"";0;false;0;0;true;false;;DNS
78;3;;0;false;0;0;false;true;;DSQ
```

(Example values are illustrative.)
