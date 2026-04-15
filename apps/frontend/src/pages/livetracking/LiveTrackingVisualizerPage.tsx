import { useEffect, useMemo, useState } from "react";

import { alpha } from "@mui/material/styles";
import { Box, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from "@mui/material";
import {
  makeLiveTrackingParticipantPoolDocId,
  makeLiveTrackingResultsDocId,
  makeLiveTrackingSessionDocId,
  makeLiveTrackingSetupDocId,
  normalizeTimingPoints,
  type LiveTrackingAthleteLiveState,
  type LiveTrackingParticipantPoolDocument,
  type LiveTrackingResultsDocument,
  type LiveTrackingSessionDocument,
  type LiveTrackingSetupDocument,
} from "@raceoffice/domain";
import { useParams } from "react-router-dom";

import { resolveLiveTrackingDisplayName } from "../../components/livetracking/liveTrackingDisplayName";
import { useLiveTrackingVisualizationList } from "../../providers/LiveTrackingVisualizationListProvider";
import { useRealtimeDoc } from "../../realtime/useRealtimeDoc";
import type { FullLiveTrackingVisualization } from "../../types/liveTrackingVisualization";


const flagModules = import.meta.glob("../../assets/flags/*.svg", {
  eager: true,
  import: "default",
}) as Record<string, string>;

const flagByNation = Object.fromEntries(
  Object.entries(flagModules).map(([path, url]) => {
    const match = path.match(/\/([A-Za-z0-9_-]+)\.svg$/);
    const code = match?.[1]?.toUpperCase() ?? "";
    return [code, url];
  }),
) as Record<string, string>;

function formatMs(ms: number | null): string {
  if (ms == null) return "—";
  return `${Math.floor(ms / 1000)}.${String(ms % 1000).padStart(3, "0")}s`;
}

function normalizeFullLiveTrackingVisualization(raw: unknown, visualizationId: string): FullLiveTrackingVisualization {
  const obj = raw && typeof raw === "object" ? (raw as any) : {};

  return {
    id: typeof obj.id === "string" ? obj.id : visualizationId,
    name: typeof obj.name === "string" ? obj.name : "Live Tracking",
    backgroundColor: typeof obj.backgroundColor === "string" ? obj.backgroundColor : "#000000",
    alternateRowBackgroundColor: typeof obj.alternateRowBackgroundColor === "string" ? obj.alternateRowBackgroundColor : "",
    fontSize: typeof obj.fontSize === "string" ? obj.fontSize : "18px",
    fontWeight: typeof obj.fontWeight === "string" ? obj.fontWeight : "600",
    fontColor: typeof obj.fontColor === "string" ? obj.fontColor : "#ffffff",
    headerFontSize: typeof obj.headerFontSize === "string" ? obj.headerFontSize : "1.1em",
    activeStatusColor: typeof obj.activeStatusColor === "string" ? obj.activeStatusColor : "#22c55e",
    inactiveStatusColor: typeof obj.inactiveStatusColor === "string" ? obj.inactiveStatusColor : "#ef4444",
    qualificationRecentLines:
      typeof obj.qualificationRecentLines === "number" && Number.isFinite(obj.qualificationRecentLines)
        ? Math.max(1, Math.floor(obj.qualificationRecentLines))
        : 10,
    useQualificationPaging: typeof obj.useQualificationPaging === "boolean" ? obj.useQualificationPaging : false,
    qualificationPagingLines:
      typeof obj.qualificationPagingLines === "number" && Number.isFinite(obj.qualificationPagingLines)
        ? Math.max(1, Math.floor(obj.qualificationPagingLines))
        : 10,
    qualificationPagingTime:
      typeof obj.qualificationPagingTime === "number" && Number.isFinite(obj.qualificationPagingTime)
        ? Math.max(0, Math.floor(obj.qualificationPagingTime))
        : 0,
  };
}

export default function LiveTrackingVisualizerPage() {
  const { visualizationId: visualizationIdParam } = useParams<{ visualizationId?: string }>();
  const { visualizationList } = useLiveTrackingVisualizationList();

  const effectiveVisualizationId =
    (visualizationIdParam ? String(visualizationIdParam).trim() : "") || visualizationList?.activeVisualizationId || "";

  const visualizationDocId = effectiveVisualizationId ? `LiveTrackingVisualization-${effectiveVisualizationId}` : null;
  const { data: rawVisualization } = useRealtimeDoc<Partial<FullLiveTrackingVisualization>>(visualizationDocId);

  const visualization = useMemo(() => {
    if (!effectiveVisualizationId) return null;
    return normalizeFullLiveTrackingVisualization(rawVisualization, effectiveVisualizationId);
  }, [rawVisualization, effectiveVisualizationId]);

  const sessionDocId = useMemo(() => makeLiveTrackingSessionDocId(), []);
  const resultsDocId = useMemo(() => makeLiveTrackingResultsDocId(), []);

  const { data: session } = useRealtimeDoc<LiveTrackingSessionDocument>(sessionDocId);
  const { data: results } = useRealtimeDoc<LiveTrackingResultsDocument>(resultsDocId);

  const setupDocId = useMemo(() => {
    const setupId = String(session?.setupId ?? "").trim();
    return setupId ? makeLiveTrackingSetupDocId(setupId) : null;
  }, [session?.setupId]);
  const { data: setupDoc } = useRealtimeDoc<LiveTrackingSetupDocument>(setupDocId);

  const sessionParticipantPoolDocId = useMemo(() => {
    if (!session) return "";

    if (session.participantSource.kind === "event_participant_pool") {
      return session.participantSource.participantPoolDocId;
    }

    if (session.participantSource.kind === "setup_participant_pool") {
      return session.participantSource.participantPoolDocId;
    }

    return makeLiveTrackingParticipantPoolDocId(session.participantSource.eventId);
  }, [session]);

  const { data: participantPoolDoc } = useRealtimeDoc<LiveTrackingParticipantPoolDocument>(
    sessionParticipantPoolDocId.trim() || null,
  );

  const participantNameByAthleteId = useMemo(() => {
    const map = new Map<string, string>();
    for (const athlete of participantPoolDoc?.athletes ?? []) {
      const fullName = `${String(athlete.firstName ?? "").trim()} ${String(athlete.lastName ?? "").trim()}`.trim();
      if (!fullName) continue;
      map.set(athlete.id, fullName);
    }
    return map;
  }, [participantPoolDoc]);

  const participantNameByTransponderId = useMemo(() => {
    const map = new Map<string, string>();
    for (const athlete of participantPoolDoc?.athletes ?? []) {
      const fullName = `${String(athlete.firstName ?? "").trim()} ${String(athlete.lastName ?? "").trim()}`.trim();
      if (!fullName) continue;

      for (const raw of athlete.transponderIds ?? []) {
        const transponderId = String(raw ?? "").trim();
        if (!transponderId) continue;
        if (!map.has(transponderId)) map.set(transponderId, fullName);
      }
    }
    return map;
  }, [participantPoolDoc]);

  const participantNationByAthleteId = useMemo(() => {
    const map = new Map<string, string>();
    for (const athlete of participantPoolDoc?.athletes ?? []) {
      const nation = String(athlete.nation ?? "").trim().toUpperCase();
      if (!nation) continue;
      map.set(athlete.id, nation);
    }
    return map;
  }, [participantPoolDoc]);

  const participantBibByAthleteId = useMemo(() => {
    const map = new Map<string, number>();
    for (const athlete of participantPoolDoc?.athletes ?? []) {
      if (typeof athlete.bib !== "number") continue;
      map.set(athlete.id, athlete.bib);
    }
    return map;
  }, [participantPoolDoc]);

  const startFinishTimingPointId = useMemo(() => {
    const point = normalizeTimingPoints(setupDoc?.track.timingPoints ?? []).find((x) => x.role === "start_finish");
    return point?.id ?? null;
  }, [setupDoc]);

  const orderedSplitPoints = useMemo(() => {
    return normalizeTimingPoints(setupDoc?.track.timingPoints ?? []).filter((point) => point.role !== "start_finish");
  }, [setupDoc]);

  const liveStateByAthleteId = useMemo(() => {
    const map = new Map<string, LiveTrackingAthleteLiveState>();
    for (const row of results?.athleteLiveStates ?? []) {
      map.set(row.athleteId, row);
    }
    return map;
  }, [results]);

  const latestStartFinishByTransponderId = useMemo(() => {
    const map = new Map<string, number>();
    for (const event of results?.recentPassings ?? []) {
      if (startFinishTimingPointId && event.timingPointId !== startFinishTimingPointId) continue;
      const key = String(event.transponderId ?? "").trim();
      if (!key) continue;
      const ts = Date.parse(event.timestamp);
      if (!Number.isFinite(ts)) continue;
      const prev = map.get(key) ?? Number.NEGATIVE_INFINITY;
      if (ts > prev) map.set(key, ts);
    }
    return map;
  }, [results, startFinishTimingPointId]);

  const sortedAthleteLiveStates = useMemo(() => {
    // Training/standard board should only show athletes with at least one passing,
    // consistent with the other live-tracking views.
    const rows = [...(results?.athleteLiveStates ?? [])].filter((row) => Boolean(row.lastPassingAt));
    rows.sort((a, b) => {
      const ams = a.lastPassingAt ? Date.parse(a.lastPassingAt) : Number.NEGATIVE_INFINITY;
      const bms = b.lastPassingAt ? Date.parse(b.lastPassingAt) : Number.NEGATIVE_INFINITY;
      return bms - ams;
    });
    return rows;
  }, [results]);

  const qualificationRankByAthleteId = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of results?.qualifyingRanking ?? []) {
      map.set(entry.athleteId, entry.rank);
    }
    return map;
  }, [results]);

  const qualificationLiveRows = useMemo(() => {
    const rows = [...(results?.athleteLiveStates ?? [])].filter((row) => Boolean(row.lastPassingAt));
    rows.sort((a, b) => {
      const aStartFinish = a.transponderId
        ? latestStartFinishByTransponderId.get(String(a.transponderId).trim()) ?? Number.NEGATIVE_INFINITY
        : Number.NEGATIVE_INFINITY;
      const bStartFinish = b.transponderId
        ? latestStartFinishByTransponderId.get(String(b.transponderId).trim()) ?? Number.NEGATIVE_INFINITY
        : Number.NEGATIVE_INFINITY;
      if (aStartFinish !== bStartFinish) return bStartFinish - aStartFinish;

      const ams = a.lastPassingAt ? Date.parse(a.lastPassingAt) : Number.NEGATIVE_INFINITY;
      const bms = b.lastPassingAt ? Date.parse(b.lastPassingAt) : Number.NEGATIVE_INFINITY;
      return bms - ams;
    });

    const maxLines = Math.max(1, visualization?.qualificationRecentLines ?? 10);
    return rows.slice(0, maxLines);
  }, [results, latestStartFinishByTransponderId, visualization?.qualificationRecentLines]);

  const qualificationRankingRows = useMemo(() => {
    const rows = [...(results?.qualifyingRanking ?? [])];
    rows.sort((a, b) => a.rank - b.rank);
    return rows;
  }, [results]);

  const qualificationPagingEnabled = Boolean(visualization?.useQualificationPaging);
  const qualificationPagingLines = Math.max(1, Math.floor(Number(visualization?.qualificationPagingLines ?? 10) || 10));
  const qualificationPagingTime = Math.max(0, Math.floor(Number(visualization?.qualificationPagingTime ?? 0) || 0));
  const qualificationTotalPages = useMemo(() => {
    if (!qualificationPagingEnabled) return 1;
    return Math.max(1, Math.ceil(qualificationRankingRows.length / qualificationPagingLines));
  }, [qualificationPagingEnabled, qualificationRankingRows.length, qualificationPagingLines]);

  const [autoQualificationPagingRunning, setAutoQualificationPagingRunning] = useState(
    qualificationPagingEnabled && qualificationPagingTime > 0,
  );
  const [qualificationCurrentPage, setQualificationCurrentPage] = useState(0);

  useEffect(() => {
    setAutoQualificationPagingRunning(qualificationPagingEnabled && qualificationPagingTime > 0);
    setQualificationCurrentPage(0);
  }, [qualificationPagingEnabled, qualificationPagingTime]);

  useEffect(() => {
    setQualificationCurrentPage((prev) => Math.min(prev, Math.max(0, qualificationTotalPages - 1)));
  }, [qualificationTotalPages]);

  useEffect(() => {
    if (session?.mode !== "qualifying") return undefined;
    if (!qualificationPagingEnabled || !autoQualificationPagingRunning || qualificationPagingTime <= 0 || qualificationTotalPages <= 1) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setQualificationCurrentPage((prev) => (prev + 1) % qualificationTotalPages);
    }, qualificationPagingTime * 1000);

    return () => window.clearInterval(intervalId);
  }, [
    session?.mode,
    qualificationPagingEnabled,
    autoQualificationPagingRunning,
    qualificationPagingTime,
    qualificationTotalPages,
  ]);

  const visibleQualificationRankingRows = useMemo(() => {
    if (!qualificationPagingEnabled) return qualificationRankingRows;
    const start = qualificationCurrentPage * qualificationPagingLines;
    return qualificationRankingRows.slice(start, start + qualificationPagingLines);
  }, [qualificationPagingEnabled, qualificationRankingRows, qualificationCurrentPage, qualificationPagingLines]);

    function getDisplayName(row: LiveTrackingAthleteLiveState): string {
    return resolveLiveTrackingDisplayName({
      row,
      participantNameByAthleteId,
      participantNameByTransponderId,
    });
  }


  if (!effectiveVisualizationId) {
    return (
      <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", p: 2 }}>
        <Typography>No active Live Tracking visualization selected.</Typography>
      </Box>
    );
  }

  const backgroundColor = visualization?.backgroundColor ?? "#000000";
  const alternateRowBackgroundColor = String(visualization?.alternateRowBackgroundColor ?? "").trim();
  const fontSize = visualization?.fontSize ?? "18px";
  const fontWeight = visualization?.fontWeight ?? "600";
  const fontColor = visualization?.fontColor ?? "#ffffff";
  const headerFontSize = visualization?.headerFontSize ?? "1.1em";
  const activeStatusColor = visualization?.activeStatusColor ?? "#22c55e";
  const inactiveStatusColor = visualization?.inactiveStatusColor ?? "#ef4444";

  return (
    <Box
      sx={{
        width: "100vw",
        minHeight: "100vh",
        bgcolor: backgroundColor,
        color: fontColor,
        fontSize,
        fontWeight,
        p: 3,
        boxSizing: "border-box",
      }}
    >
      <Typography sx={{ mb: 2, fontSize: headerFontSize, fontWeight: 800 }}>
        {visualization?.name ?? "Live Tracking"}
      </Typography>

      {session?.mode === "qualifying" ? (
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" }, gap: { xs: 2, lg: 5 } }}>
          <Box>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
              <Typography sx={{ fontWeight: 800, fontSize: headerFontSize }}>Live Data</Typography>
            </Box>

            <TableContainer>
              <Table
                size="small"
                sx={{
                  "& th, & td": {
                    color: "inherit",
                    fontSize: "1em",
                    fontWeight: "inherit",
                    borderBottom: "none",
                    whiteSpace: "nowrap",
                  },
                  "& th": {
                    fontSize: headerFontSize,
                    fontWeight: 800,
                  },
                }}
              >
              <TableHead>
                <TableRow>
                  <TableCell align="right">Bib</TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell />
                  <TableCell align="right">Split</TableCell>
                  <TableCell align="right">Last Lap</TableCell>
                  <TableCell align="right">Rank</TableCell>
                </TableRow>
              </TableHead>

              <TableBody>
                {qualificationLiveRows.map((row, index) => {
                  const rowBg = alternateRowBackgroundColor && index % 2 === 1 ? alternateRowBackgroundColor : undefined;
                  const isActive = row.activityStatus === "active";
                  const latestSplit = row.currentLapSplits.length > 0 ? row.currentLapSplits[row.currentLapSplits.length - 1] : null;
                  const rank = qualificationRankByAthleteId.get(row.athleteId) ?? null;

                  return (
                    <TableRow
                      key={row.athleteId}
                      sx={
                        rowBg
                          ? {
                              "& .MuiTableCell-root": {
                                backgroundColor: rowBg,
                              },
                            }
                          : undefined
                      }
                    >
                      <TableCell align="right">{row.bib ?? participantBibByAthleteId.get(row.athleteId) ?? ""}</TableCell>
                      <TableCell>{getDisplayName(row)}</TableCell>
                      <TableCell>
                        <Box
                          component="span"
                          sx={{
                            display: "inline-block",
                            width: "0.8em",
                            height: "0.8em",
                            borderRadius: "50%",
                            bgcolor: isActive ? activeStatusColor : inactiveStatusColor,
                          }}
                        />
                      </TableCell>
                      <TableCell align="right">{formatMs(latestSplit?.splitTimeMs ?? null)}</TableCell>
                      <TableCell align="right">{formatMs(row.lastLapTimeMs)}</TableCell>
                      <TableCell align="right">{rank ?? "—"}</TableCell>
                    </TableRow>
                  );
                })}

                {qualificationLiveRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6}>No live athletes yet.</TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </TableContainer>
          </Box>

          <Box>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
              <Typography sx={{ fontWeight: 800, fontSize: headerFontSize }}>Qualification Ranking</Typography>
              {qualificationPagingEnabled ? (
                <Typography sx={{ color: alpha(fontColor, 0.7), fontSize: "0.9em" }}>
                  {!autoQualificationPagingRunning && qualificationPagingTime > 0 ? "⏸ " : null}
                  {Math.min(qualificationCurrentPage + 1, qualificationTotalPages)} / {qualificationTotalPages}
                </Typography>
              ) : null}
            </Box>

            <TableContainer>
              <Table
                size="small"
                sx={{
                  "& th, & td": {
                    color: "inherit",
                    fontSize: "1em",
                    fontWeight: "inherit",
                    borderBottom: "none",
                    whiteSpace: "nowrap",
                  },
                  "& th": {
                    fontSize: headerFontSize,
                    fontWeight: 800,
                  },
                }}
              >
                <TableHead>
                  <TableRow>
                    <TableCell align="right">Rank</TableCell>
                    <TableCell align="right">Bib</TableCell>
                    <TableCell align="center">Nat</TableCell>
                    <TableCell>Name</TableCell>
                    <TableCell align="right">Best Time</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {visibleQualificationRankingRows.map((entry, index) => {
                    const state = liveStateByAthleteId.get(entry.athleteId) ?? null;
                    const rowBg = alternateRowBackgroundColor && index % 2 === 1 ? alternateRowBackgroundColor : undefined;
                    const nation = String(
                      state?.nation ?? participantNationByAthleteId.get(entry.athleteId) ?? "",
                    )
                      .trim()
                      .toUpperCase();
                    const flagUrl = nation ? flagByNation[nation] : "";

                    return (
                      <TableRow
                        key={`${entry.athleteId}:${entry.rank}`}
                        sx={
                          rowBg
                            ? {
                                "& .MuiTableCell-root": {
                                  backgroundColor: rowBg,
                                },
                              }
                            : undefined
                        }
                      >
                        <TableCell align="right">{entry.rank}</TableCell>
                        <TableCell align="right">{state?.bib ?? participantBibByAthleteId.get(entry.athleteId) ?? ""}</TableCell>
                        <TableCell align="center">
                          {flagUrl ? (
                            <Box
                              component="img"
                              src={flagUrl}
                              alt={nation}
                              sx={{ height: "0.8em", width: "auto", maxWidth: "1.6em", display: "inline-block" }}
                            />
                          ) : (
                            nation || ""
                          )}
                        </TableCell>
                        <TableCell>{state ? getDisplayName(state) : entry.athleteId}</TableCell>
                        <TableCell align="right">{formatMs(entry.bestLapTimeMs)}</TableCell>
                      </TableRow>
                    );
                  })}
                  {visibleQualificationRankingRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5}>No ranking entries yet.</TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        </Box>
      ) : (
        <TableContainer>
          <Table
            size="small"
            sx={{
                                "& th, & td": {
                    color: "inherit",
                    fontSize: "1em",
                    fontWeight: "inherit",
                    borderBottom: "none",
                    whiteSpace: "nowrap",
                  },
                  "& th": {
                    fontSize: headerFontSize,
                    fontWeight: 800,
                  },

            }}
          >
            <TableHead>
              <TableRow>
                <TableCell>Athlete</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Laps</TableCell>
                <TableCell align="right">Best lap</TableCell>
                <TableCell align="right">Last lap</TableCell>
                {orderedSplitPoints.map((point) => (
                  <TableCell key={point.id} align="right">
                    {String(point.name ?? "").trim() || point.id}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>

            <TableBody>
              {sortedAthleteLiveStates.map((row, index) => {
                const rowBg = alternateRowBackgroundColor && index % 2 === 1 ? alternateRowBackgroundColor : undefined;
                const splitByTimingPointId = new Map(row.currentLapSplits.map((split) => [split.timingPointId, split.splitTimeMs]));
                const isActive = row.activityStatus === "active";

                return (
                  <TableRow
                    key={row.athleteId}
                    sx={
                      rowBg
                        ? {
                            "& .MuiTableCell-root": {
                              backgroundColor: rowBg,
                            },
                          }
                        : undefined
                    }
                  >
                    <TableCell>{getDisplayName(row)}</TableCell>
                    <TableCell>
                      <Box
                        component="span"
                        sx={{
                          display: "inline-block",
                          width: "0.8em",
                          height: "0.8em",
                          borderRadius: "50%",
                          bgcolor: isActive ? activeStatusColor : inactiveStatusColor,
                        }}
                      />
                    </TableCell>
                    <TableCell align="right">{row.lapsCompleted}</TableCell>
                    <TableCell align="right">{formatMs(row.bestLapTimeMs)}</TableCell>
                    <TableCell align="right">{formatMs(row.lastLapTimeMs)}</TableCell>
                    {orderedSplitPoints.map((point) => (
                      <TableCell key={`${row.athleteId}:${point.id}`} align="right">
                        {formatMs(splitByTimingPointId.get(point.id) ?? null)}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}

              {sortedAthleteLiveStates.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5 + orderedSplitPoints.length}>
                    <Typography color="inherit">No live athletes yet.</Typography>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
