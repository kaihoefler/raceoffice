# Leaderboard service (headless replacement for RMonitorLeaderboard).
#
#   docker build -f docker/leaderboard/Dockerfile -t raceoffice-leaderboard .
#   docker run -d -p 8080:8080 -v leaderboard-data:/data -e RMONITOR_HOST=192.168.1.20 \
#     -e AUTOCONNECT=true raceoffice-leaderboard
#
# Context is the repo root (npm workspaces). See doc/leaderboard-integration/07-docker-und-deployment.md.
#
# The build stage runs on the build machine's platform only: the result is one JavaScript bundle
# without native code, so a multi-arch build (amd64/arm64) needs no emulated npm install – only
# the small runtime stage exists per platform.

# ---- build ----
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS build
WORKDIR /repo
COPY . .
RUN npm ci --include-workspace-root \
      -w @raceoffice/domain -w @raceoffice/rmonitor \
      -w @raceoffice/leaderboard-frontend -w @raceoffice/leaderboard-service \
 && npm run build:domain \
 && npm --workspace @raceoffice/rmonitor run build \
 && npm run bundle:leaderboard-service

# ---- runtime ----
FROM node:22-alpine
LABEL org.opencontainers.image.title="raceoffice-leaderboard" \
      org.opencontainers.image.description="Headless leaderboard service for Orbits/RMonitor (successor of RMonitorLeaderboard)" \
      org.opencontainers.image.licenses="GPL-3.0-or-later" \
      org.opencontainers.image.source="https://github.com/kaihoefler/raceoffice"

# Java-compatible defaults: port 8080, data (config + recordings) in the /data volume.
# Listening on all interfaces is required inside a container.
ENV NODE_ENV=production \
    LEADERBOARD_HOST=0.0.0.0 \
    LEADERBOARD_PORT=8080 \
    LEADERBOARD_DATA_DIR=/data

WORKDIR /app
COPY --from=build /repo/apps/leaderboard-service/bundle/ ./
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8080
USER node
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8080/health >/dev/null || exit 1
# CLI options of the Java app work as arguments, e.g. `--host 192.168.1.20 --port 50000`.
ENTRYPOINT ["node", "dist/index.js"]
