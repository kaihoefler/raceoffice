import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Divider,
  IconButton,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import SaveIcon from "@mui/icons-material/Save";
import DeleteIcon from "@mui/icons-material/Delete";
import CloseIcon from "@mui/icons-material/Close";
import AddIcon from "@mui/icons-material/Add";
import HomeIcon from "@mui/icons-material/Home";
import {
  makeLiveTrackingParticipantPoolDocId,
  makeLiveTrackingSessionDocId,
  makeLiveTrackingSetupDocId,
  type LiveTrackingAthlete,
  type LiveTrackingParticipantPoolDocument,
  type LiveTrackingSessionDocument,
  type LiveTrackingSetupDocument,
  type StarterImportRow,
} from "@raceoffice/domain";
import { useNavigate } from "react-router-dom";
import RaceStartersImport from "../../components/RaceStartersImport";
import { useRealtimeDoc } from "../../realtime/useRealtimeDoc";


function nowIso(): string {
  return new Date().toISOString();
}

function parseBib(input: string): number | null {
  const v = String(input ?? "").trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeIoc(input: string): string | null {
  const v = String(input ?? "").trim().toUpperCase();
  return v || null;
}

function parseTransponderIds(input: string): string[] {
  return [...new Set(String(input ?? "").split(",").map((x) => x.trim()).filter(Boolean))];
}

function toParticipants(rows: StarterImportRow[]): LiveTrackingAthlete[] {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => String(r.firstName ?? "").trim() && String(r.lastName ?? "").trim())
    .map((r) => ({
      id: crypto.randomUUID(),
      bib: r.bib,
      firstName: String(r.firstName ?? "").trim(),
      lastName: String(r.lastName ?? "").trim(),
      nation: r.nation,
      ageGroupId: null,
      transponderIds: Array.isArray(r.transponderIds) ? r.transponderIds.map((x) => String(x ?? "").trim()).filter(Boolean) : [],
    }));
}

function nameKey(a: { firstName: string; lastName: string; nation: string | null }): string {
  return `${a.firstName.toLowerCase().trim()}|${a.lastName.toLowerCase().trim()}|${String(a.nation ?? "").toUpperCase().trim()}`;
}

function mergeParticipants(base: LiveTrackingAthlete[], incoming: LiveTrackingAthlete[]): LiveTrackingAthlete[] {
  const byBib = new Map<number, LiveTrackingAthlete>();
  const byName = new Map<string, LiveTrackingAthlete>();
  for (const athlete of base) {
    if (athlete.bib != null) byBib.set(athlete.bib, athlete);
    byName.set(nameKey(athlete), athlete);
  }

  const updates = new Map<string, LiveTrackingAthlete>();
  const additions: LiveTrackingAthlete[] = [];

  for (const next of incoming) {
    const match = (next.bib != null ? byBib.get(next.bib) : undefined) ?? byName.get(nameKey(next));
    if (match) {
      updates.set(match.id, { ...match, ...next, id: match.id });
    } else {
      additions.push(next);
    }
  }

  return [...base.map((a) => updates.get(a.id) ?? a), ...additions];
}

export default function LiveTrackingParticipantsPage() {
  const navigate = useNavigate();
  const sessionDocId = useMemo(() => makeLiveTrackingSessionDocId(), []);
  const { data: session, update: updateSession } = useRealtimeDoc<LiveTrackingSessionDocument>(sessionDocId);

  const setupId = (session?.setupId ?? "").trim();
  const setupDocId = setupId ? makeLiveTrackingSetupDocId(setupId) : null;
  const { data: setupDoc, update: updateSetup } = useRealtimeDoc<LiveTrackingSetupDocument>(setupDocId);

  const poolIds = useMemo(() => [...new Set((setupDoc?.participantPoolIds ?? []).map((x) => String(x ?? "").trim()).filter(Boolean))], [setupDoc]);
  const activePoolId = String(setupDoc?.activeParticipantPoolId ?? "").trim();
  const activePoolDocId = activePoolId ? makeLiveTrackingParticipantPoolDocId(activePoolId) : null;

  const { data: activePoolDoc, update: updatePool } = useRealtimeDoc<LiveTrackingParticipantPoolDocument>(activePoolDocId);

  const [newPoolId, setNewPoolId] = useState("");
  const [newDraft, setNewDraft] = useState({ bib: "", firstName: "", lastName: "", nation: "", transponderIds: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<{ bib: string; firstName: string; lastName: string; nation: string; transponderIds: string } | null>(null);

  useEffect(() => {
    if (!activePoolId || !activePoolDocId) return;
    updatePool((prev) => ({
      ...prev,
      poolId: activePoolId,
      setupId: setupId || null,
      eventId: prev.eventId ?? null,
      name: prev.name ?? activePoolId,
      athletes: prev.athletes ?? [],
      updatedAt: prev.updatedAt ?? null,
    }));
  }, [activePoolId, activePoolDocId, setupId, updatePool]);

  const participants = useMemo(() => {
    return [...(activePoolDoc?.athletes ?? [])].sort((a, b) => {
      const ai = a.bib ?? Number.MAX_SAFE_INTEGER;
      const bi = b.bib ?? Number.MAX_SAFE_INTEGER;
      return ai - bi;
    });
  }, [activePoolDoc]);

  function saveSetupPools(ids: string[], nextActive: string | null) {
    if (!setupId) return;
    const normalizedIds = [...new Set(ids.map((x) => String(x ?? "").trim()).filter(Boolean))];
    const active = nextActive && normalizedIds.includes(nextActive) ? nextActive : null;

    updateSetup((prev) => ({
      ...prev,
      setupId,
      eventId: prev.eventId ?? null,
      name: prev.name ?? "",
      track: prev.track ?? { id: "", name: "", lengthM: 0, timingPoints: [] },
      participantPoolIds: normalizedIds,
      activeParticipantPoolId: active,
      updatedAt: nowIso(),
    }));
  }

  function addPool() {
    const id = newPoolId.trim();
    if (!id) return;
    const ids = poolIds.includes(id) ? poolIds : [...poolIds, id];
    saveSetupPools(ids, activePoolId || id);
    setNewPoolId("");
  }

  function removePool(id: string) {
    const ids = poolIds.filter((x) => x !== id);
    saveSetupPools(ids, activePoolId === id ? (ids[0] ?? null) : activePoolId);
  }

  function setActivePool(id: string) {
    if (!id) return;
    saveSetupPools(poolIds, id);

    updateSession((prev) => ({
      ...prev,
      participantSource: {
        kind: "setup_participant_pool",
        eventId: prev.participantSource.eventId,
        setupId: prev.setupId,
        participantPoolDocId: makeLiveTrackingParticipantPoolDocId(id),
      },
      updatedAt: nowIso(),
    }));
  }

  function saveParticipants(next: LiveTrackingAthlete[]) {
    if (!activePoolId) return;
    updatePool((prev) => ({
      ...prev,
      poolId: activePoolId,
      setupId: setupId || null,
      eventId: prev.eventId ?? null,
      name: prev.name ?? activePoolId,
      athletes: next,
      updatedAt: nowIso(),
    }));
  }

  function addParticipant() {
    if (!newDraft.firstName.trim() || !newDraft.lastName.trim()) return;
    const candidate: LiveTrackingAthlete = {
      id: crypto.randomUUID(),
      bib: parseBib(newDraft.bib),
      firstName: newDraft.firstName.trim(),
      lastName: newDraft.lastName.trim(),
      nation: normalizeIoc(newDraft.nation),
      ageGroupId: null,
      transponderIds: parseTransponderIds(newDraft.transponderIds),
    };
    saveParticipants(mergeParticipants(activePoolDoc?.athletes ?? [], [candidate]));
    setNewDraft({ bib: "", firstName: "", lastName: "", nation: "", transponderIds: "" });
  }

  function beginEdit(athlete: LiveTrackingAthlete) {
    setEditingId(athlete.id);
    setEditingDraft({
      bib: athlete.bib == null ? "" : String(athlete.bib),
      firstName: athlete.firstName,
      lastName: athlete.lastName,
      nation: athlete.nation ?? "",
      transponderIds: (athlete.transponderIds ?? []).join(", "),
    });
  }

  function saveEdit() {
    if (!editingId || !editingDraft) return;
    const next = (activePoolDoc?.athletes ?? []).map((athlete) =>
      athlete.id === editingId
        ? {
            ...athlete,
            bib: parseBib(editingDraft.bib),
            firstName: editingDraft.firstName.trim(),
            lastName: editingDraft.lastName.trim(),
            nation: normalizeIoc(editingDraft.nation),
            transponderIds: parseTransponderIds(editingDraft.transponderIds),
          }
        : athlete,
    );
    saveParticipants(next);
    setEditingId(null);
    setEditingDraft(null);
  }

  async function handleImport(mode: "replace" | "merge", rows: StarterImportRow[]) {
    const incoming = toParticipants(rows);
    if (mode === "replace") {
      saveParticipants(incoming);
      return;
    }
    saveParticipants(mergeParticipants(activePoolDoc?.athletes ?? [], incoming));
  }

  return (
    <Box sx={{ display: "grid", gap: 2 }}>
      <Card variant="outlined">
        <CardHeader
          title="Setup Participant Pools"
          subheader="Standalone pools for LiveTracking (case 3)"
          action={
            <Tooltip title="Back to Live Tracking" arrow>
              <span>
                                <IconButton onClick={() => navigate("/live-tracking/setup")} aria-label="Back to Live Tracking">

                  <HomeIcon />
                </IconButton>
              </span>
            </Tooltip>
          }
        />
        <Divider />
        <CardContent>
          {!setupId ? (
            <Alert severity="info">Bitte zuerst im Live Tracking Control ein Setup auswählen.</Alert>
          ) : (
            <Stack spacing={1}>
              <Typography variant="body2">Aktives Setup: <strong>{setupId}</strong></Typography>

              <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
                <TextField size="small" label="Neue Pool ID" value={newPoolId} onChange={(e) => setNewPoolId(e.target.value)} fullWidth />
                <Button variant="outlined" onClick={addPool}>Pool hinzufügen</Button>
              </Stack>

              <TextField
                size="small"
                label="Aktiver Pool"
                select
                value={activePoolId}
                onChange={(e) => setActivePool(e.target.value)}
                fullWidth
              >
                {poolIds.length === 0 ? <MenuItem value="">(kein Pool)</MenuItem> : null}
                {poolIds.map((id) => (
                  <MenuItem key={id} value={id}>{id}</MenuItem>
                ))}
              </TextField>

              <Stack direction="row" spacing={1} flexWrap="wrap">
                {poolIds.map((id) => (
                  <Button key={id} size="small" color="error" variant="outlined" onClick={() => removePool(id)}>
                    Remove {id}
                  </Button>
                ))}
              </Stack>
            </Stack>
          )}
        </CardContent>
      </Card>

      {activePoolId ? (
        <>
          <Card variant="outlined">
            <CardHeader title={`Participants (${activePoolId})`} />
            <Divider />
            <CardContent>
              <Table
                size="small"
                sx={{
                  "& .MuiTableCell-root": {
                    py: 0.5,
                  },
                }}
              >
                <TableHead>
                  <TableRow>
                    <TableCell>Bib</TableCell>
                    <TableCell>FirstName</TableCell>
                    <TableCell>LastName</TableCell>
                    <TableCell>Nation</TableCell>
                    <TableCell>Transponder IDs</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {participants.map((athlete) => {
                    const isEditing = editingId === athlete.id;
                    return (
                      <TableRow key={athlete.id}>
                        <TableCell>{isEditing ? <TextField size="small" value={editingDraft?.bib ?? ""} onChange={(e) => setEditingDraft((p) => (p ? { ...p, bib: e.target.value } : p))} /> : athlete.bib ?? ""}</TableCell>
                        <TableCell>{isEditing ? <TextField size="small" value={editingDraft?.firstName ?? ""} onChange={(e) => setEditingDraft((p) => (p ? { ...p, firstName: e.target.value } : p))} /> : athlete.firstName}</TableCell>
                        <TableCell>{isEditing ? <TextField size="small" value={editingDraft?.lastName ?? ""} onChange={(e) => setEditingDraft((p) => (p ? { ...p, lastName: e.target.value } : p))} /> : athlete.lastName}</TableCell>
                        <TableCell>{isEditing ? <TextField size="small" value={editingDraft?.nation ?? ""} onChange={(e) => setEditingDraft((p) => (p ? { ...p, nation: e.target.value.toUpperCase() } : p))} /> : athlete.nation ?? ""}</TableCell>
                        <TableCell>{isEditing ? <TextField size="small" value={editingDraft?.transponderIds ?? ""} onChange={(e) => setEditingDraft((p) => (p ? { ...p, transponderIds: e.target.value } : p))} fullWidth /> : (athlete.transponderIds ?? []).join(", ")}</TableCell>
                        <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                          {isEditing ? (
                            <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, whiteSpace: "nowrap" }}>
                              <Tooltip title="Save"><IconButton size="small" onClick={saveEdit}><SaveIcon fontSize="small" /></IconButton></Tooltip>
                              <Tooltip title="Cancel"><IconButton size="small" onClick={() => { setEditingId(null); setEditingDraft(null); }}><CloseIcon fontSize="small" /></IconButton></Tooltip>
                            </Box>
                          ) : (
                            <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, whiteSpace: "nowrap" }}>
                              <Tooltip title="Edit"><IconButton size="small" onClick={() => beginEdit(athlete)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                              <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => saveParticipants((activePoolDoc?.athletes ?? []).filter((x) => x.id !== athlete.id))}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                            </Box>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}

                  <TableRow>
                    <TableCell>
                      <TextField size="small" value={newDraft.bib} onChange={(e) => setNewDraft((p) => ({ ...p, bib: e.target.value }))} />
                    </TableCell>
                    <TableCell>
                      <TextField size="small" value={newDraft.firstName} onChange={(e) => setNewDraft((p) => ({ ...p, firstName: e.target.value }))} />
                    </TableCell>
                    <TableCell>
                      <TextField size="small" value={newDraft.lastName} onChange={(e) => setNewDraft((p) => ({ ...p, lastName: e.target.value }))} />
                    </TableCell>
                    <TableCell>
                      <TextField size="small" value={newDraft.nation} onChange={(e) => setNewDraft((p) => ({ ...p, nation: e.target.value.toUpperCase() }))} />
                    </TableCell>
                    <TableCell>
                      <TextField size="small" value={newDraft.transponderIds} onChange={(e) => setNewDraft((p) => ({ ...p, transponderIds: e.target.value }))} fullWidth />
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                      <Tooltip title="Add participant">
                        <span>
                          <IconButton size="small" onClick={addParticipant} disabled={!newDraft.firstName.trim() || !newDraft.lastName.trim()}>
                            <AddIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <RaceStartersImport
            raceName={`Participant Pool ${activePoolId}`}
            ageGroupLabel={`Setup ${setupId || "—"}`}
            onImport={handleImport}
          />
        </>
      ) : (
        <Alert severity="info">Bitte mindestens einen Pool anlegen und aktivieren.</Alert>
      )}
    </Box>
  );
}

