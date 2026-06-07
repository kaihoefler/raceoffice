import React, { Fragment, useEffect, useMemo, useState } from "react";

import {
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Checkbox,
  createFilterOptions,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import TuneIcon from "@mui/icons-material/Tune";
import {
  canIssueLiveTrackingCommand,
  createLiveTrackingCommand,
  createLiveTrackingResultsDocument,
  enqueueLiveTrackingCommand,


  makeLiveTrackingParticipantPoolDocId,
  makeLiveTrackingResultsDocId,
  makeLiveTrackingRuntimeDocId,
  makeLiveTrackingSessionDocId,
  makeLiveTrackingSetupDocId,
  normalizeTimingPoints,
  validateLiveTrackingTrack,
  type LiveTrackingCommandIntent,
  type LiveTrackingMode,
  type LiveTrackingParticipantPoolDocument,
  type LiveTrackingResultsDocument,
  type LiveTrackingRuntimeDocument,
  type LiveTrackingSessionDocument,
  type LiveTrackingSetupDocument,
  type LiveTrackingTimingPoint,
  makeLiveTrackingListDocId,
  type LiveTrackingListDocument,
  type LiveTrackingSetupEntry,
} from "@raceoffice/domain";

import { Link as RouterLink } from "react-router-dom";
import LiveTrackingLiveBoard from "../../components/livetracking/LiveTrackingLiveBoard";
import { getLiveTrackingControlGuards } from "./liveTrackingControlGuards";

import { resolveLiveTrackingDisplayName } from "../../components/livetracking/liveTrackingDisplayName";
import { useRealtimeDoc } from "../../realtime/useRealtimeDoc";





type TrackingConfigDraft = {
  setupId: string;
  mode: LiveTrackingMode;
};

type SetupDraft = {
  name: string;
  trackId: string;
  trackName: string;
  lengthM: number;
  minLapTimeSecs: number;
  decoderBackend: "ammc" | "p3parser";
  timingPoints: LiveTrackingTimingPoint[];
};

type DiscoveredDecoder = {
  ip: string;
  port: number;
  decoderId: string;
  decoderType: string;
  firmwareVersion: string;
};


function nowIso(): string {
  return new Date().toISOString();
}



// Simulator baseline speed requested by operations: 30 km/h.
const SIM_SPEED_M_PER_S = (30 * 1000) / 3600;

// Reset behavior policy toggles (explicitly documented to keep operator semantics clear).
const RESET_CLEARS_RUNTIME_BUFFERS = true;
const RESET_CLEARS_RESULTS = false;


function calcSimPassingDelayMs(trackLengthM: number): string {
  const safeLength = Number.isFinite(trackLengthM) ? Math.max(0, trackLengthM) : 0;
  const ms = Math.max(250, Math.round((safeLength / SIM_SPEED_M_PER_S) * 1000));
  return String(ms);
}

function calcSimStartupDelaySecs(absolutePositionM: number): number {
  const safePosition = Number.isFinite(absolutePositionM) ? Math.max(0, absolutePositionM) : 0;
  return Math.max(0, Math.round(safePosition / SIM_SPEED_M_PER_S));
}

function parseDecoderOffsetSecondsInput(value: string): number | null {
  const normalized = String(value ?? "").trim().replace(",", ".");
  if (!normalized) return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}




function toSetupDraft(doc: LiveTrackingSetupDocument): SetupDraft {
  return {
    name: doc.name,
    // Track id is a technical identifier. Keep it internal and auto-generate if missing.
    trackId: String(doc.track.id ?? "").trim() || `track-${crypto.randomUUID().slice(0, 8)}`,
    trackName: doc.track.name,
    lengthM: doc.track.lengthM,
    minLapTimeSecs: doc.minLapTimeSecs ?? 8,
    decoderBackend: doc.decoderBackend ?? "ammc",
    timingPoints: normalizeTimingPoints(doc.track.timingPoints),
  };
}

function NewEntryDialog({
  open,
  title,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  onConfirm: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");

  function handleConfirm() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
    setName("");
    onClose();
  }

  function handleClose() {
    setName("");
    onClose();
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          size="small"
          label="Name"
          fullWidth
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleConfirm();
            if (e.key === "Escape") handleClose();
          }}
          sx={{ mt: 1 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button variant="contained" onClick={handleConfirm} disabled={!name.trim()}>
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
}

type ManageEntry = { id: string; name: string };

function ManageListDialog({
  open,
  title,
  entries,
  onRename,
  onDelete,
  onClose,
}: {
  open: boolean;
  title: string;
  entries: ManageEntry[];
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState<Record<string, string>>({});

  function startEdit(id: string, name: string) {
    setEditing((p) => ({ ...p, [id]: name }));
  }

  function cancelEdit(id: string) {
    setEditing((p) => { const { [id]: _, ...rest } = p; return rest; });
  }

  function save(id: string) {
    const name = (editing[id] ?? "").trim();
    if (name) onRename(id, name);
    cancelEdit(id);
  }

  function handleClose() {
    setEditing({});
    onClose();
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        {entries.length === 0 ? (
          <Typography color="text.secondary" variant="body2" sx={{ p: 2 }}>
            No entries yet.
          </Typography>
        ) : (
          <List dense disablePadding>
            {entries.map((entry) => {
              const isEditing = entry.id in editing;
              return (
                <ListItem
                  key={entry.id}
                  divider
                  sx={{ pr: isEditing ? 18 : 11 }}
                  secondaryAction={
                    isEditing ? (
                      <Stack direction="row" spacing={0.5}>
                        <Button size="small" onClick={() => save(entry.id)}>Save</Button>
                        <Button size="small" color="inherit" onClick={() => cancelEdit(entry.id)}>Cancel</Button>
                      </Stack>
                    ) : (
                      <Stack direction="row" spacing={0}>
                        <IconButton size="small" onClick={() => startEdit(entry.id, entry.name)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => {
                            if (window.confirm(`Delete "${entry.name}"?`)) onDelete(entry.id);
                          }}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                    )
                  }
                >
                  {isEditing ? (
                    <TextField
                      size="small"
                      fullWidth
                      value={editing[entry.id]}
                      onChange={(e) => setEditing((p) => ({ ...p, [entry.id]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") save(entry.id);
                        if (e.key === "Escape") cancelEdit(entry.id);
                      }}
                      autoFocus
                    />
                  ) : (
                    <ListItemText primary={entry.name} secondary={entry.id} />
                  )}
                </ListItem>
              );
            })}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

type SetupOption = LiveTrackingSetupEntry & { inputValue?: string };

const filterSetupOptions = createFilterOptions<SetupOption>({ stringify: (o) => `${o.name} ${o.setupId}` });

export default function LiveTrackingControlPage() {
  const listDocId = useMemo(() => makeLiveTrackingListDocId(), []);
  const sessionDocId = useMemo(() => makeLiveTrackingSessionDocId(), []);
  const runtimeDocId = useMemo(() => makeLiveTrackingRuntimeDocId(), []);
  const resultsDocId = useMemo(() => makeLiveTrackingResultsDocId(), []);

  const { data: liveTrackingList, update: updateList } = useRealtimeDoc<LiveTrackingListDocument>(listDocId);
  const setupEntries = (liveTrackingList?.setups ?? []) as SetupOption[];
  // Genutzt für Namensauflösung der verknüpften Pools im Setup-Editor
  const poolEntries = liveTrackingList?.participantPools ?? [];

  const { data: session, update: updateSession } = useRealtimeDoc<LiveTrackingSessionDocument>(sessionDocId);

  const { data: runtime, update: updateRuntime } = useRealtimeDoc<LiveTrackingRuntimeDocument>(runtimeDocId);
  const { data: results, update: updateResults } = useRealtimeDoc<LiveTrackingResultsDocument>(resultsDocId);






  const sessionForDebug = useMemo(

    () => (session ? { ...session, commandQueue: (session.commandQueue ?? []).slice(-2) } : null),
    [session],
  );
  const sessionJson = useMemo(() => (sessionForDebug ? JSON.stringify(sessionForDebug, null, 2) : "—"), [sessionForDebug]);
  const runtimeJson = useMemo(() => (runtime ? JSON.stringify(runtime, null, 2) : "—"), [runtime]);


  const invalidReasonCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of results?.invalidEvents ?? []) {
      counts.set(event.reason, (counts.get(event.reason) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [results]);

  const [trackingDraft, setTrackingDraft] = useState<TrackingConfigDraft>({
    setupId: "",
    mode: "training",
  });

  const setupDocId = trackingDraft.setupId.trim() ? makeLiveTrackingSetupDocId(trackingDraft.setupId.trim()) : null;
  const { data: setupDoc, update: updateSetup } = useRealtimeDoc<LiveTrackingSetupDocument>(setupDocId);

  const sessionParticipantPoolDocId = useMemo(() => {
    // Setup's activeParticipantPoolIds is the source of truth (session.participantSource is legacy).
    const firstActivePoolId = setupDoc?.activeParticipantPoolIds?.[0];
    if (firstActivePoolId) return makeLiveTrackingParticipantPoolDocId(firstActivePoolId);
    if (!session) return "";
    return session.participantSource.kind === "race"
      ? makeLiveTrackingParticipantPoolDocId(session.participantSource.eventId)
      : session.participantSource.participantPoolDocId;
  }, [session, setupDoc]);

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
  const setupJson = useMemo(() => (setupDoc ? JSON.stringify(setupDoc, null, 2) : "—"), [setupDoc]);

  const [setupDraft, setSetupDraft] = useState<SetupDraft | null>(null);
  const [workerControlBusy, setWorkerControlBusy] = useState(false);
  const [setupDialogOpen, setSetupDialogOpen] = useState(false);
  const [newSetupDialogOpen, setNewSetupDialogOpen] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [decoderOffsetInputByPointId, setDecoderOffsetInputByPointId] = useState<Record<string, string>>({});
  const [p3ScanResult, setP3ScanResult] = useState<{ decoders: DiscoveredDecoder[] } | null>(null);
  const [p3ScanLoading, setP3ScanLoading] = useState(false);
  const [p3ScanError, setP3ScanError] = useState<string | null>(null);



  useEffect(() => {
    if (!session) return;
    setTrackingDraft({
      setupId: session.setupId,
      mode: session.mode,
    });
  }, [session]);


  useEffect(() => {
    if (!setupDoc) {
      setSetupDraft(null);
      setDecoderOffsetInputByPointId({});
      return;
    }

    const draft = toSetupDraft(setupDoc);
    setSetupDraft(draft);
    setDecoderOffsetInputByPointId(() => {
      const next: Record<string, string> = {};
      for (const point of draft.timingPoints) {
        next[point.id] = String(point.decoderTimestampOffsetSecs ?? 0);
      }
      return next;
    });
  }, [setupDoc]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);


  const setupIssues = useMemo(() => {
    if (!setupDraft) return [];
    return validateLiveTrackingTrack({
      id: setupDraft.trackId,
      name: setupDraft.trackName,
      lengthM: setupDraft.lengthM,
      timingPoints: normalizeTimingPoints(setupDraft.timingPoints),
    });
  }, [setupDraft]);

  const trackingConfigDirty = useMemo(() => {
    if (!session) return false;
    return (
      session.setupId !== trackingDraft.setupId.trim() ||
      session.mode !== trackingDraft.mode
    );
  }, [session, trackingDraft]);

  const setupDirty = useMemo(() => {
    if (!setupDoc || !setupDraft) return false;

    const stableTrackId = setupDraft.trackId.trim() || setupDoc.track.id || "";
    const normalizedDraftPoints = normalizeTimingPoints(setupDraft.timingPoints).map((point) => {
      if ((point.decoderType ?? "amb") !== "sim") return point;
      return {
        ...point,
        simPassingDelay: calcSimPassingDelayMs(setupDraft.lengthM),
        simStartupDelaySecs: calcSimStartupDelaySecs(point.absolutePositionM),
      };
    });

    const currentComparable = {
      setupId: setupDoc.setupId,
      name: setupDoc.name,
      decoderBackend: setupDoc.decoderBackend ?? "ammc",
      minLapTimeSecs: setupDoc.minLapTimeSecs ?? 8,
      track: {
        id: setupDoc.track.id,
        name: setupDoc.track.name,
        lengthM: Number(setupDoc.track.lengthM),
        timingPoints: normalizeTimingPoints(setupDoc.track.timingPoints),
      },
    };

    const draftComparable = {
      setupId: trackingDraft.setupId.trim(),
      name: setupDraft.name,
      decoderBackend: setupDraft.decoderBackend,
      minLapTimeSecs: setupDraft.minLapTimeSecs,
      track: {
        id: stableTrackId,
        name: setupDraft.trackName,
        lengthM: Number(setupDraft.lengthM),
        timingPoints: normalizedDraftPoints,
      },
    };

    return JSON.stringify(currentComparable) !== JSON.stringify(draftComparable);
  }, [setupDoc, setupDraft, trackingDraft]);

  const timingPointLabelById = useMemo(() => {
    const map = new Map<string, string>();
    const points = setupDraft?.timingPoints ?? (setupDoc ? normalizeTimingPoints(setupDoc.track.timingPoints) : []);

    for (const point of points) {
      const label = String(point.name ?? "").trim() || point.id;
      map.set(point.id, label);
    }

    return map;
  }, [setupDraft, setupDoc]);

  function resolveControlBoardDisplayName(row: LiveTrackingResultsDocument["athleteLiveStates"][number]): string {
    const resolved = resolveLiveTrackingDisplayName({
      row,
      participantNameByAthleteId,
      participantNameByTransponderId,
    });

    const unknownPrefix = "unknown:transponder:";
    if (resolved.startsWith(unknownPrefix)) {
      const transponderId = String(row.transponderId ?? "").trim();
      return transponderId || resolved.slice(unknownPrefix.length);
    }

    return resolved;
  }


  function saveSessionConfig() {
    // participantSource wird ausschließlich über die Participants-Seite verwaltet (setActivePool)
    updateSession((prev) => ({
      ...prev,
      setupId: trackingDraft.setupId.trim(),
      mode: trackingDraft.mode,
      updatedAt: nowIso(),
    }));
  }

  function queue(intent: LiveTrackingCommandIntent) {
    updateSession((prev) => {
      const requestedAt = nowIso();
      return enqueueLiveTrackingCommand(
        prev,
        createLiveTrackingCommand({ id: crypto.randomUUID(), intent, requestedAt }),
        requestedAt,
      );
    });
  }





  async function postWorkerControl(action: "start" | "stop"): Promise<{ ok: boolean; message: string }> {
    try {
      const response = await fetch(`/live-tracking/worker/${action}`, {
        method: "POST",
      });

      let bodyMessage = "";
      try {
        const body = (await response.json()) as { message?: unknown };
        bodyMessage = String(body?.message ?? "").trim();
      } catch {
        // keep empty message fallback when response body is not JSON
      }

      if (!response.ok) {
        const message = bodyMessage || `HTTP ${response.status}`;
        console.error(`[live-tracking] worker ${action} request failed: ${message}`);
        return { ok: false, message };
      }

      return { ok: true, message: bodyMessage || "ok" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown request error";
      console.error(`[live-tracking] worker ${action} request failed`, error);
      return { ok: false, message };
    }
  }



  async function handleStartWorker() {
    setWorkerControlBusy(true);
    try {
      const result = await postWorkerControl("start");
      if (!result.ok) {
        window.alert(`Start Worker failed: ${result.message}`);
      }
    } finally {
      setWorkerControlBusy(false);
    }
  }



  async function handleShutdownWorker() {
    const shouldQueueShutdown = !!session && canIssueLiveTrackingCommand(session.state, "shutdown");

    setWorkerControlBusy(true);
    try {
      if (shouldQueueShutdown) queue("shutdown");
      await postWorkerControl("stop");
    } finally {
      setWorkerControlBusy(false);
    }
  }


  async function handleReset() {
    setWorkerControlBusy(true);
    try {
      if ((runtime?.workerStatus ?? "offline") !== "offline") {
        await postWorkerControl("stop");
      }

      // Reset is an explicit operator safety action: force session back to idle
      // regardless of queued command history.
      updateSession((prev) => ({
        ...prev,
        desiredState: "idle",
        state: "idle",
        lastError: null,
        updatedAt: nowIso(),
      }));

      if (RESET_CLEARS_RUNTIME_BUFFERS) {
        updateRuntime((prev) => ({
          ...prev,
          recentPassings: [],
          recentRawPayloads: [],
          warnings: [],
          workerStatusCheck: null,
          updatedAt: nowIso(),
        }));
      }

      if (RESET_CLEARS_RESULTS) {
        updateResults(() => ({
          ...createLiveTrackingResultsDocument(),
          generatedAt: nowIso(),
        }));
      }
    } finally {
      setWorkerControlBusy(false);
    }
  }


  function clearRuntimeBuffers() {
    updateRuntime((prev) => ({
      ...prev,
      recentPassings: [],
      recentRawPayloads: [],
      warnings: [],
      updatedAt: nowIso(),
    }));
  }

  function renameSetup(setupId: string, name: string) {
    updateList((prev) => ({
      ...prev,
      setups: prev.setups.map((e) => e.setupId === setupId ? { ...e, name, updatedAt: nowIso() } : e),
    }));
  }

  function deleteSetup(setupId: string) {
    updateList((prev) => ({ ...prev, setups: prev.setups.filter((e) => e.setupId !== setupId) }));
    if (trackingDraft.setupId === setupId) setTrackingDraft((p) => ({ ...p, setupId: "" }));
  }

  function handleCreateSetup(name: string) {
    const setupId = crypto.randomUUID();
    updateList((prev) => ({
      ...prev,
      setups: [...(prev.setups ?? []), { setupId, name, updatedAt: nowIso() }],
    }));
    setTrackingDraft((p) => ({ ...p, setupId }));
  }

  function patchPoint(index: number, patch: Partial<LiveTrackingTimingPoint>) {
    setSetupDraft((prev) => {
      if (!prev) return prev;
      const points = prev.timingPoints.map((p, i) => (i === index ? { ...p, ...patch } : p));
      return { ...prev, timingPoints: normalizeTimingPoints(points) };
    });
  }

  function toggleSimulation(index: number, checked: boolean) {
    setSetupDraft((prev) => {
      if (!prev) return prev;

      const points = normalizeTimingPoints(prev.timingPoints).map((point, i) => {
        // Only one simulated decoder is allowed at a time.
        const nextType = i === index
          ? (checked ? "sim" : "amb")
          : (checked ? "amb" : (point.decoderType ?? "amb"));

        const nextPoint: LiveTrackingTimingPoint = {
          ...point,
          decoderType: nextType as LiveTrackingTimingPoint["decoderType"],
        };

        if (nextType === "sim") {
          nextPoint.simPassingDelay = calcSimPassingDelayMs(prev.lengthM);
          nextPoint.simStartupDelaySecs = calcSimStartupDelaySecs(point.absolutePositionM);
        }

        return nextPoint;
      });

      return { ...prev, timingPoints: points };
    });
  }


  async function scanP3Decoders() {
    setP3ScanLoading(true);
    setP3ScanError(null);
    try {
      const res = await fetch("/live-tracking/p3-discovery/scan?timeoutMs=3000");
      const json = await res.json() as { ok: boolean; decoders?: DiscoveredDecoder[]; message?: string };
      if (json.ok && json.decoders) {
        setP3ScanResult({ decoders: json.decoders });
      } else {
        setP3ScanError(json.message ?? "Scan failed");
        setP3ScanResult(null);
      }
    } catch (err) {
      setP3ScanError(err instanceof Error ? err.message : "Network error");
      setP3ScanResult(null);
    } finally {
      setP3ScanLoading(false);
    }
  }

  function addPoint() {

    setSetupDraft((prev) => {
      if (!prev) return prev;
      const order = prev.timingPoints.length + 1;
      return {
        ...prev,
        timingPoints: [
          ...prev.timingPoints,
          {
            id: `tp-${crypto.randomUUID().slice(0, 8)}`,
            name: `TP ${order}`,
            decoderIp: "127.0.0.1",
            websocketPortAMM: 0,
            decoderType: "amb",
            simTranCodes: [],
            simPassingDelay: "1000",
            simStartupDelaySecs: 0,
            decoderTimestampOffsetSecs: 0,

            order,

            distanceFromPreviousM: order === 1 ? 0 : 100,
            absolutePositionM: 0,
            role: order === 1 ? "start_finish" : "split",
            enabled: true,
          },
        ],
      };
    });
  }

  function removePoint(index: number) {
    setSetupDraft((prev) => {
      if (!prev) return prev;
      const removedPointId = prev.timingPoints[index]?.id;
      if (removedPointId) {
        setDecoderOffsetInputByPointId((current) => {
          const { [removedPointId]: _removed, ...rest } = current;
          return rest;
        });
      }
      return { ...prev, timingPoints: normalizeTimingPoints(prev.timingPoints.filter((_, i) => i !== index)) };
    });
  }

  const workerStatus = runtime?.workerStatus ?? "offline";
  const guards = getLiveTrackingControlGuards({
    workerStatus,
    workerHeartbeatAt: runtime?.workerHeartbeatAt,
    nowMs,
    sessionState: session?.state ?? null,
    workerControlBusy,
  });



  function saveSetup() {

    if (!setupDraft) return;
    const stableTrackId = setupDraft.trackId.trim() || `track-${crypto.randomUUID().slice(0, 8)}`;
    const normalizedPoints = normalizeTimingPoints(setupDraft.timingPoints).map((point) => {
      if ((point.decoderType ?? "amb") !== "sim") return point;
      return {
        ...point,
        simPassingDelay: calcSimPassingDelayMs(setupDraft.lengthM),
        simStartupDelaySecs: calcSimStartupDelaySecs(point.absolutePositionM),
      };
    });

    updateSetup((prev) => ({
      ...prev,
      setupId: trackingDraft.setupId.trim(),
      eventId: prev.eventId ?? null,
      name: setupDraft.name,
      decoderBackend: setupDraft.decoderBackend,
      minLapTimeSecs: setupDraft.minLapTimeSecs,
      track: {
        id: stableTrackId,
        name: setupDraft.trackName,
        lengthM: Number(setupDraft.lengthM),
        timingPoints: normalizedPoints,
      },
      updatedAt: nowIso(),
    }));

    setSetupDraft((prev) => (prev ? { ...prev, trackId: stableTrackId } : prev));

    const targetSetupId = trackingDraft.setupId.trim();
    const nameToSync = setupDraft.name;
    if (targetSetupId) {
      updateList((prev) => {
        if (!prev?.setups?.some((e) => e.setupId === targetSetupId)) return prev;
        return {
          ...prev,
          setups: prev.setups.map((e) =>
            e.setupId === targetSetupId ? { ...e, name: nameToSync, updatedAt: nowIso() } : e
          ),
        };
      });
    }
  }

  return (
    <Box sx={{ display: "grid", gap: 2 }}>


      <Card variant="outlined">
        <CardHeader title="Tracking Control" />
        <Divider />
        <CardContent>
          <Stack spacing={1}>
            <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
              <Box sx={{ display: "flex", alignItems: "flex-start", gap: 0.5, flexGrow: 1 }}>
              <Autocomplete<SetupOption, false, false, false>
                size="small"
                fullWidth
                options={setupEntries}
                value={setupEntries.find((e) => e.setupId === trackingDraft.setupId) ?? null}
                onChange={(_, option) => {
                  if (!option) {
                    setTrackingDraft((p) => ({ ...p, setupId: "" }));
                  } else if (option.inputValue) {
                    handleCreateSetup(option.inputValue);
                  } else {
                    setTrackingDraft((p) => ({ ...p, setupId: option.setupId }));
                  }
                }}
                filterOptions={(options, params) => {
                  const filtered = filterSetupOptions(options, params);
                  const trimmed = params.inputValue.trim();
                  if (trimmed && !options.some((o) => o.name.toLowerCase() === trimmed.toLowerCase())) {
                    filtered.push({ setupId: "__new__", name: `Create "${trimmed}"`, updatedAt: null, inputValue: trimmed });
                  }
                  return filtered;
                }}
                getOptionLabel={(option) => (option.inputValue ? option.inputValue : option.name || option.setupId)}
                isOptionEqualToValue={(option, value) => option.setupId === value.setupId}
                selectOnFocus
                handleHomeEndKeys
                renderOption={(props, option) => {
                  const { key, ...rest } = props as React.HTMLAttributes<HTMLLIElement> & { key: React.Key };
                  return (
                    <li key={key} {...rest}>
                      {option.inputValue ? <em>Create &quot;{option.inputValue}&quot;</em> : option.name}
                    </li>
                  );
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Setup"
                    size="small"
                    helperText={
                      trackingDraft.setupId && !setupEntries.some((e) => e.setupId === trackingDraft.setupId)
                        ? `ID: ${trackingDraft.setupId}`
                        : undefined
                    }
                  />
                )}
              />
              <IconButton size="small" sx={{ mt: "4px" }} onClick={() => setNewSetupDialogOpen(true)} title="New setup">
                <AddIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" sx={{ mt: "4px" }} onClick={() => setSetupDialogOpen(true)} title="Manage setups">
                <TuneIcon fontSize="small" />
              </IconButton>
              </Box>
              <TextField size="small" label="Mode" select value={trackingDraft.mode} onChange={(e) => setTrackingDraft((p) => ({ ...p, mode: e.target.value as LiveTrackingMode }))} sx={{ minWidth: 140 }}>
                <MenuItem value="training">training</MenuItem>
                <MenuItem value="qualifying">qualifying</MenuItem>
              </TextField>
            </Stack>

            <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
              <Button variant={trackingConfigDirty ? "contained" : "outlined"} onClick={saveSessionConfig} disabled={!trackingConfigDirty || workerControlBusy}>
                Save Tracking Setup
              </Button>
              <Button variant={guards.canStartWorker ? "contained" : "outlined"} onClick={handleStartWorker} disabled={!guards.canStartWorker}>

                Start Worker
              </Button>
              <Button variant={guards.canPrepareTracking ? "contained" : "outlined"} onClick={() => queue("prepare")} disabled={!guards.canPrepareTracking}>

                Prepare Tracking
              </Button>
              <Button variant={guards.canStartTracking ? "contained" : "outlined"} onClick={() => queue("start")} disabled={!guards.canStartTracking}>

                Start Tracking
              </Button>
              <Button variant={guards.canStopTracking ? "contained" : "outlined"} onClick={() => queue("stop")} disabled={!guards.canStopTracking}>

                Stop Tracking
              </Button>
              <Button color="warning" variant={guards.canShutdownWorker ? "contained" : "outlined"} onClick={handleShutdownWorker} disabled={!guards.canShutdownWorker}>

                Shutdown Worker
              </Button>
              <Button color="secondary" variant={guards.canResetTracking ? "contained" : "outlined"} onClick={handleReset} disabled={!guards.canResetTracking}>

                Reset
              </Button>

              <Button color="warning" variant="outlined" onClick={clearRuntimeBuffers} disabled={workerControlBusy}>
                Clear Passings/Runtime Buffers
              </Button>
            </Stack>

          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardHeader title="Setup Editor" subheader={setupDocId ?? "Set Setup ID to edit track configuration"} />
        <Divider />
        <CardContent>
          {!setupDraft ? (
            <Typography color="text.secondary">No setup loaded yet.</Typography>
          ) : (
            <Stack spacing={1}>
              <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
                <TextField size="small" label="Setup Name" value={setupDraft.name} onChange={(e) => setSetupDraft((p) => (p ? { ...p, name: e.target.value } : p))} fullWidth />
                <TextField size="small" label="Track Name" value={setupDraft.trackName} onChange={(e) => setSetupDraft((p) => (p ? { ...p, trackName: e.target.value } : p))} fullWidth />
                <TextField size="small" type="number" label="Track Length (m)" value={setupDraft.lengthM} onChange={(e) => setSetupDraft((p) => (p ? { ...p, lengthM: Number(e.target.value) } : p))} sx={{ maxWidth: 180 }} />
                <TextField
                  size="small"
                  type="number"
                  label="Min. Lap Time (s)"
                  value={setupDraft.minLapTimeSecs}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v) && v > 0) setSetupDraft((p) => (p ? { ...p, minLapTimeSecs: v } : p));
                  }}
                  inputProps={{ min: 1, step: 1 }}
                  sx={{ maxWidth: 160 }}
                />
              </Stack>

              {/* Decoder-Backend */}
              <Stack direction={{ xs: "column", md: "row" }} spacing={1} alignItems="flex-start">
                <TextField
                  size="small"
                  select
                  label="Decoder Backend"
                  value={setupDraft.decoderBackend}
                  onChange={(e) => {
                    setSetupDraft((p) => p ? { ...p, decoderBackend: e.target.value as "ammc" | "p3parser" } : p);
                    setP3ScanResult(null);
                    setP3ScanError(null);
                  }}
                  sx={{ minWidth: 180 }}
                >
                  <MenuItem value="ammc">AMMC</MenuItem>
                  <MenuItem value="p3parser">P3 Parser</MenuItem>
                </TextField>
              </Stack>

              {/* P3 Discovery (nur bei p3parser) */}
              {setupDraft.decoderBackend === "p3parser" && (
                <Stack spacing={1}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Button variant="outlined" size="small" onClick={() => { void scanP3Decoders(); }} disabled={p3ScanLoading}>
                      {p3ScanLoading ? "Scanning…" : "P3 Decoder scannen"}
                    </Button>
                    {p3ScanError && <Typography variant="body2" color="error">{p3ScanError}</Typography>}
                  </Stack>
                  {p3ScanResult && p3ScanResult.decoders.length === 0 && (
                    <Typography variant="body2" color="text.secondary">Keine P3-Decoder im Netz gefunden.</Typography>
                  )}
                  {p3ScanResult && p3ScanResult.decoders.length > 0 && (
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>IP</TableCell>
                          <TableCell>Hardware-ID</TableCell>
                          <TableCell>Typ</TableCell>
                          <TableCell>Firmware</TableCell>
                          <TableCell>IP zuweisen</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {p3ScanResult.decoders.map((dec) => (
                          <TableRow key={`${dec.ip}:${dec.decoderId}`}>
                            <TableCell>{dec.ip}</TableCell>
                            <TableCell>{dec.decoderId}</TableCell>
                            <TableCell>{dec.decoderType}</TableCell>
                            <TableCell>{dec.firmwareVersion}</TableCell>
                            <TableCell>
                              <TextField
                                select
                                size="small"
                                value=""
                                onChange={(e) => {
                                  const idx = Number(e.target.value);
                                  if (Number.isFinite(idx) && idx >= 0) patchPoint(idx, { decoderIp: dec.ip });
                                }}
                                sx={{ minWidth: 130 }}
                              >
                                <MenuItem value="">— Timing-Point —</MenuItem>
                                {setupDraft.timingPoints.map((tp, i) => (
                                  <MenuItem key={tp.id} value={i}>{tp.name || `TP ${i + 1}`}</MenuItem>
                                ))}
                              </TextField>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </Stack>
              )}

              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>#</TableCell>
                    <TableCell>Name</TableCell>
                    <TableCell>Role</TableCell>
                    <TableCell>Dist (m)</TableCell>
                    <TableCell>Enabled</TableCell>
                    <TableCell>Simulation</TableCell>
                    <TableCell>Actions</TableCell>
                  </TableRow>


                </TableHead>
                <TableBody>
                  {setupDraft.timingPoints.map((point, index) => {
                    const simulationEnabled = (point.decoderType ?? "amb") === "sim";
                    const simulatedPointIndex = setupDraft.timingPoints.findIndex((p) => (p.decoderType ?? "amb") === "sim");
                    const canToggleSimulation = simulatedPointIndex < 0 || simulatedPointIndex === index;
                    const computedPassingDelay = calcSimPassingDelayMs(setupDraft.lengthM);
                    const computedStartupDelay = calcSimStartupDelaySecs(point.absolutePositionM);


                    return (
                      <Fragment key={point.id}>

                        <TableRow
                          key={`${point.id}:base`}
                          sx={{ "& > td": { borderBottom: "none" } }}
                        >

                          <TableCell>{index + 1}</TableCell>
                          <TableCell><TextField size="small" value={point.name} onChange={(e) => patchPoint(index, { name: e.target.value })} /></TableCell>
                          <TableCell>
                            <TextField size="small" select value={point.role} onChange={(e) => patchPoint(index, { role: e.target.value as LiveTrackingTimingPoint["role"] })}>
                              <MenuItem value="start_finish">start_finish</MenuItem>
                              <MenuItem value="split">split</MenuItem>
                            </TextField>
                          </TableCell>
                          <TableCell><TextField size="small" type="number" value={point.distanceFromPreviousM} onChange={(e) => patchPoint(index, { distanceFromPreviousM: Number(e.target.value) })} /></TableCell>

                          <TableCell><Checkbox checked={point.enabled} onChange={(e) => patchPoint(index, { enabled: e.target.checked })} /></TableCell>

                          <TableCell>
                            <Checkbox
                              checked={simulationEnabled}
                              disabled={!canToggleSimulation}
                              onChange={(e) => toggleSimulation(index, e.target.checked)}
                            />

                          </TableCell>
                          <TableCell><Button size="small" color="error" onClick={() => removePoint(index)}>Delete</Button></TableCell>
                        </TableRow>

                        <TableRow
                          key={`${point.id}:decoder`}
                          sx={simulationEnabled ? { "& > td": { borderBottom: "none" } } : undefined}
                        >

                          <TableCell />
                          <TableCell colSpan={6}>
                            <Stack direction={{ xs: "column", md: "row" }} spacing={1}>

                              <TextField
                                size="small"
                                label={setupDraft.decoderBackend === "p3parser" ? "IP (P3, Port 5403)" : "IP (AMMC)"}
                                value={point.decoderIp}
                                onChange={(e) => patchPoint(index, { decoderIp: e.target.value })}
                              />
                              {setupDraft.decoderBackend !== "p3parser" && (
                                <TextField
                                  size="small"
                                  type="number"
                                  label="WS-Port"
                                  value={point.websocketPortAMM}
                                  onChange={(e) => patchPoint(index, { websocketPortAMM: Number(e.target.value) })}
                                />
                              )}
                              <TextField
                                size="small"
                                type="text"
                                label="Time Offset (s)"
                                value={decoderOffsetInputByPointId[point.id] ?? String(point.decoderTimestampOffsetSecs ?? 0)}
                                inputProps={{ inputMode: "decimal", placeholder: "z. B. -1,234" }}
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  if (!/^-?\d*(?:[.,]\d*)?$/.test(raw)) return;
                                  setDecoderOffsetInputByPointId((prev) => ({ ...prev, [point.id]: raw }));
                                }}
                                onBlur={() => {
                                  const raw = decoderOffsetInputByPointId[point.id] ?? String(point.decoderTimestampOffsetSecs ?? 0);
                                  const parsed = parseDecoderOffsetSecondsInput(raw);
                                  if (parsed === null) {
                                    setDecoderOffsetInputByPointId((prev) => ({
                                      ...prev,
                                      [point.id]: String(point.decoderTimestampOffsetSecs ?? 0),
                                    }));
                                    return;
                                  }
                                  patchPoint(index, { decoderTimestampOffsetSecs: parsed });
                                  setDecoderOffsetInputByPointId((prev) => ({ ...prev, [point.id]: String(parsed) }));
                                }}
                              />
                            </Stack>
                          </TableCell>
                        </TableRow>

                        {simulationEnabled ? (

                          <TableRow key={`${point.id}:sim`}>
                            <TableCell colSpan={7}>


                              <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
                                <TextField
                                  size="small"
                                  label="Sim Tran Codes (comma separated)"
                                  value={(point.simTranCodes ?? []).join(",")}
                                  onChange={(e) => patchPoint(index, { simTranCodes: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })}
                                  fullWidth
                                />
                                <TextField size="small" label="Passing Delay (ms)" value={computedPassingDelay} InputProps={{ readOnly: true }} sx={{ minWidth: 180 }} />
                                <TextField size="small" label="Startup Delay (s)" value={computedStartupDelay} InputProps={{ readOnly: true }} sx={{ minWidth: 180 }} />
                              </Stack>
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </Fragment>

                    );
                  })}
                </TableBody>

              </Table>

              {setupIssues.length > 0 ? (
                <Box sx={{ p: 1, border: "1px solid", borderColor: "warning.light", borderRadius: 1 }}>
                  {setupIssues.map((issue, i) => (
                    <Typography key={`${issue.code}:${i}`} variant="body2" color="warning.main">
                      • {issue.message}
                    </Typography>
                  ))}
                </Box>
              ) : (
                <Typography variant="body2" color="success.main">
                  Setup validation looks good.
                </Typography>
              )}

              {/* Verknüpfte Pools: Namensanzeige aus liveTrackingList, aktiver Pool markiert */}
              <Stack spacing={0.5}>
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <Typography variant="body2" color="text.secondary" fontWeight="medium">
                    Participant Pools
                  </Typography>
                  <Button
                    component={RouterLink}
                    to="/live-tracking/participants"
                    variant={trackingDraft.setupId ? "contained" : "outlined"}
                    size="small"
                    disabled={!trackingDraft.setupId}
                  >
                    Participant Pools Verwalten →
                  </Button>
                </Box>
                {(setupDoc?.participantPoolIds ?? []).length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    — Noch keine Pools verknüpft
                  </Typography>
                ) : (
                  (setupDoc?.participantPoolIds ?? []).map((poolId) => {
                    const entry = poolEntries.find((p) => p.poolId === poolId);
                    const isActive = (setupDoc?.activeParticipantPoolIds ?? []).includes(poolId);
                    return (
                      <Typography key={poolId} variant="body2" color={isActive ? "primary" : "text.secondary"}>
                        • {entry?.name ?? poolId}{isActive ? " (aktiv)" : ""}
                      </Typography>
                    );
                  })
                )}
              </Stack>

              <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
                <Button variant="contained" onClick={addPoint}>
                  Add Timing Point
                </Button>
                <Button variant={setupDirty ? "contained" : "outlined"} color={setupDirty ? "primary" : "inherit"} onClick={saveSetup} disabled={!setupDirty}>
                  Save Setup Document
                </Button>
              </Stack>

            </Stack>
          )}
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardHeader title="Live Board" />
        <Divider />
        <CardContent>
          <LiveTrackingLiveBoard
            athleteLiveStates={results?.athleteLiveStates ?? []}
            resolveDisplayName={resolveControlBoardDisplayName}
            variant="split-inline"
            timingPointLabelById={timingPointLabelById}
          />

        </CardContent>
      </Card>


      <Card variant="outlined">
        <CardHeader title="Debug View" />
        <Divider />
        <CardContent>
          <Typography variant="body2">Worker: {runtime?.workerStatus ?? "—"}</Typography>
          <Typography variant="body2">Worker PID: {runtime?.workerProcessId ?? "—"}</Typography>
          <Typography variant="body2">Worker Host: {runtime?.workerHost ?? "—"}</Typography>
          <Typography variant="body2">Heartbeat: {runtime?.workerHeartbeatAt ?? "—"}</Typography>
          <Typography variant="body2">Invalid events: {(results?.invalidEvents ?? []).length}</Typography>
          <Typography variant="body2">Unknown transponders: {(results?.unknownTransponders ?? []).join(", ") || "—"}</Typography>

          <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
            Invalid event reasons
          </Typography>
          {invalidReasonCounts.length === 0 ? (
            <Typography variant="body2" color="text.secondary">—</Typography>
          ) : (
            <Stack spacing={0.5}>
              {invalidReasonCounts.map(([reason, count]) => (
                <Typography key={reason} variant="body2">
                  {reason}: {count}
                </Typography>
              ))}
            </Stack>
          )}

          <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
            Session Document
          </Typography>
          <Box
            component="pre"
            sx={{
              m: 0,
              p: 1,
              borderRadius: 1,
              bgcolor: "grey.100",
              fontFamily: "monospace",
              fontSize: 12,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {sessionJson}
          </Box>

          <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
            Setup Document
          </Typography>
          <Box
            component="pre"
            sx={{
              m: 0,
              p: 1,
              borderRadius: 1,
              bgcolor: "grey.100",
              fontFamily: "monospace",
              fontSize: 12,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {setupJson}
          </Box>

          <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
            Runtime Document
          </Typography>
          <Box
            component="pre"
            sx={{
              m: 0,
              p: 1,
              borderRadius: 1,
              bgcolor: "grey.100",
              fontFamily: "monospace",
              fontSize: 12,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {runtimeJson}
          </Box>

        </CardContent>
      </Card>

      <NewEntryDialog
        open={newSetupDialogOpen}
        title="New Setup"
        onConfirm={handleCreateSetup}
        onClose={() => setNewSetupDialogOpen(false)}
      />

      <ManageListDialog
        open={setupDialogOpen}
        title="Manage Setups"
        entries={setupEntries.map((e) => ({ id: e.setupId, name: e.name }))}
        onRename={renameSetup}
        onDelete={deleteSetup}
        onClose={() => setSetupDialogOpen(false)}
      />
    </Box>
  );
}

