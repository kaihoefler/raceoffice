// src/components/FinishLineScoring.tsx
//
// Komponente für “Finish Line Scoring”:
// - Quick-Entry: Rank + Bib eintippen und hinzufügen
// - Anzeige/Editing: Finisher-Tabelle mit Zeitfeld
// - Drag&Drop: Reihenfolge ändern; mit Shift beim Drop => Gleichstand (Tie) erzeugen
// - Optionaler Flow: Wenn Bib nicht in Startern ist, Dialog zum Anlegen anzeigen,
//   dann nach Server-Roundtrip automatisch hinzufügen.

import { type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
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

import DeleteIcon from "@mui/icons-material/Delete";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";

import { createFilterOptions } from "@mui/material/useAutocomplete";

import PointsBibField, { type AthleteFilterOptions } from "./PointsBibField";
import ScoringStarterList from "./ScoringStarterList";

import type { Athlete } from "../types/athlete";
import type { Race, RaceResult } from "../types/race";

type Props = {
  race: Race;
  /** Use e.g. race.id so the component can reset when switching races */
  resetKey?: string;

  /** Persist the updated raceResults back into the race (page updates realtime doc) */
  onChangeRaceResults: (next: RaceResult[]) => void;

  /** Optional: when a bib is not in starters, ask to create it (same flow as PointsScoring). */
  onCreateStarters?: (bibs: number[]) => Promise<void> | void;
};

/**
 * Konvertiert eine Bib-Eingabe in eine positive Integer-Zahl.
 * - null wenn leer/ungültig
 * - > 0 (Startnummern <= 0 werden verworfen)
 */
function bibToInt(input: string): number | null {
  const v = String(input ?? "").trim();
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  return i > 0 ? i : null;
}

/** Format für Anzeige in Dropdown/Tooltip. */
function athleteLabel(a: Athlete) {
  return `${a.bib ?? ""} - ${(a.lastName ?? "").trim()} ${(a.firstName ?? "").trim()}`.trim();
}

/**
 * Bildet “Tie”-Gruppen aus Finishern, anhand finishRank.
 * Erwartet: finishers sind bereits sortiert nach (finishRank asc, bib asc).
 *
 * Beispiel:
 *   [ (rank 1), (rank 1), (rank 3) ] -> [ [..1..], [..1..], [..3..] ]
 */
function groupFinishersByFinishRank(sortedFinishers: RaceResult[]): RaceResult[][] {
  const groups: RaceResult[][] = [];
  let lastRank: number | null = null;

  for (const r of sortedFinishers) {
    const rank = Number(r?.finishRank ?? 0) || 0;
    if (!groups.length || rank !== lastRank) {
      groups.push([r]);
      lastRank = rank;
    } else {
      groups[groups.length - 1].push(r);
    }
  }

  return groups;
}

/**
 * Wendet “Competition ranking” (auch: 1224-Style) an:
 * - Gleichstand belegt gleiche Platzierung
 * - nächste Platzierung springt um die Gruppengröße weiter
 *   z.B. 1,1,3 statt 1,1,2.
 */
function applyCompetitionRanking(groups: RaceResult[][]): RaceResult[] {
  let nextRank = 1;
  const out: RaceResult[] = [];

  for (const g of groups) {
    // innerhalb der Tie-Gruppe nach Bib sortieren, damit Anzeige stabil bleibt
    const items = [...g].sort((a, b) => Number(a.bib ?? 0) - Number(b.bib ?? 0));
    for (const r of items) out.push({ ...r, finishRank: nextRank });
    nextRank += items.length;
  }

  return out;
}

/** Konvertiert Rank-Eingabe in positive Integer-Zahl. */
function rankToInt(input: string): number | null {
  const v = String(input ?? "").trim();
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  return i > 0 ? i : null;
}

/**
 * Vorschlag für nächsten Rank im Quick-Entry.
 * - Wenn keine Finisher: 1
 * - Sonst: maxRank + size(tieGroupAtMaxRank)
 *   => wenn letzter Rank ein Tie ist, springt Vorschlag korrekt weiter.
 */
function computeNextSuggestedRank(finishers: RaceResult[]): number {
  if (!finishers.length) return 1;

  let maxRank = 0;
  for (const r of finishers) {
    const fr = Number(r?.finishRank ?? 0);
    if (Number.isFinite(fr) && fr > maxRank) maxRank = fr;
  }

  if (maxRank <= 0) return 1;

  const countAtMax = finishers.filter((r) => Number(r?.finishRank ?? 0) === maxRank).length;
  return maxRank + Math.max(1, countAtMax);
}

/**
 * Auto-Pick UX: Wenn User eine Bib tippt und diese eindeutig ist, wird sie automatisch “selected”.
 * Schutz gegen “zu frühes” Pick:
 * - Eingabe "1" und es gibt "12" => nicht autopicken.
 */
function tryAutoPickUniqueBib(input: string, candidates: Athlete[]): Athlete | null {
  const v = input.trim();
  if (!/^[0-9]+$/.test(v)) return null;

  const exact = candidates.find((a) => a.bib !== null && String(a.bib) === v) ?? null;
  if (!exact) return null;

  const hasLongerPrefix = candidates.some(
    (a) => a.bib !== null && String(a.bib).startsWith(v) && String(a.bib) !== v,
  );
  if (hasLongerPrefix) return null;

  return exact;
}

export default function FinishLineScoring({
  race,
  resetKey,
  onChangeRaceResults,
  onCreateStarters,
}: Props) {
  /**
   * Starterliste sortieren:
   * - Primär nach bib
   * - Sekundär nach Nachname (case-insensitive)
   */
  const starters = useMemo(() => {
    const s = race.raceStarters ?? [];
    return [...s].sort((a, b) => {
      const ai = a.bib ?? Number.MAX_SAFE_INTEGER;
      const bi = b.bib ?? Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return (a.lastName ?? "").localeCompare(b.lastName ?? "", undefined, { sensitivity: "base" });
    });
  }, [race.raceStarters]);

  /** Map für schnellen Lookup: bib -> Athlete */
  const starterByBib = useMemo(() => {
    const m = new Map<number, Athlete>();
    for (const a of starters) {
      if (a.bib != null) m.set(a.bib, a);
    }
    return m;
  }, [starters]);

  /**
   * Alle raceResults des Rennens (defensiv eingelesen).
   * Wichtig: finishers werden separat gefiltert/sortiert.
   */
  const raceResults = useMemo(() => {
    const raw = Array.isArray((race as any)?.raceResults) ? ((race as any).raceResults as RaceResult[]) : [];
    return [...raw];
  }, [race]);

  /**
   * Finisher = alle Ergebnisse mit finishRank != 0.
   * Sortierung ist die Basis für:
   * - Anzeige im Table
   * - Tie-Gruppierung
   * - Drag&Drop Re-Ranking
   */
  const finishers = useMemo(() => {
    return raceResults
      .filter((r) => Number(r?.finishRank ?? 0) !== 0)
      .sort((a, b) => {
        const ar = Number(a.finishRank ?? 0) || 9999;
        const br = Number(b.finishRank ?? 0) || 9999;
        if (ar !== br) return ar - br;
        return Number(a.bib ?? 0) - Number(b.bib ?? 0);
      });
  }, [raceResults]);

  /** Set an Starter-IDs, die in den finishers vorkommen (für Starterliste-Highlight). */
  const selectedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of finishers) {
      const a = starterByBib.get(Number(r.bib)) ?? null;
      if (a) ids.add(a.id);
    }
    return ids;
  }, [finishers, starterByBib]);

  /** Set an Bibs, die bereits in finishers sind (damit wir sie nicht erneut vorschlagen). */
  const finishBibSet = useMemo(() => new Set(finishers.map((r) => Number(r.bib))), [finishers]);

  // -------------------------
  // UI-State (Quick Entry)
  // -------------------------
  const [rankInput, setRankInput] = useState("");
  const [bibInput, setBibInput] = useState("");
  const [selBib, setSelBib] = useState<Athlete | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fokus-Management für schnelles Tippen.
  const bibRef = useRef<HTMLInputElement>(null);

  // Drag&Drop State (Index des gezogenen Rows).
  const dragFromIndexRef = useRef<number | null>(null);

  // -------------------------
  // Dialog/Flow: fehlende Starter anlegen
  // -------------------------
  const [missingDialogOpen, setMissingDialogOpen] = useState(false);
  const [missingDialogBibs, setMissingDialogBibs] = useState<number[]>([]);
  const [missingDialogBusy, setMissingDialogBusy] = useState(false);

  /**
   * Non-optimistic Backend:
   * Wenn wir Starter anlegen, müssen wir auf das Update warten, bis es wieder in props erscheint.
   * Erst dann fügen wir den Finisher-Eintrag hinzu, um rev-mismatch zu vermeiden.
   */
  const [pendingAddBib, setPendingAddBib] = useState<number | null>(null);
  const [pendingAddRank, setPendingAddRank] = useState<number | null>(null);

  /**
   * Autocomplete-Filter:
   * - wir zeigen Vorschläge nur, wenn wirklich getippt wurde
   * - stringify bestimmt die Felder, die durchsucht werden
   */
  const filterOptions: AthleteFilterOptions = useMemo(() => {
    const base = createFilterOptions<Athlete>({
      stringify: (o) => `${o.bib ?? ""} ${(o.lastName ?? "")} ${(o.firstName ?? "")} ${(o.nation ?? "")}`,
      trim: true,
    });

    return (options, state) => {
      if (!state.inputValue.trim()) return [];
      return base(options, state);
    };
  }, []);

  /** Dropdown-Optionen: nur Starter mit Bib und nicht bereits in finishers. */
  const bibOptions = useMemo(() => {
    return starters.filter((a) => a.bib != null && !finishBibSet.has(a.bib));
  }, [starters, finishBibSet]);

  /**
   * Falls Bib nicht in starters existiert, aber wir sie anzeigen/selektieren möchten,
   * erzeugen wir einen Placeholder-Athleten (ohne Namen).
   */
  function makePlaceholderAthlete(bib: number): Athlete {
    return {
      id: `placeholder_${race.id}_${bib}`,
      bib,
      firstName: "",
      lastName: "",
      ageGroupId: race.ageGroupId ?? null,
      nation: null,
    };
  }

  /** Liefert Starter (falls vorhanden) oder Placeholder (falls nicht). */
  function resolveOrPlaceholder(bibText: string): Athlete | null {
    const bib = bibToInt(bibText);
    if (bib == null) return null;
    return starterByBib.get(bib) ?? makePlaceholderAthlete(bib);
  }

  function closeMissingStartersDialog() {
    setMissingDialogOpen(false);
    setMissingDialogBibs([]);
  }

  /**
   * Reset bei Rennwechsel (race.id oder resetKey):
   * - Eingaben/Fehler zurücksetzen
   * - Dialog schließen
   * - pending states löschen
   * - Fokus ins Bib-Feld setzen
   */
  useEffect(() => {
    setRankInput(String(computeNextSuggestedRank(finishers)));
    setBibInput("");
    setSelBib(null);
    setError(null);
    closeMissingStartersDialog();
    setPendingAddBib(null);
    setPendingAddRank(null);

    setTimeout(() => bibRef.current?.focus(), 0);
  }, [resetKey, race.id]);

  /**
   * Wenn sich finishers ändern (z.B. nach Save/prop update), aktualisieren wir den Rank-Vorschlag.
   * Aber: nicht, wenn der User gerade tippt / Dialog offen / pending add läuft.
   */
  useEffect(() => {
    if (bibInput.trim()) return;
    if (missingDialogOpen) return;
    if (pendingAddBib != null) return;

    setRankInput(String(computeNextSuggestedRank(finishers)));
  }, [finishers, bibInput, missingDialogOpen, pendingAddBib]);

  /** Default-RaceResult für neue Bib, falls sie noch nicht in raceResults existiert. */
  function makeDefaultRaceResult(bib: number): RaceResult {
    return {
      bib,
      rank: 0,
      points: 0,
      eliminated: false,
      eliminationLap: 0,
      dns: false,
      dsq: false,
      lapsCompleted: 0,
      finishTime: "",
      finishRank: 0,
    };
  }

  /**
   * “Commit” zum Hinzufügen eines Finishers:
   * - existierendes RaceResult wird weiterverwendet, wenn vorhanden
   * - finishers werden ergänzt & sortiert
   * - danach wird in die vollständige raceResults-Liste zurückgemerged
   * - danach onChangeRaceResults() -> parent persistiert
   */
  function commitAddBib(bib: number, finishRank: number) {
    const existing = raceResults.find((r) => Number(r?.bib) === bib) ?? null;
    const base: RaceResult = existing ? { ...existing } : makeDefaultRaceResult(bib);

    const nextFinishers = [
      ...finishers,
      {
        ...base,
        finishRank,
        // vorhandene Werte (falls existierend) behalten
        lapsCompleted: Number.isFinite(Number(base.lapsCompleted)) ? Number(base.lapsCompleted) : 0,
        finishTime: String(base.finishTime ?? ""),
      },
    ].sort((a, b) => {
      const ar = Number(a.finishRank ?? 0) || 9999;
      const br = Number(b.finishRank ?? 0) || 9999;
      if (ar !== br) return ar - br;
      return Number(a.bib ?? 0) - Number(b.bib ?? 0);
    });

    // Map für schnellen Merge bib -> updated RaceResult
    const nextByBib = new Map<number, RaceResult>();
    for (const r of nextFinishers) nextByBib.set(Number(r.bib), r);

    const nextRaceResults: RaceResult[] = [];

    // 1) Bestehende entries updaten (wenn in nextByBib)
    for (const r of raceResults) {
      const bibNum = Number((r as any)?.bib);
      if (!Number.isFinite(bibNum)) continue;

      const updated = nextByBib.get(bibNum);
      nextRaceResults.push(updated ? { ...r, ...updated } : r);
      nextByBib.delete(bibNum);
    }

    // 2) Neue entries anhängen (Bib war vorher nicht in raceResults)
    for (const r of nextByBib.values()) nextRaceResults.push(r);

    onChangeRaceResults(nextRaceResults);

    // UI “schnell weiter tippen”
    setRankInput(String(computeNextSuggestedRank(nextFinishers)));
    setBibInput("");
    setSelBib(null);
    setError(null);
    setTimeout(() => bibRef.current?.focus(), 0);
  }

  /**
   * Validiert Rank+Bib aus Textfeldern und entscheidet:
   * - wenn Bib schon Finisher -> Fehler
   * - wenn Bib kein Starter -> ggf Dialog zum Anlegen (wenn onCreateStarters vorhanden)
   * - sonst: commitAddBib
   */
  function requestAddBibFromText(bibText: string, rankText: string) {
    const finishRank = rankToInt(rankText);
    if (finishRank == null) {
      setError("Bitte einen gültigen Rank eingeben");
      return;
    }

    const bib = bibToInt(bibText);
    if (bib == null) {
      setError("Bitte eine gültige Startnummer eingeben");
      return;
    }

    if (finishers.some((r) => Number(r.bib) === bib)) {
      setError(`Startnummer ${bib} ist bereits in der Finisher-Liste`);
      return;
    }

    // Starter fehlt -> Create-Flow (wenn aktiviert)
    if (!starterByBib.has(bib)) {
      if (!onCreateStarters) {
        setError(`Startnummer ${bib} ist nicht in der Starterliste`);
        return;
      }

      // pending: wir merken uns, was später hinzugefügt werden soll
      setPendingAddBib(bib);
      setPendingAddRank(finishRank);

      setMissingDialogBibs([bib]);
      setMissingDialogOpen(true);
      return;
    }

    commitAddBib(bib, finishRank);
  }

    /** Dialog: Starter anlegen (async) */
  async function handleDialogCreateAndAdd() {
    // Wenn das Feature nicht aktiv ist, gibt es nichts zu tun.
    if (!onCreateStarters) return;

    try {
      // UI in “busy” Zustand setzen, um z.B. doppelte Klicks zu verhindern.
      setMissingDialogBusy(true);

      // Starter anlegen (Backend/Parent-Logik). Kann async sein.
      await onCreateStarters(missingDialogBibs);

      // Dialog schließen. Das “eigentliche Hinzufügen” passiert NICHT hier,
      // sondern im Effect weiter unten, sobald die Starter wirklich in props auftauchen.
      closeMissingStartersDialog();
    } finally {
      // Busy immer zurücksetzen (auch bei Error/Reject).
      setMissingDialogBusy(false);
    }
  }

  /** Dialog: Abbrechen => Dialog schließen + pending states verwerfen. */
  function handleDialogCancel() {
    closeMissingStartersDialog();
    setPendingAddBib(null);
    setPendingAddRank(null);
  }

  /**
   * Wenn wir auf das Anlegen eines Starters warten (pendingAddBib),
   * und dieser Starter dann tatsächlich in starterByBib auftaucht (props update),
   * dann fügen wir den Finisher automatisch hinzu.
   */
  useEffect(() => {
    if (pendingAddBib == null) return;

    // Falls die Bib inzwischen bereits als Finisher existiert (z.B. parallel hinzugefügt),
    // stoppen wir den Pending-Flow.
    if (finishers.some((r) => Number(r.bib) === pendingAddBib)) {
      setPendingAddBib(null);
      setPendingAddRank(null);
      return;
    }

    // Warten, bis der neue Starter im lokalen Starter-Set angekommen ist.
    // (Non-optimistic: erst nach Server Roundtrip.)
    if (!starterByBib.has(pendingAddBib)) return;

    const bib = pendingAddBib;
    const rank = pendingAddRank;

    // Pending-State aufräumen (wir committen jetzt).
    setPendingAddBib(null);
    setPendingAddRank(null);

    // Rank sollte gesetzt sein; falls nicht, fallback auf aktuellen Vorschlag.
    commitAddBib(bib, rank ?? computeNextSuggestedRank(finishers));
  }, [pendingAddBib, pendingAddRank, finishers, starterByBib]);

  /**
   * Persistiert eine neue Finisher-Liste zurück in raceResults.
   * - nextFinishers enthält die komplette, neu sortierte Finisher-Ansicht
   * - removedBibs markiert Bibs, die “entfernt” wurden (finishRank=0, time="").
   *
   * Hinweis: Wir mergen immer in die Gesamtstruktur raceResults zurück,
   * damit nicht-Finisher Ergebnisse erhalten bleiben.
   */
  function commitFinishers(nextFinishers: RaceResult[], removedBibs: Set<number> = new Set()) {
    // Map für Updates: bib -> RaceResult
    const nextByBib = new Map<number, RaceResult>();
    for (const r of nextFinishers) nextByBib.set(Number(r.bib), r);

    const nextRaceResults: RaceResult[] = [];

    // Bestehende raceResults durchlaufen und ggf. aktualisieren
    for (const r of raceResults) {
      const bibNum = Number((r as any)?.bib);
      if (!Number.isFinite(bibNum)) continue;

      // Entfernen bedeutet: finishRank zurücksetzen + time löschen (hier bewusst)
      if (removedBibs.has(bibNum)) {
        nextRaceResults.push({
          ...r,
          finishRank: 0,
          finishTime: "",
        });
        continue;
      }

      // Wenn es einen Update-Eintrag gibt: mergen
      const updated = nextByBib.get(bibNum);
      nextRaceResults.push(updated ? { ...r, ...updated } : r);

      // Aus Map entfernen, damit am Ende nur “neue” übrig bleiben
      nextByBib.delete(bibNum);
    }

    // Übrig gebliebene Einträge aus nextByBib sind neu und müssen angehängt werden
    for (const r of nextByBib.values()) nextRaceResults.push(r);

    // Parent persistiert (Realtime Doc etc.)
    onChangeRaceResults(nextRaceResults);
  }

  /**
   * Entfernt einen Finisher an Tabellen-Index idx:
   * - entfernt ihn aus der Finisher-Liste
   * - markiert die Bib als “removed” (finishRank=0, time="")
   */
  function removeAt(idx: number) {
    const bib = Number(finishers[idx]?.bib);
    if (!Number.isFinite(bib)) return;

    const nextFinishers = finishers.filter((_, i) => i !== idx);
    commitFinishers(nextFinishers, new Set([bib]));
  }

  /**
   * Patcht einen einzelnen Finisher-Eintrag (aktuell nur finishTime).
   * Wir bilden eine neue Finisher-Liste und committen sie komplett,
   * damit die Datenquelle konsistent bleibt.
   */
  function updateAt(idx: number, patch: Partial<Pick<RaceResult, "finishTime">>) {
    const nextFinishers = finishers.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    commitFinishers(nextFinishers);
  }

  /** Drag Start: Index merken, von dem gezogen wurde. */
  function onDragStart(idx: number) {
    dragFromIndexRef.current = idx;
  }

  /**
   * Drop-Handler:
   * - ohne Shift: zieht Athlet vor die Ziel-(Tie-)Gruppe als eigene Gruppe (also neuer Rang)
   * - mit Shift: zieht Athlet in die Zielgruppe hinein => Gleichstand
   *
   * Danach: applyCompetitionRanking() neu berechnet finishRank für alle Gruppen.
   */
  function onDrop(e: DragEvent<HTMLElement>, idx: number) {
    const from = dragFromIndexRef.current;
    dragFromIndexRef.current = null;

    // Guard-Clauses: ungültige DnD-States abfangen
    if (from == null) return;
    if (from === idx) return;

    const dragged = finishers[from];
    const target = finishers[idx];
    if (!dragged || !target) return;

    const draggedBib = Number(dragged.bib);
    const targetBib = Number(target.bib);
    if (!Number.isFinite(draggedBib) || !Number.isFinite(targetBib)) return;

    // Shift => tie, ohne Shift => eigener Rang vor Ziel
    const withShift = e.shiftKey;

    // 1) Gruppen aus aktuellem Zustand erzeugen
    const groups = groupFinishersByFinishRank(finishers);

    // 2) Dragged aus seiner bisherigen Gruppe entfernen
    for (let gi = 0; gi < groups.length; gi++) {
      const g = groups[gi];
      const nextG = g.filter((r) => Number(r.bib) !== draggedBib);
      if (nextG.length !== g.length) {
        // Wenn Gruppe leer geworden ist: ganze Gruppe entfernen
        if (nextG.length === 0) groups.splice(gi, 1);
        else groups[gi] = nextG;
        break;
      }
    }

    // 3) Zielgruppe finden (nachdem dragged entfernt wurde)
    const targetGroupIndex = groups.findIndex((g) => g.some((r) => Number(r.bib) === targetBib));
    if (targetGroupIndex < 0) return;

    // 4) Einfügen: entweder in Zielgruppe (tie) oder als eigene Gruppe davor
    if (withShift) {
      groups[targetGroupIndex] = [...groups[targetGroupIndex], dragged];
    } else {
      groups.splice(targetGroupIndex, 0, [dragged]);
    }

    // 5) finishRank neu berechnen (competition ranking) und speichern
    const nextFinishers = applyCompetitionRanking(groups);
    commitFinishers(nextFinishers);
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      {/* Quick entry: Rank + Bib => Add */}
      <Box sx={{ p: 2, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, mb: 1 }}>
          <Typography variant="subtitle2">Finish</Typography>
          <Typography variant="caption" color="text.secondary">
            {/* Anzahl aktueller Finisher */}
            {finishers.length}
          </Typography>
        </Box>

        <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
          {/* Rank Eingabe */}
          <TextField
            value={rankInput}
            onChange={(e) => {
              setRankInput((e.target as HTMLInputElement).value);
              setError(null);
            }}
            onKeyDown={(e) => {
              // Enter im Rank-Feld: Fokus direkt ins Bib-Feld,
              // damit man Rank einmal setzt und dann nur noch Bibs tippt.
              if (e.key === "Enter") {
                e.preventDefault();
                setTimeout(() => bibRef.current?.focus(), 0);
              }
            }}
            placeholder="Rank"
            size="small"
            variant="outlined"
            inputProps={{ inputMode: "numeric", pattern: "[0-9]*" }}
            sx={{ width: 80 }}
          />

          {/* Bib Eingabe mit Autocomplete */}
          <Box sx={{ width: 140 }}>
            <PointsBibField
              value={selBib}
              inputValue={bibInput}
              inputRef={bibRef}
              options={bibOptions}
              filterOptions={filterOptions}
              formatOption={athleteLabel}
              resolveByBib={resolveOrPlaceholder}
              placeholder="Bib"
              nameAdornmentMaxWidth={180}
              onInputValueChange={(v, reason) => {
                setBibInput(v);
                setError(null);

                // Nur bei direktem Tippen autopicken, nicht bei programmatic changes
                if (reason !== "input") return;

                // Auswahl zurücksetzen und ggf. unique Bib autopicken
                setSelBib(null);
                const pick = tryAutoPickUniqueBib(v, bibOptions);
                if (pick) {
                  setSelBib(pick);
                  setBibInput(pick.bib != null ? String(pick.bib) : "");
                }
              }}
              onSelect={(next) => {
                // Auswahl aus Dropdown
                setError(null);
                setSelBib(next);
                setBibInput(next?.bib != null ? String(next.bib) : "");
              }}
              onEnter={() => {
                // Enter im Bib-Feld => hinzufügen
                setError(null);

                // Wenn gültige Bib getippt ist, wollen wir den “Name Adornment” anzeigen:
                // daher resolveOrPlaceholder und als selBib setzen.
                const m = resolveOrPlaceholder(bibInput);
                if (m) {
                  setSelBib(m);
                  setBibInput(m.bib != null ? String(m.bib) : "");
                }

                requestAddBibFromText(bibInput, rankInput);
              }}
            />
          </Box>

          {/* Add Button als Alternative zu Enter */}
          <Button size="small" variant="contained" onClick={() => requestAddBibFromText(bibInput, rankInput)}>
            Add
          </Button>

          <Typography variant="caption" color="text.secondary" sx={{ ml: "auto" }}>
            Tip bibs in order and press Enter.
          </Typography>
        </Box>

        {/* Fehleranzeige */}
        {error ? (
          <Typography variant="caption" color="error" sx={{ display: "block", mt: 0.75 }}>
            {error}
          </Typography>
        ) : null}
      </Box>

      {/* Results table: Finisher-Liste inkl. Drag&Drop + Zeit editieren */}
      <Box sx={{ p: 2, border: "1px solid", borderColor: "divider", borderRadius: 1, minHeight: 0 }}>
        {finishers.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No finish results yet.
          </Typography>
        ) : (
          <Table
            size="small"
            stickyHeader
            sx={{
              "& th, & td": {
                px: 0.5,
                py: 0.25,
              },
            }}
          >
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 20 }} padding="checkbox">
                  Rank
                </TableCell>
                <TableCell sx={{ width: 90 }} padding="checkbox">
                  Bib
                </TableCell>
                <TableCell sx={{ width: 170 }} padding="checkbox">
                  Time
                </TableCell>
                <TableCell sx={{ width: 20 }} padding="checkbox" />
              </TableRow>
            </TableHead>

            <TableBody>
              {finishers.map((r, idx) => {
                // Starter-Daten zur Anzeige (Name/Tooltip)
                const a = starterByBib.get(Number(r.bib)) ?? null;

                return (
                  <TableRow
                    key={`${r.bib}-${idx}`}
                    hover
                    draggable
                    onDragStart={() => onDragStart(idx)}
                    onDragOver={(e) => e.preventDefault()} // erlaubt Drop
                    onDrop={(e) => onDrop(e, idx)}
                    sx={{ cursor: "grab" }}
                    title={a ? athleteLabel(a) : undefined}
                  >
                    {/* Rank Spalte: Icon + Rang */}
                    <TableCell>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.1 }}>
                        <DragIndicatorIcon fontSize="small" color="action" />
                        <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
                          {Number(r.finishRank ?? idx + 1)}
                        </Typography>
                      </Box>
                    </TableCell>

                    {/* Bib Spalte: Bib fett + ggf. Nachname */}
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        {r.bib}
                      </Typography>
                      {a ? (
                        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                          {a.lastName}
                        </Typography>
                      ) : null}
                    </TableCell>

                    {/* Time Spalte: editierbar (commit per onChange) */}
                    <TableCell>
                      <TextField
                        variant="standard"
                        size="small"
                        value={String(r.finishTime ?? "")}
                        onChange={(e) => updateAt(idx, { finishTime: (e.target as HTMLInputElement).value })}
                        placeholder="0:15,032"
                        sx={{
                          width: "100%",
                          "& .MuiInputBase-input": { fontSize: 13, py: 0.5 },
                        }}
                      />
                    </TableCell>

                    {/* Remove Button */}
                    <TableCell padding="checkbox">
                      <Tooltip title="Remove" arrow>
                        {/* span notwendig, damit Tooltip auch bei disabled funktionieren könnte */}
                        <span>
                          <IconButton size="small" color="error" onClick={() => removeAt(idx)} aria-label="Remove">
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
          Tip: Drag rows to change the rank order. Hold Shift while dropping to create a tie (same rank).
        </Typography>
      </Box>

      {/* Starterliste: zeigt alle Starter und markiert die Finisher (selectedIds) */}
      <ScoringStarterList starters={starters} selectedIds={selectedIds} formatAthleteLabel={athleteLabel} />

      {/* Dialog: fehlende Starter anlegen */}
      <Dialog
        open={missingDialogOpen}
        onClose={missingDialogBusy ? undefined : handleDialogCancel}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Neue Starter anlegen?</DialogTitle>

        <DialogContent>
          <DialogContentText sx={{ mb: 1 }}>
            Folgende Startnummer(n) sind im Rennen noch nicht als Starter enthalten. Sollen diese angelegt werden?
          </DialogContentText>

          {/* Liste der Bibs als Chips */}
          <Stack direction="row" flexWrap="wrap" gap={1}>
            {missingDialogBibs.map((bib) => (
              <Chip key={bib} label={bib} />
            ))}
          </Stack>
        </DialogContent>

        <DialogActions>
          <Button onClick={handleDialogCancel} disabled={missingDialogBusy}>
            Abbrechen
          </Button>

          <Button variant="contained" onClick={() => void handleDialogCreateAndAdd()} disabled={missingDialogBusy}>
            Starter anlegen &amp; hinzufügen
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}