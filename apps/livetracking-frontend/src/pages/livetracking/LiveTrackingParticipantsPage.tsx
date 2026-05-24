/**
 * LiveTrackingParticipantsPage
 * ----------------------------
 * Verwaltung der Participant Pools eines Setups und deren Athleten-Einträge.
 *
 * Fachlicher Kontext:
 * - Ein Setup kann mehrere Participant Pools haben (z.B. pro Disziplin oder Kategorie).
 * - Pools werden global in `liveTrackingList` geführt und per ID im Setup verknüpft.
 * - Der aktive Pool bestimmt, welche Athleten im laufenden Tracking sichtbar sind.
 * - Athleten werden per Transponder-ID dem Pool zugeordnet.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Autocomplete,
  Alert,
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
import TuneIcon from "@mui/icons-material/Tune";
import {
  makeLiveTrackingListDocId,
  makeLiveTrackingParticipantPoolDocId,
  makeLiveTrackingSessionDocId,
  makeLiveTrackingSetupDocId,
  type LiveTrackingAthlete,
  type LiveTrackingListDocument,
  type LiveTrackingParticipantPoolDocument,
  type LiveTrackingParticipantPoolEntry,
  type LiveTrackingSessionDocument,
  type LiveTrackingSetupDocument,
  type StarterImportRow,
} from "@raceoffice/domain";
import { useNavigate } from "react-router-dom";
import RaceStartersImport from "../../components/RaceStartersImport";
import { useRealtimeDoc } from "../../realtime/useRealtimeDoc";

// ---------------------------------------------------------------------------
// Lokale Hilfstypen
// ---------------------------------------------------------------------------

/** Erweitert den Pool-Listeneintrag um das optionale `inputValue`-Feld,
 *  das von der MUI-Autocomplete für die "Neu erstellen"-Option benötigt wird. */
type PoolOption = LiveTrackingParticipantPoolEntry & { inputValue?: string };

/** Filterfunktion für die Pool-Autocomplete: durchsucht Name und poolId. */
const filterPoolOptions = createFilterOptions<PoolOption>({
  stringify: (o) => `${o.name} ${o.poolId}`,
});

// ---------------------------------------------------------------------------
// ManagePoolsDialog
// ---------------------------------------------------------------------------

/**
 * Dialog zur vollständigen Verwaltung aller bekannten Pools in der globalen liveTrackingList.
 * Erlaubt Umbenennen und Löschen eines Pools unabhängig von seiner Setup-Zuordnung.
 * Löschen entfernt den Pool aus der globalen Liste; bestehende Verknüpfungen im Setup-Dokument
 * werden durch den Aufrufer bereinigt.
 */
function ManagePoolsDialog({
  open,
  pools,
  onRename,
  onDelete,
  onClose,
}: {
  open: boolean;
  pools: Array<{ poolId: string; name: string }>;
  onRename: (poolId: string, name: string) => void;
  onDelete: (poolId: string) => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = React.useState<Record<string, string>>({});

  function startEdit(poolId: string, name: string) {
    setEditing((p) => ({ ...p, [poolId]: name }));
  }

  function cancelEdit(poolId: string) {
    setEditing((p) => { const { [poolId]: _, ...rest } = p; return rest; });
  }

  function save(poolId: string) {
    const name = (editing[poolId] ?? "").trim();
    if (name) onRename(poolId, name);
    cancelEdit(poolId);
  }

  function handleClose() {
    setEditing({});
    onClose();
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle>Pools verwalten</DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        {pools.length === 0 ? (
          <Typography color="text.secondary" variant="body2" sx={{ p: 2 }}>
            Noch keine Pools vorhanden.
          </Typography>
        ) : (
          <List dense disablePadding>
            {pools.map((pool) => {
              const isEditing = pool.poolId in editing;
              return (
                <ListItem
                  key={pool.poolId}
                  divider
                  sx={{ pr: isEditing ? 18 : 11 }}
                  secondaryAction={
                    isEditing ? (
                      <Stack direction="row" spacing={0.5}>
                        <Button size="small" onClick={() => save(pool.poolId)}>Speichern</Button>
                        <Button size="small" color="inherit" onClick={() => cancelEdit(pool.poolId)}>Abbrechen</Button>
                      </Stack>
                    ) : (
                      <Stack direction="row" spacing={0}>
                        <IconButton size="small" onClick={() => startEdit(pool.poolId, pool.name)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => {
                            if (window.confirm(`Pool "${pool.name}" aus der globalen Liste löschen?`)) {
                              onDelete(pool.poolId);
                            }
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
                      value={editing[pool.poolId]}
                      onChange={(e) => setEditing((p) => ({ ...p, [pool.poolId]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") save(pool.poolId);
                        if (e.key === "Escape") cancelEdit(pool.poolId);
                      }}
                      autoFocus
                    />
                  ) : (
                    <ListItemText primary={pool.name} secondary={pool.poolId} />
                  )}
                </ListItem>
              );
            })}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Schließen</Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Reine Hilfsfunktionen
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

/** Parst eine Startnummer-Eingabe in eine Zahl oder null. */
function parseBib(input: string): number | null {
  const v = String(input ?? "").trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Normalisiert einen IOC-Nationscode auf Großbuchstaben oder null. */
function normalizeIoc(input: string): string | null {
  const v = String(input ?? "").trim().toUpperCase();
  return v || null;
}

/** Splittet eine kommagetrennte Transponder-ID-Liste und entfernt Duplikate. */
function parseTransponderIds(input: string): string[] {
  return [...new Set(String(input ?? "").split(",").map((x) => x.trim()).filter(Boolean))];
}

/** Konvertiert importierte Starterzeilen in LiveTracking-Athleten-Objekte. */
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
      transponderIds: Array.isArray(r.transponderIds)
        ? r.transponderIds.map((x) => String(x ?? "").trim()).filter(Boolean)
        : [],
    }));
}

/** Sortierkey für Athleten: Bib-basierter Vergleich, Name als Tie-Breaker. */
function nameKey(a: { firstName: string; lastName: string; nation: string | null }): string {
  return `${a.firstName.toLowerCase().trim()}|${a.lastName.toLowerCase().trim()}|${String(a.nation ?? "").toUpperCase().trim()}`;
}

/**
 * Führt bestehende und importierte Athleten zusammen.
 *
 * Matching-Strategie (in dieser Priorität):
 * 1. Gleiche Startnummer
 * 2. Gleicher Name + Nation
 * Bekannte Athleten werden aktualisiert, unbekannte angehängt.
 */
function mergeParticipants(
  base: LiveTrackingAthlete[],
  incoming: LiveTrackingAthlete[],
): LiveTrackingAthlete[] {
  const byBib = new Map<number, LiveTrackingAthlete>();
  const byName = new Map<string, LiveTrackingAthlete>();
  for (const athlete of base) {
    if (athlete.bib != null) byBib.set(athlete.bib, athlete);
    byName.set(nameKey(athlete), athlete);
  }

  const updates = new Map<string, LiveTrackingAthlete>();
  const additions: LiveTrackingAthlete[] = [];

  for (const next of incoming) {
    const match =
      (next.bib != null ? byBib.get(next.bib) : undefined) ?? byName.get(nameKey(next));
    if (match) {
      updates.set(match.id, { ...match, ...next, id: match.id });
    } else {
      additions.push(next);
    }
  }

  return [...base.map((a) => updates.get(a.id) ?? a), ...additions];
}

// ---------------------------------------------------------------------------
// Komponente
// ---------------------------------------------------------------------------

export default function LiveTrackingParticipantsPage() {
  const navigate = useNavigate();

  // --- Realtime-Dokument-Subscriptions ---

  const listDocId = useMemo(() => makeLiveTrackingListDocId(), []);
  const sessionDocId = useMemo(() => makeLiveTrackingSessionDocId(), []);

  const { data: liveTrackingList, update: updateList } =
    useRealtimeDoc<LiveTrackingListDocument>(listDocId);
  const { data: session } =
    useRealtimeDoc<LiveTrackingSessionDocument>(sessionDocId);

  const setupId = (session?.setupId ?? "").trim();
  const setupDocId = setupId ? makeLiveTrackingSetupDocId(setupId) : null;
  const { data: setupDoc, update: updateSetup } =
    useRealtimeDoc<LiveTrackingSetupDocument>(setupDocId);

  // Pool-IDs die explizit mit diesem Setup verknüpft sind
  const linkedPoolIds = useMemo(
    () =>
      [...new Set(
        (setupDoc?.participantPoolIds ?? []).map((x) => String(x ?? "").trim()).filter(Boolean),
      )],
    [setupDoc],
  );

  /** Pool-IDs die aktuell für das Tracking aktiv sind (Mehrfachauswahl). */
  const activePoolIds = useMemo(
    () => (setupDoc?.activeParticipantPoolIds ?? []).filter((id) => linkedPoolIds.includes(id)),
    [setupDoc, linkedPoolIds],
  );

  /** Lokal gewählter Pool für die Athleten-Anzeige und -Bearbeitung (kein Dokument-State). */
  const [viewingPoolId, setViewingPoolId] = useState<string>("");

  // Wenn kein Pool zum Anzeigen gewählt ist oder der gewählte Pool entfernt wurde → ersten verknüpften Pool wählen.
  useEffect(() => {
    if (!viewingPoolId || !linkedPoolIds.includes(viewingPoolId)) {
      setViewingPoolId(linkedPoolIds[0] ?? "");
    }
  }, [linkedPoolIds, viewingPoolId]);

  const viewingPoolDocId = viewingPoolId
    ? makeLiveTrackingParticipantPoolDocId(viewingPoolId)
    : null;

  const { data: activePoolDoc, update: updatePool } =
    useRealtimeDoc<LiveTrackingParticipantPoolDocument>(viewingPoolDocId);

  // --- Abgeleitete Pool-Daten aus der globalen Liste ---

  /** Alle bekannten Pools aus der globalen Registry. */
  const allPools = useMemo(
    () => (liveTrackingList?.participantPools ?? []) as PoolOption[],
    [liveTrackingList],
  );

  /**
   * Pools die noch nicht mit diesem Setup verknüpft sind.
   * Werden als Kandidaten in der "Pool hinzufügen"-Autocomplete angeboten.
   */
  const unlinkdPools = useMemo(
    () => allPools.filter((p) => !linkedPoolIds.includes(p.poolId)),
    [allPools, linkedPoolIds],
  );

  /** Löst eine poolId in den Anzeigenamen aus der globalen Liste auf. */
  const poolName = useCallback(
    (poolId: string): string =>
      allPools.find((p) => p.poolId === poolId)?.name || poolId,
    [allPools],
  );

  // --- Athleten-Draft-State ---

  const [addPoolKey, setAddPoolKey] = useState(0); // erzwingt Reset der Autocomplete nach Auswahl
  const [managePoolsOpen, setManagePoolsOpen] = useState(false);
  const [newDraft, setNewDraft] = useState({
    bib: "",
    firstName: "",
    lastName: "",
    nation: "",
    transponderIds: "",
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<{
    bib: string;
    firstName: string;
    lastName: string;
    nation: string;
    transponderIds: string;
  } | null>(null);

  // --- Initialisierung des aktiven Pool-Dokuments ---

  /**
   * Stellt sicher, dass das Pool-Dokument beim ersten Öffnen korrekt initialisiert ist.
   * Setzt fehlende Pflichtfelder auf sinnvolle Defaults, ohne vorhandene Daten zu überschreiben.
   */
  useEffect(() => {
    // activePoolDoc in deps: re-fires when the snapshot arrives so the update is not a no-op.
    // The update itself is idempotent — if all fields are already correct, the patch is empty.
    if (!viewingPoolId || !viewingPoolDocId || !activePoolDoc) return;
    updatePool((prev) => ({
      ...prev,
      kind: "liveTrackingParticipants" as const,
      version: 1 as const,
      poolId: viewingPoolId,
      eventId: prev.eventId ?? null,
      name: prev.name ?? poolName(viewingPoolId),
      // Also normalize bib: legacy docs may have stored bib as a string.
      athletes: (prev.athletes ?? []).map((a) => ({
        ...a,
        bib: typeof a.bib === "number" ? a.bib : parseBib(String(a.bib ?? "")),
      })),
      updatedAt: prev.updatedAt ?? null,
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewingPoolId, viewingPoolDocId, activePoolDoc, setupId, updatePool, poolName]);

  // Alphabetisch sortierte Athletenliste (Bib-Nummer aufsteigend)
  const participants = useMemo(() => {
    return [...(activePoolDoc?.athletes ?? [])].sort((a, b) => {
      const ai = a.bib ?? Number.MAX_SAFE_INTEGER;
      const bi = b.bib ?? Number.MAX_SAFE_INTEGER;
      return ai - bi;
    });
  }, [activePoolDoc]);

  // --- Pool-Verwaltung (Verknüpfung mit Setup) ---

  /**
   * Schreibt die verknüpften Pool-IDs und die aktiven Pool-IDs in das Setup-Dokument.
   * Aktive IDs werden gegen die verknüpften gefiltert (Konsistenzgarantie).
   */
  function saveSetupPools(ids: string[], nextActiveIds: string[]) {
    if (!setupId) return;
    const normalizedIds = [
      ...new Set(ids.map((x) => String(x ?? "").trim()).filter(Boolean)),
    ];
    const activeIds = nextActiveIds.filter((id) => normalizedIds.includes(id));

    updateSetup((prev) => ({
      ...prev,
      setupId,
      eventId: prev.eventId ?? null,
      name: prev.name ?? "",
      track: prev.track ?? { id: "", name: "", lengthM: 0, timingPoints: [] },
      participantPoolIds: normalizedIds,
      activeParticipantPoolIds: activeIds,
      updatedAt: nowIso(),
    }));
  }

  /**
   * Verknüpft einen bereits in der globalen Liste vorhandenen Pool mit diesem Setup.
   * Kein Schreiben in liveTrackingList notwendig – der Pool existiert bereits.
   */
  function linkExistingPool(poolId: string) {
    if (!poolId || linkedPoolIds.includes(poolId)) return;
    const ids = [...linkedPoolIds, poolId];
    saveSetupPools(ids, activePoolIds);
    setAddPoolKey((k) => k + 1);
  }

  /**
   * Erstellt einen neuen Pool in der globalen Liste und verknüpft ihn sofort mit diesem Setup.
   * Die UUID als poolId garantiert Kollisionsfreiheit auch bei gleichem Namen.
   */
  function createAndLinkPool(name: string) {
    const poolId = crypto.randomUUID();
    updateList((prev) => ({
      ...prev,
      participantPools: [
        ...(prev.participantPools ?? []),
        { poolId, name, updatedAt: nowIso() },
      ],
    }));
    const ids = [...linkedPoolIds, poolId];
    saveSetupPools(ids, activePoolIds);
    setAddPoolKey((k) => k + 1);
  }

  /** Entfernt die Verknüpfung eines Pools mit diesem Setup (Pool bleibt in der globalen Liste). */
  function unlinkPool(poolId: string) {
    const ids = linkedPoolIds.filter((x) => x !== poolId);
    const nextActiveIds = activePoolIds.filter((x) => x !== poolId);
    saveSetupPools(ids, nextActiveIds);
    if (viewingPoolId === poolId) setViewingPoolId(ids[0] ?? "");
  }

  /** Benennt einen Pool in der globalen liveTrackingList um. */
  function renamePool(poolId: string, name: string) {
    updateList((prev) => ({
      ...prev,
      participantPools: prev.participantPools.map((e) =>
        e.poolId === poolId ? { ...e, name, updatedAt: nowIso() } : e,
      ),
    }));
  }

  /**
   * Löscht einen Pool aus der globalen liveTrackingList und entfernt seine Verknüpfung
   * mit dem aktuellen Setup, falls vorhanden.
   */
  function deletePool(poolId: string) {
    updateList((prev) => ({
      ...prev,
      participantPools: prev.participantPools.filter((e) => e.poolId !== poolId),
    }));
    if (linkedPoolIds.includes(poolId)) {
      const ids = linkedPoolIds.filter((x) => x !== poolId);
      const nextActiveIds = activePoolIds.filter((x) => x !== poolId);
      saveSetupPools(ids, nextActiveIds);
      if (viewingPoolId === poolId) setViewingPoolId(ids[0] ?? "");
    }
  }

  /**
   * Schaltet einen Pool als aktiv/inaktiv für das Tracking um.
   * Mehrere Pools können gleichzeitig aktiv sein; der Worker merged ihre Athleten.
   */
  function toggleActivePool(poolId: string) {
    const nextActiveIds = activePoolIds.includes(poolId)
      ? activePoolIds.filter((id) => id !== poolId)
      : [...activePoolIds, poolId];
    saveSetupPools(linkedPoolIds, nextActiveIds);
  }

  // --- Athleten-Verwaltung ---

  /** Persistiert die übergebene Athletenliste im aktuell angezeigten Pool-Dokument. */
  function saveParticipants(next: LiveTrackingAthlete[]) {
    if (!viewingPoolId) return;
    updatePool((prev) => ({
      ...prev,
      kind: "liveTrackingParticipants" as const,
      version: 1 as const,
      poolId: viewingPoolId,
      eventId: prev.eventId ?? null,
      name: prev.name ?? poolName(viewingPoolId),
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

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const setupName = setupDoc?.name || setupId;

  return (
    <Box sx={{ display: "grid", gap: 2 }}>

      {/* ── Pool-Verwaltung für dieses Setup ── */}
      <Card variant="outlined">
        <CardHeader
          title="Setup Participant Pools"
          subheader={setupName ? `Setup: ${setupName}` : "Kein Setup aktiv"}
          action={
            <Stack direction="row">
              <Tooltip title="Alle Pools verwalten (umbenennen / löschen)" arrow>
                <span>
                  <IconButton
                    onClick={() => setManagePoolsOpen(true)}
                    aria-label="Pools verwalten"
                  >
                    <TuneIcon />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Back to Live Tracking" arrow>
                <span>
                  <IconButton
                    onClick={() => navigate("/live-tracking/setup")}
                    aria-label="Back to Live Tracking"
                  >
                    <HomeIcon />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
          }
        />
        <Divider />
        <CardContent>
          {!setupId ? (
            <Alert severity="info">
              Bitte zuerst im Live Tracking Control ein Setup auswählen.
            </Alert>
          ) : (
            <Stack spacing={2}>

              {/* Pool verknüpfen – aus globaler Liste wählen oder neu erstellen */}
              <Autocomplete<PoolOption, false, false, false>
                key={addPoolKey}
                size="small"
                fullWidth
                options={unlinkdPools}
                value={null}
                onChange={(_, option) => {
                  if (!option) return;
                  if (option.inputValue) {
                    createAndLinkPool(option.inputValue);
                  } else {
                    linkExistingPool(option.poolId);
                  }
                }}
                filterOptions={(options, params) => {
                  const filtered = filterPoolOptions(options, params);
                  const trimmed = params.inputValue.trim();
                  // "Neu erstellen"-Option nur wenn Name nicht bereits in der globalen Liste
                  if (
                    trimmed &&
                    !allPools.some(
                      (o) => o.name.toLowerCase() === trimmed.toLowerCase(),
                    )
                  ) {
                    filtered.push({
                      poolId: "__new__",
                      name: `Create "${trimmed}"`,
                      updatedAt: null,
                      inputValue: trimmed,
                    });
                  }
                  return filtered;
                }}
                getOptionLabel={(o) => (o.inputValue ? o.inputValue : o.name || o.poolId)}
                isOptionEqualToValue={(o, v) => o.poolId === v.poolId}
                selectOnFocus
                handleHomeEndKeys
                renderOption={(props, option) => {
                  const { key, ...rest } = props as React.HTMLAttributes<HTMLLIElement> & {
                    key: React.Key;
                  };
                  return (
                    <li key={key} {...rest}>
                      {option.inputValue ? (
                        <em>Create &quot;{option.inputValue}&quot;</em>
                      ) : (
                        option.name
                      )}
                    </li>
                  );
                }}
                renderInput={(params) => (
                  <TextField {...params} label="Pool hinzufügen oder neu erstellen" size="small" />
                )}
              />

              {/* Verknüpfte Pools – Checkbox: aktiv für Worker | Name: Klick zum Anzeigen | Entfernen */}
              {linkedPoolIds.length > 0 ? (
                <List dense disablePadding>
                  {linkedPoolIds.map((id) => {
                    const isActive = activePoolIds.includes(id);
                    const isViewing = viewingPoolId === id;
                    return (
                      <ListItem
                        key={id}
                        disableGutters
                        sx={{
                          borderRadius: 1,
                          bgcolor: isViewing ? "action.selected" : undefined,
                        }}
                        secondaryAction={
                          <Button
                            size="small"
                            color="error"
                            variant="text"
                            onClick={() => unlinkPool(id)}
                            sx={{ minWidth: 0 }}
                          >
                            Entfernen
                          </Button>
                        }
                      >
                        <Tooltip title={isActive ? "Aktiv für Tracking (klicken zum Deaktivieren)" : "Inaktiv (klicken zum Aktivieren)"} arrow>
                          <Checkbox
                            size="small"
                            checked={isActive}
                            onChange={() => toggleActivePool(id)}
                            color="success"
                          />
                        </Tooltip>
                        <ListItemText
                          primary={poolName(id)}
                          secondary={isActive ? `aktiv · ID: ${id}` : `ID: ${id}`}
                          slotProps={{ primary: { sx: { fontWeight: isViewing ? 700 : 400, cursor: "pointer" } } }}
                          onClick={() => setViewingPoolId(id)}
                        />
                      </ListItem>
                    );
                  })}
                </List>
              ) : (
                <Alert severity="info">
                  Noch kein Pool mit diesem Setup verknüpft.
                </Alert>
              )}

            </Stack>
          )}
        </CardContent>
      </Card>

      {/* ── Athleten-Verwaltung für den angezeigten Pool ── */}
      {viewingPoolId ? (
        <>
          <Card variant="outlined">
            <CardHeader
              title={`Participants – ${poolName(viewingPoolId)}`}
              subheader={`Pool-ID: ${viewingPoolId}`}
            />
            <Divider />
            <CardContent>
              <Table
                size="small"
                sx={{ "& .MuiTableCell-root": { py: 0.5 } }}
              >
                <TableHead>
                  <TableRow>
                    <TableCell>Bib</TableCell>
                    <TableCell>Vorname</TableCell>
                    <TableCell>Nachname</TableCell>
                    <TableCell>Nation</TableCell>
                    <TableCell>Transponder IDs</TableCell>
                    <TableCell align="right">Aktionen</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {participants.map((athlete) => {
                    const isEditing = editingId === athlete.id;
                    return (
                      <TableRow key={athlete.id}>
                        <TableCell>
                          {isEditing ? (
                            <TextField
                              size="small"
                              value={editingDraft?.bib ?? ""}
                              onChange={(e) =>
                                setEditingDraft((p) => (p ? { ...p, bib: e.target.value } : p))
                              }
                            />
                          ) : (
                            athlete.bib ?? ""
                          )}
                        </TableCell>
                        <TableCell>
                          {isEditing ? (
                            <TextField
                              size="small"
                              value={editingDraft?.firstName ?? ""}
                              onChange={(e) =>
                                setEditingDraft((p) =>
                                  p ? { ...p, firstName: e.target.value } : p,
                                )
                              }
                            />
                          ) : (
                            athlete.firstName
                          )}
                        </TableCell>
                        <TableCell>
                          {isEditing ? (
                            <TextField
                              size="small"
                              value={editingDraft?.lastName ?? ""}
                              onChange={(e) =>
                                setEditingDraft((p) =>
                                  p ? { ...p, lastName: e.target.value } : p,
                                )
                              }
                            />
                          ) : (
                            athlete.lastName
                          )}
                        </TableCell>
                        <TableCell>
                          {isEditing ? (
                            <TextField
                              size="small"
                              value={editingDraft?.nation ?? ""}
                              onChange={(e) =>
                                setEditingDraft((p) =>
                                  p ? { ...p, nation: e.target.value.toUpperCase() } : p,
                                )
                              }
                            />
                          ) : (
                            athlete.nation ?? ""
                          )}
                        </TableCell>
                        <TableCell>
                          {isEditing ? (
                            <TextField
                              size="small"
                              value={editingDraft?.transponderIds ?? ""}
                              onChange={(e) =>
                                setEditingDraft((p) =>
                                  p ? { ...p, transponderIds: e.target.value } : p,
                                )
                              }
                              fullWidth
                            />
                          ) : (
                            (athlete.transponderIds ?? []).join(", ")
                          )}
                        </TableCell>
                        <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                          {isEditing ? (
                            <Box
                              sx={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 0.5,
                                whiteSpace: "nowrap",
                              }}
                            >
                              <Tooltip title="Speichern">
                                <IconButton size="small" onClick={saveEdit}>
                                  <SaveIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="Abbrechen">
                                <IconButton
                                  size="small"
                                  onClick={() => {
                                    setEditingId(null);
                                    setEditingDraft(null);
                                  }}
                                >
                                  <CloseIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            </Box>
                          ) : (
                            <Box
                              sx={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 0.5,
                                whiteSpace: "nowrap",
                              }}
                            >
                              <Tooltip title="Bearbeiten">
                                <IconButton size="small" onClick={() => beginEdit(athlete)}>
                                  <EditIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="Löschen">
                                <IconButton
                                  size="small"
                                  color="error"
                                  onClick={() =>
                                    saveParticipants(
                                      (activePoolDoc?.athletes ?? []).filter(
                                        (x) => x.id !== athlete.id,
                                      ),
                                    )
                                  }
                                >
                                  <DeleteIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            </Box>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}

                  {/* Neue-Athlet-Zeile */}
                  <TableRow>
                    <TableCell>
                      <TextField
                        size="small"
                        value={newDraft.bib}
                        onChange={(e) => setNewDraft((p) => ({ ...p, bib: e.target.value }))}
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        value={newDraft.firstName}
                        onChange={(e) =>
                          setNewDraft((p) => ({ ...p, firstName: e.target.value }))
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        value={newDraft.lastName}
                        onChange={(e) =>
                          setNewDraft((p) => ({ ...p, lastName: e.target.value }))
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        value={newDraft.nation}
                        onChange={(e) =>
                          setNewDraft((p) => ({ ...p, nation: e.target.value.toUpperCase() }))
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        value={newDraft.transponderIds}
                        onChange={(e) =>
                          setNewDraft((p) => ({ ...p, transponderIds: e.target.value }))
                        }
                        fullWidth
                      />
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                      <Tooltip title="Athlet hinzufügen">
                        <span>
                          <IconButton
                            size="small"
                            onClick={addParticipant}
                            disabled={
                              !newDraft.firstName.trim() || !newDraft.lastName.trim()
                            }
                          >
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
            raceName={`Participant Pool ${poolName(viewingPoolId)}`}
            ageGroupLabel={`Setup ${setupName || "—"}`}
            onImport={handleImport}
          />
        </>
      ) : (
        <Alert severity="info">
          Bitte mindestens einen Pool mit diesem Setup verknüpfen.
        </Alert>
      )}

      <ManagePoolsDialog
        open={managePoolsOpen}
        pools={allPools.map((p) => ({ poolId: p.poolId, name: p.name }))}
        onRename={renamePool}
        onDelete={deletePool}
        onClose={() => setManagePoolsOpen(false)}
      />
    </Box>
  );
}
