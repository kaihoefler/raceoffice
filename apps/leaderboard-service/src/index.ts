/**
 * leaderboard-service – entry point.
 *
 *   node dist/index.js [Java-compatible options]     (see --help)
 *
 * Standalone (Docker, own machine) or managed (started by the RaceOffice server, mode A).
 */
import { CLI_HELP, ConfigError, loadConfig } from "./config.js";
import { buildApp } from "./http/app.js";
import { LeaderboardService } from "./service.js";
import { VERSION } from "./version.js";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(CLI_HELP);
    return;
  }
  if (argv.includes("--version") || argv.includes("-V")) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  const config = loadConfig(argv, process.env);
  const service = new LeaderboardService(config);
  const app = await buildApp(service);
  const log = {
    info: (m: string) => app.log.info(m),
    warn: (m: string) => app.log.warn(m),
    error: (m: string) => app.log.error(m),
  };
  // Late-bind the logger now that Fastify's exists.
  service.setLogger(log);

  await app.listen({ host: config.server.host, port: config.server.port });
  app.log.info(
    `leaderboard-service ${VERSION} (${config.mode}) – data dir ${config.dataDir}, Orbits ${config.client.host}:${config.client.port}`,
  );
  await service.startup();

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    app.log.info(`${signal} received, shutting down`);
    await service.shutdown();
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void stop("SIGINT"));
  process.on("SIGTERM", () => void stop("SIGTERM"));
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError) {
    process.stderr.write(`configuration error: ${err.message}\n\n${CLI_HELP}`);
    process.exit(2);
  }
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
