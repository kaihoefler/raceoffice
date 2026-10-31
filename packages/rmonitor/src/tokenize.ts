/**
 * CSV tokenizer for RMonitor lines.
 *
 * Mirrors the Java reference (Apache commons-text `StringTokenizer` with delimiter `,`,
 * quote `"`, empty tokens kept, no trimming):
 * - a `"` toggles quoting anywhere in a token; inside quotes `""` is a literal quote
 * - empty tokens are kept (`a,,b` → ["a", "", "b"]), a trailing comma yields a trailing ""
 * - whitespace is significant (Orbits pads flags to 6 chars, e.g. `"Green "`)
 * - an empty line yields no tokens
 *
 * Orbits quotes inconsistently (`$A,"679","679",NK-04720,...`), so quoted and unquoted
 * tokens must be treated the same.
 */
export function tokenize(line: string): string[] {
  const tokens: string[] = [];
  if (line.length === 0) return tokens;

  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      tokens.push(current);
      current = "";
    } else {
      current += ch;
    }
  }

  tokens.push(current);
  return tokens;
}
