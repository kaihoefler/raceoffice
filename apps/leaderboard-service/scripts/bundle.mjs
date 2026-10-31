// apps/leaderboard-service/scripts/bundle.mjs
//
// Builds the self-contained release folder of the leaderboard service:
//
//   bundle/
//     package.json   name, version, "type": "module" (the bundle is ESM)
//     dist/index.js  service + @raceoffice/domain + @raceoffice/rmonitor + fastify in one file
//     public/        built leaderboard frontend (served under /ui/)
//     LICENSE        GPL-3.0-or-later (port of RMonitorLeaderboard)
//
// The layout matches the tsc build (dist/ next to public/), so the RaceOffice server's
// LeaderboardServiceManager finds `apps/leaderboard-service/dist/index.js` in the deploy tree
// unchanged, and the Docker image just copies this folder. No node_modules needed at runtime:
// all dependencies are pure JavaScript.
//
// Prerequisites: workspace packages built (`npm run build:packages`) and the frontend built into
// public/ (`npm run build:leaderboard-frontend`).

import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(pkgDir, "bundle");
const publicDir = path.join(pkgDir, "public");

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const pkg = JSON.parse(await fs.readFile(path.join(pkgDir, "package.json"), "utf8"));

  if (!(await exists(path.join(publicDir, "index.html")))) {
    throw new Error(`frontend missing: ${publicDir}/index.html – run "npm run build:leaderboard-frontend" first`);
  }

  await fs.rm(outDir, { recursive: true, force: true });

  await build({
    entryPoints: [path.join(pkgDir, "src", "index.ts")],
    outfile: path.join(outDir, "dist", "index.js"),
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    // Readable stack traces in the field matter more than a few hundred KB.
    minify: false,
    keepNames: true,
    legalComments: "eof",
    define: { __LEADERBOARD_VERSION__: JSON.stringify(pkg.version) },
    // ws loads these native accelerators optionally (try/require) and falls back without them.
    external: ["bufferutil", "utf-8-validate"],
    // CommonJS dependencies (fastify & co.) call require/__dirname; an ESM bundle has neither.
    banner: {
      js: [
        'import { createRequire as __createRequire } from "node:module";',
        'import { fileURLToPath as __fileURLToPath } from "node:url";',
        'import { dirname as __pathDirname } from "node:path";',
        "const require = __createRequire(import.meta.url);",
        "const __filename = __fileURLToPath(import.meta.url);",
        "const __dirname = __pathDirname(__filename);",
      ].join("\n"),
    },
    logLevel: "info",
  });

  await fs.cp(publicDir, path.join(outDir, "public"), { recursive: true });
  await fs.copyFile(path.join(pkgDir, "LICENSE"), path.join(outDir, "LICENSE"));
  await fs.writeFile(
    path.join(outDir, "package.json"),
    JSON.stringify(
      {
        name: pkg.name,
        version: pkg.version,
        description: pkg.description,
        license: pkg.license,
        private: true,
        type: "module",
        main: "dist/index.js",
        engines: pkg.engines,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(`leaderboard-service ${pkg.version} bundled: ${outDir}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
