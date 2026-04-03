// scripts/deploy.mjs
//
// Build + package helper for copy-based deployments.
//
// What it does (high level):
// 1) Build frontend + backend
// 2) Create clean ./deploy folder
// 3) Copy runtime server artifacts
// 4) Install production-only node_modules into deploy/server
// 5) Optionally copy portable Node + WinSW from ./tools
// 6) Emit default WinSW XML + next-step instructions if needed

import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

// Run a shell command and stream output directly to the current terminal.
function run(cmd, opts = {}) {
  execSync(cmd, { stdio: "inherit", ...opts });
}

// Small async exists helper (for optional files/tools).
async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// Copy directory with replacement semantics.
// Destination is removed first to avoid stale files from previous deploys.
async function copyDir(src, dst) {
  await fs.rm(dst, { recursive: true, force: true });
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.cp(src, dst, { recursive: true });
}

// Copy file only when present.
// Returns true when copied, false when source does not exist.
async function copyFileIfExists(src, dst) {
  if (!(await exists(src))) return false;
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.copyFile(src, dst);
  return true;
}

async function main() {
  const repoRoot = process.cwd();

  const deployDir = path.join(repoRoot, "deploy");
  const serverSrcDir = path.join(repoRoot, "apps", "server");
  const serverOutDir = path.join(deployDir, "server");

  console.log("\n== RaceOffice deploy ==\n");

  // 1) Build everything
  run("npm run build:all");

  // 2) Recreate deploy folder
  await fs.rm(deployDir, { recursive: true, force: true });
  await fs.mkdir(serverOutDir, { recursive: true });

  // 3) Copy server artifacts
  await copyDir(path.join(serverSrcDir, "dist"), path.join(serverOutDir, "dist"));
  await copyDir(path.join(serverSrcDir, "public"), path.join(serverOutDir, "public"));

  // Needed so deploy/server can run npm ci / npm install locally.
  await copyFileIfExists(path.join(serverSrcDir, "package.json"), path.join(serverOutDir, "package.json"));
  await copyFileIfExists(path.join(serverSrcDir, "package-lock.json"), path.join(serverOutDir, "package-lock.json"));

  // 4) Install production dependencies into deploy/server/node_modules.
  // Prefer npm ci when lockfile exists for deterministic installs.
  const lockPresent = fsSync.existsSync(path.join(serverOutDir, "package-lock.json"));
  run(lockPresent ? "npm ci --omit=dev" : "npm install --omit=dev", { cwd: serverOutDir });

  // 5) Create standard runtime folders used by service/default config.
  await fs.mkdir(path.join(serverOutDir, "logs"), { recursive: true });
  await fs.mkdir(path.join(serverOutDir, "node"), { recursive: true });
  await fs.mkdir(path.join(serverOutDir, "winsw"), { recursive: true });

  // 6) Optional: copy portable Node runtime + WinSW if provided under ./tools.
  // Place these manually (not committed):
  // - tools/node/node.exe
  // - tools/winsw/RaceOfficeServer.exe
  // - tools/winsw/RaceOfficeServer.xml
  const copiedNode = await copyFileIfExists(
    path.join(repoRoot, "tools", "node", "node.exe"),
    path.join(serverOutDir, "node", "node.exe")
  );

  const copiedWinSwExe = await copyFileIfExists(
    path.join(repoRoot, "tools", "winsw", "RaceOfficeServer.exe"),
    path.join(serverOutDir, "RaceOfficeServer.exe")
  );

  const copiedWinSwXml = await copyFileIfExists(
    path.join(repoRoot, "tools", "winsw", "RaceOfficeServer.xml"),
    path.join(serverOutDir, "RaceOfficeServer.xml")
  );

  // If no WinSW XML was provided, write a sane default config.
  // Default binds publicly (0.0.0.0) on port 8787 and points to ProgramData DB path.
  const defaultDbPath = "C:\\ProgramData\\RaceOffice\\data\\raceoffice.db";
  const winSwXmlPath = path.join(serverOutDir, "RaceOfficeServer.xml");
  if (!fsSync.existsSync(winSwXmlPath)) {
    await fs.writeFile(
      winSwXmlPath,
      [
        "<service>",
        "  <id>RaceOffice</id>",
        "  <name>RaceOffice Server</name>",
        "  <description>RaceOffice Fastify realtime server</description>",
        "",
        "  <executable>%BASE%\\node\\node.exe</executable>",
        `  <arguments>%BASE%\\dist\\index.js --host 0.0.0.0 --port 8787 --db \"${defaultDbPath}\"</arguments>`,
        "",
        "  <workingdirectory>%BASE%</workingdirectory>",
        "",
        "  <logpath>%BASE%\\logs</logpath>",
        "  <log mode=\"roll-by-size\">",
        "    <sizeThreshold>10240</sizeThreshold>",
        "    <keepFiles>10</keepFiles>",
        "  </log>",
        "",
        "  <env name=\"NODE_ENV\" value=\"production\" />",
        "  <onfailure action=\"restart\" delay=\"5 sec\" />",
        "</service>",
        "",
      ].join("\n"),
      "utf8"
    );
  }

  // Write a human-friendly handover file with required target-machine steps.
  await fs.writeFile(
    path.join(deployDir, "DEPLOY-NEXT-STEPS.txt"),
    [
      "RaceOffice deploy folder created.",
      "",
      "Deploy content:",
      "  deploy/server/dist     (server JS)",
      "  deploy/server/public   (built SPA)",
      "  deploy/server/node_modules (prod deps)",
      "",
      "Next steps on target machine (Windows Service using WinSW):",
      "  1) Ensure a Node runtime is available:",
      "     - either install Node.js system-wide, OR copy a portable node.exe to deploy/server/node/node.exe",
      "  2) Provide WinSW:",
      "     - RaceOfficeServer.exe + RaceOfficeServer.xml in deploy/server",
      "  3) Choose DB location (recommended): C:\\ProgramData\\RaceOffice\\data\\raceoffice.db",
      "  4) Install service (run elevated):",
      "     RaceOfficeServer.exe install",
      "     RaceOfficeServer.exe start",
      "",
      "Server args (from apps/server/src/index.ts):",
      "  --host <host>   (default 0.0.0.0)",
      "  --port <port>   (default 8787)",
      "  --db   <path>   (default ./data/raceoffice.db)",
      "",
      `Copied portable node.exe: ${copiedNode}`,
      `Copied WinSW exe: ${copiedWinSwExe}`,
      `Copied WinSW xml: ${copiedWinSwXml}`,
    ].join("\n"),
    "utf8"
  );

  console.log(`\nDeploy finished: ${deployDir}\n`);
}

main().catch((err) => {
  // Keep failure explicit in CI/automation.
  console.error(err);
  process.exit(1);
});
