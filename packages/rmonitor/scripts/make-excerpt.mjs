#!/usr/bin/env node
/**
 * Cuts an anonymized excerpt out of a (local) recording, so it can be committed as a fixture.
 *
 *   node scripts/make-excerpt.mjs <source.txt> <out.txt> <from>-<to> [<from>-<to> ...]
 *
 * - Line ranges are 1-based and inclusive; several ranges are concatenated.
 * - Timestamps are rebased: the excerpt starts at 0, a further range continues 1 s after the
 *   previous one (the relative timing inside a range is kept).
 * - Works on bytes (latin1 view), so the original encoding of every line is preserved.
 * - Anonymization of `$A`/`$COMP`: first name → "Rider<reg>", last name → "Name<reg>", a
 *   nation suffix like " (GER)" is kept. Non-ASCII byte sequences of the original name are
 *   appended unchanged (e.g. "Rider3é"), so encoding behavior stays testable without
 *   publishing names. Race names, bibs and times are not personal and stay as they are.
 */
import { readFile, writeFile } from "node:fs/promises";

import { parseRecordingBytes, tokenize } from "../dist/index.js";

const [source, out, ...ranges] = process.argv.slice(2);
if (!source || !out || ranges.length === 0) {
  console.error("usage: make-excerpt.mjs <source.txt> <out.txt> <from>-<to> [<from>-<to> ...]");
  process.exit(1);
}

const entries = parseRecordingBytes(await readFile(source));
const byLine = new Map(entries.map((e) => [e.lineNumber, e]));
const output = [];
let base = 0;

for (const range of ranges) {
  const [from, to] = range.split("-").map(Number);
  if (!(from > 0 && to >= from)) throw new Error(`invalid range ${range}`);
  const selected = [];
  for (let n = from; n <= to; n++) {
    const entry = byLine.get(n);
    if (entry) selected.push(entry);
  }
  if (selected.length === 0) continue;
  const start = selected[0].offsetMs;
  for (const e of selected) {
    // latin1 = 1 char per byte; round-trips arbitrary bytes.
    const raw = anonymize(Buffer.from(e.raw).toString("latin1"));
    output.push(`${base + e.offsetMs - start} ${raw}`);
  }
  base += selected.at(-1).offsetMs - start + 1000;
}

await writeFile(out, Buffer.from(`${output.join("\r\n")}\r\n`, "latin1"));
console.log(`${out}: ${output.length} lines`);

function anonymize(raw) {
  const t = tokenize(raw);
  if (t[0] === "$A" && t.length >= 8) {
    const [, reg, num, trans, first, last, nat, cls] = t;
    return `$A,"${reg}","${num}",${trans},"${rider(reg, first)}","${name(reg, last)}","${nat}",${cls}`;
  }
  if (t[0] === "$COMP" && t.length >= 8) {
    const [, reg, num, cls, first, last, nat, add] = t;
    return `$COMP,"${reg}","${num}",${cls},"${rider(reg, first)}","${name(reg, last)}","${nat}","${add}"`;
  }
  return raw;
}

function nonAscii(value) {
  return (value.match(/[\u0080-ÿ]+/g) ?? []).join("");
}

function rider(reg, first) {
  return first === "" ? "" : `Rider${reg}${nonAscii(first)}`;
}

function name(reg, last) {
  if (last === "") return "";
  const suffix = / \([A-Z]{3}\)$/.exec(last)?.[0] ?? "";
  return `Name${reg}${nonAscii(last.slice(0, last.length - suffix.length))}${suffix}`;
}
