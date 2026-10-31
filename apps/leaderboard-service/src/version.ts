/**
 * Service version. The bundle (scripts/bundle.mjs) injects it at build time; the tsc build reads
 * package.json next to dist/.
 */
import { readFileSync } from "node:fs";

declare const __LEADERBOARD_VERSION__: string | undefined;

function readVersion(): string {
  if (typeof __LEADERBOARD_VERSION__ === "string") return __LEADERBOARD_VERSION__;
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const VERSION = readVersion();
