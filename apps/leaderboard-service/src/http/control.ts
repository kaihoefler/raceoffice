/**
 * Control API (`/api/*`) and `/health`.
 *
 * Security: writing requests (POST/PUT/DELETE under /api) require `Authorization: Bearer <token>`
 * if a control token is configured. Reading endpoints stay open, like the race endpoints.
 *
 * Upload: `PUT /api/recordings/:file` with the raw file as body (application/octet-stream or
 * text/plain). Simpler than multipart and needs no extra dependency; the browser sends
 * `fetch(url, { method: "PUT", body: file })`.
 */
import { createReadStream } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { ConfigError, mergeConfig, pickPersisted, type PersistedConfig } from "../config.js";
import { RecordingNameError } from "../recordings.js";
import type { LeaderboardService } from "../service.js";
import { VERSION } from "../version.js";

const WRITE_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);

const connectSchema = {
  type: ["object", "null"],
  additionalProperties: false,
  properties: {
    host: { type: "string", minLength: 1 },
    port: { type: "integer", minimum: 1, maximum: 65535 },
    encoding: { type: "string", minLength: 1 },
  },
} as const;

const playerStartSchema = {
  type: "object",
  additionalProperties: false,
  required: ["file"],
  properties: {
    file: { type: "string", minLength: 1 },
    speedup: { type: "number", exclusiveMinimum: 0 },
    startAtMs: { type: "number", minimum: 0 },
    skipGaps: { type: "boolean" },
  },
} as const;

const skipGapsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["enabled"],
  properties: { enabled: { type: "boolean" } },
} as const;

const seekSchema = {
  type: "object",
  additionalProperties: false,
  required: ["positionMs"],
  properties: { positionMs: { type: "number", minimum: 0 } },
} as const;

const speedSchema = {
  type: "object",
  additionalProperties: false,
  required: ["speedup"],
  properties: { speedup: { type: "number", exclusiveMinimum: 0 } },
} as const;

const recorderStartSchema = {
  type: ["object", "null"],
  additionalProperties: false,
  properties: { name: { type: "string", maxLength: 100 } },
} as const;

export function registerControlRoutes(app: FastifyInstance, service: LeaderboardService): void {
  const token = service.config.controlToken;

  app.addHook("onRequest", async (req, reply) => {
    if (!token || !WRITE_METHODS.has(req.method) || !(req.url === "/api" || req.url.startsWith("/api/"))) return;
    const header = String(req.headers.authorization ?? "");
    const given = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!safeEqual(given, token)) return reply.code(401).send({ error: "unauthorized" });
  });

  // Raw upload bodies (recordings). Fastify's own text/plain parser would decode to a string.
  app.removeContentTypeParser("text/plain");
  for (const type of ["application/octet-stream", "text/plain"]) {
    app.addContentTypeParser(type, { parseAs: "buffer", bodyLimit: service.config.uploadLimitBytes }, (_req, body, done) =>
      done(null, body),
    );
  }

  app.get("/health", async () => ({ ok: true, version: VERSION }));

  app.get("/api/status", async () => service.status());

  app.get("/api/config", async () => persistedView(service));

  app.put("/api/config", async (req, reply) => {
    const patch = pickPersisted(req.body);
    try {
      const next = mergeConfig(service.config, patch);
      service.updateConfig(persistedOf(next));
    } catch (err) {
      if (err instanceof ConfigError) return reply.code(400).send({ error: "invalid_config", message: err.message });
      throw err;
    }
    return persistedView(service);
  });

  app.post("/api/client/connect", { schema: { body: connectSchema } }, async (req, reply) => {
    const body = (req.body ?? {}) as { host?: string; port?: number; encoding?: string };
    if (body.encoding !== undefined) {
      try {
        new TextDecoder(body.encoding);
      } catch {
        return reply.code(400).send({ error: "invalid_encoding", message: `unknown encoding ${body.encoding}` });
      }
    }
    service.connect(body);
    return service.status();
  });

  app.post("/api/client/disconnect", async () => {
    service.disconnect();
    return service.status();
  });

  app.post("/api/recorder/start", { schema: { body: recorderStartSchema } }, async (req) => {
    const body = (req.body ?? {}) as { name?: string };
    const file = await service.startRecorder(body.name);
    return { file, status: service.status() };
  });

  app.post("/api/recorder/stop", async () => {
    await service.stopRecorder();
    return service.status();
  });

  app.get("/api/recordings", async () => service.recordings.list());

  app.get("/api/recordings/:file", async (req, reply) => {
    const { file } = req.params as { file: string };
    return withRecordingErrors(reply, async () => {
      const path = service.recordings.pathOf(file);
      const stream = createReadStream(path);
      await new Promise<void>((resolve, reject) => {
        stream.once("open", () => resolve());
        stream.once("error", reject);
      });
      return reply
        .header("Content-Type", "text/plain; charset=binary")
        .header("Content-Disposition", `attachment; filename="${file.replace(/"/g, "")}"`)
        .send(stream);
    });
  });

  app.put("/api/recordings/:file", async (req, reply) => {
    const { file } = req.params as { file: string };
    if (!Buffer.isBuffer(req.body)) {
      return reply
        .code(415)
        .send({ error: "unsupported_media_type", message: "send the file as application/octet-stream or text/plain" });
    }
    const body = req.body;
    return withRecordingErrors(reply, async () => {
      const saved = await service.recordings.save(file, body);
      return reply.code(201).send({ file: saved, size: body.length });
    });
  });

  app.delete("/api/recordings/:file", async (req, reply) => {
    const { file } = req.params as { file: string };
    return withRecordingErrors(reply, async () => {
      if (service.player.loadedFile === file && service.player.currentState !== "idle") {
        return reply.code(409).send({ error: "in_use", message: "recording is being replayed" });
      }
      if (service.recorder.status().file === file) {
        return reply.code(409).send({ error: "in_use", message: "recording is being written" });
      }
      await service.recordings.remove(file);
      return reply.code(204).send();
    });
  });

  app.post("/api/player/start", { schema: { body: playerStartSchema } }, async (req, reply) => {
    const body = req.body as { file: string; speedup?: number; startAtMs?: number; skipGaps?: boolean };
    return withRecordingErrors(reply, async () => {
      await service.startPlayer(body);
      return service.status();
    });
  });

  app.post("/api/player/pause", async () => {
    service.player.pause();
    return service.status();
  });

  app.post("/api/player/resume", async () => {
    service.player.resume();
    return service.status();
  });

  app.post("/api/player/stop", async () => {
    service.stopPlayer();
    return service.status();
  });

  app.post("/api/player/seek", { schema: { body: seekSchema } }, async (req, reply) => {
    if (!service.player.loadedFile) return reply.code(409).send({ error: "no_recording", message: "no replay loaded" });
    service.player.seek((req.body as { positionMs: number }).positionMs);
    return service.status();
  });

  app.post("/api/player/skip-gaps", { schema: { body: skipGapsSchema } }, async (req) => {
    service.player.setSkipGaps((req.body as { enabled: boolean }).enabled);
    return service.status();
  });

  app.post("/api/player/speed", { schema: { body: speedSchema } }, async (req) => {
    service.player.setSpeedup((req.body as { speedup: number }).speedup);
    return service.status();
  });

  app.post("/api/state/reset", async () => {
    service.resetState();
    return service.status();
  });
}

async function withRecordingErrors(reply: FastifyReply, fn: () => Promise<unknown>): Promise<unknown> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof RecordingNameError) return reply.code(400).send({ error: "invalid_name", message: err.message });
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return reply.code(404).send({ error: "not_found", message: "recording not found" });
    throw err;
  }
}

function persistedOf(c: PersistedConfig): PersistedConfig {
  return { client: c.client, recorder: c.recorder, player: c.player, publish: c.publish, state: c.state, compat: c.compat };
}

function persistedView(service: LeaderboardService): PersistedConfig {
  return structuredClone(persistedOf(service.config));
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
