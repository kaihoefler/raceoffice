// CLI: mock timing system for manual testing and development without a timing system.
//
//   npm run mock:race-status -- [--port 8080] [--host 127.0.0.1] [--recording <file.jsonl>] [--speed 1] [--loop]
//
// Without --recording the mock reports "no active race" until a state is set via
//   PUT http://127.0.0.1:8080/__mock/frame   {"race": {...}}
// With --recording it replays a recorded race with its original timing.
// The frontend uses http://localhost:8080/races?filter=current by default, so with the
// default port no frontend configuration is needed.

import { parseArgs } from "node:util";
import { loadRecording, startRaceStatusMockServer } from "../server.js";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "8080" },
    host: { type: "string", default: "127.0.0.1" },
    recording: { type: "string" },
    speed: { type: "string", default: "1" },
    loop: { type: "boolean", default: false },
  },
});

const server = await startRaceStatusMockServer({ port: Number(values.port), host: values.host });

console.log(`Race status mock listening on ${server.url}`);
console.log(`  feed:     ${server.url}/races?filter=current`);
console.log(`  control:  PUT ${server.url}/__mock/frame  {"race": {...}} | {"response": {"kind": "httpError", "status": 500}}`);
console.log(`  state:    GET ${server.url}/__mock/state`);

if (values.recording) {
  const frames = loadRecording(values.recording);
  server.replay(frames, { speed: Number(values.speed), loop: values.loop });
  console.log(`Replaying ${frames.length} recorded states from ${values.recording} (speed x${values.speed}${values.loop ? ", loop" : ""})`);
} else {
  console.log('No recording given: reporting "no active race" until a state is set.');
}

const shutdown = async () => {
  await server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
