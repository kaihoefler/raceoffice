/**
 * raceResultsActions.test
 * ----------------------
 * Diese Tests dokumentieren die aktuell erwartete Domain-Logik rund um
 * `RaceResult`-Materialisierung und Ranking.
 *
 * Ziel der Tests:
 * - Parsing- und Default-Helfer absichern
 * - aus Activities abgeleitete Felder prüfen (points / eliminated / dsq / dns)
 * - sicherstellen, dass manuell gepflegte Felder erhalten bleiben
 * - die derzeit implementierte Sortier- und Ranking-Regel explizit festhalten
 * - mit `materializeRaceResults(...)` den üblichen End-to-End-Domain-Flow prüfen
 *
 * Fachliche Annahmen für diese Testdaten:
 * - ein Starter ist entweder "normal" oder genau in EINEM Sonderstatus:
 *   `eliminated` ODER `dsq` ODER `dns`
 * - Kombinationen wie gleichzeitig `dns=true` und `eliminated=true` gelten hier
 *   als fachlich ungültig und werden deshalb in den Tests bewusst vermieden
 * - Sprint-Punkte pro Einzelwertung bewegen sich in den Beispielen im Bereich 1, 2 oder 3
 *   (die Gesamtpunkte eines Fahrers dürfen sich natürlich aus mehreren Sprints aufsummieren)
 *
 * Wichtig:
 * Diese Tests beschreiben zunächst das IST-Verhalten des Domain-Codes.
 * Wenn sich später herausstellt, dass die fachliche Ranking-Regel anders sein soll,
 * können wir gezielt einzelne Erwartungen ändern und daraus einen Regression-Test machen.
 */

import { describe, expect, it } from "vitest";

import type { Athlete } from "../types/athlete";
import type { RaceResult } from "../types/race";
import type {
  RaceActivityDisqualfication,
  RaceActivityDns,
  RaceActivityElimination,
  RaceActivityPointsSprint,
} from "../types/raceactivities";

import {
  applyActivitiesToRaceResults,
  bibToInt,
  makeDefaultRaceResult,
  materializeRaceResults,
  recomputeRaceResults,
  sortRaceResultsForStandings,
} from "./raceResultsActions";

// Kleine Test-Fixture für Starter.
function athlete(bib: number): Athlete {
  return {
    id: `athlete-${bib}`,
    firstName: `First ${bib}`,
    lastName: `Last ${bib}`,
    bib,
    ageGroupId: null,
    nation: null,
  };
}

// Erzeugt kompakte RaceResult-Testdaten mit sinnvollen Defaults.
function raceResult(overrides: Partial<RaceResult> & Pick<RaceResult, "bib">): RaceResult {
  return {
    bib: overrides.bib,
    rank: overrides.rank ?? 0,
    points: overrides.points ?? 0,
    eliminated: overrides.eliminated ?? false,
    eliminationLap: overrides.eliminationLap ?? 0,
    dns: overrides.dns ?? false,
    dsq: overrides.dsq ?? false,
    lapsCompleted: overrides.lapsCompleted ?? 0,
    finishTime: overrides.finishTime ?? "",
    finishRank: overrides.finishRank ?? 0,
  };
}

// Test-Fixtures für die unterstützten Activity-Typen.
function pointsSprintActivity(
  id: string,
  lap: number,
  results: Array<{ bib: number; points: number }>,
  isDeleted = false,
): RaceActivityPointsSprint {
  return {
    id,
    createdAt: `${id}-createdAt`,
    type: "pointsSprint",
    data: {
      lap,
      isDeleted,
      results,
      history: [],
    },
  };
}

function eliminationActivity(
  id: string,
  lap: number,
  bibs: number[],
  isDeleted = false,
): RaceActivityElimination {
  return {
    id,
    createdAt: `${id}-createdAt`,
    type: "elimination",
    data: {
      lap,
      isDeleted,
      results: bibs.map((bib) => ({ bib })),
      history: [],
    },
  };
}

function dsqActivity(id: string, bib: number, isDeleted = false): RaceActivityDisqualfication {
  return {
    id,
    createdAt: `${id}-createdAt`,
    type: "DSQ",
    data: {
      bib,
      isDeleted,
      history: [],
    },
  };
}

function dnsActivity(id: string, bib: number, isDeleted = false): RaceActivityDns {
  return {
    id,
    createdAt: `${id}-createdAt`,
    type: "DNS",
    data: {
      bib,
      isDeleted,
      history: [],
    },
  };
}

describe("raceResultsActions", () => {
  // Prüft die Normalisierung von Bib-Nummern aus UI-/Realtime-Eingaben.
  describe("bibToInt", () => {
    it("parses numbers and numeric strings to positive integers", () => {
      expect(bibToInt(12)).toBe(12);
      expect(bibToInt("34")).toBe(34);
      expect(bibToInt(" 56.9 ")).toBe(56);
    });

    it("returns null for invalid, missing or non-positive bibs", () => {
      expect(bibToInt(null)).toBeNull();
      expect(bibToInt(undefined)).toBeNull();
      expect(bibToInt("abc")).toBeNull();
      expect(bibToInt(0)).toBeNull();
      expect(bibToInt(-3)).toBeNull();
    });
  });

  // Prüft den Default-Zustand für neu auftauchende Starter ohne vorhandenes Result.
  describe("makeDefaultRaceResult", () => {
    it("creates a zeroed default RaceResult for a bib", () => {
      expect(makeDefaultRaceResult(22)).toEqual({
        bib: 22,
        rank: 0,
        points: 0,
        eliminated: false,
        eliminationLap: 0,
        dns: false,
        dsq: false,
        lapsCompleted: 0,
        finishTime: "",
        finishRank: 0,
      });
    });
  });

  // Prüft die Materialisierung der aus Activities abgeleiteten Felder.
  // Erwartung: bestehende manuelle Felder bleiben erhalten, abgeleitete Felder
  // werden vollständig aus Activities neu berechnet.
  describe("applyActivitiesToRaceResults", () => {
    it("derives points, eliminations, DSQ and DNS while preserving manual fields", () => {
      const prevResults: RaceResult[] = [
        raceResult({ bib: 11, finishRank: 3, finishTime: "00:10.000", lapsCompleted: 15 }),
        raceResult({ bib: 12, finishRank: 1, finishTime: "00:09.500", lapsCompleted: 15 }),
      ];

      const next = applyActivitiesToRaceResults({
        prevResults,
        starters: [athlete(11), athlete(12), athlete(13), athlete(14), athlete(15)],
        activities: [
          pointsSprintActivity("ps-1", 5, [
            { bib: 11, points: 3 },
            { bib: 13, points: 2 },
          ]),
          pointsSprintActivity("ps-2", 10, [
            { bib: 11, points: 2 },
            { bib: 13, points: 1 },
          ]),
          eliminationActivity("elim-1", 7, [13]),
          eliminationActivity("elim-2", 9, [13, 14]),
          dsqActivity("dsq-1", 12),
          dnsActivity("dns-1", 15),
        ],
      });

      // Erwartetes Verhalten:
      // - bib 11: Punkte aus zwei Sprints aufsummiert, manuelle Felder bleiben erhalten
      // - bib 12: durch DSQ markiert, manuelle Zielinformationen bleiben erhalten
      // - bib 13: eliminiert, höchste Eliminationsrunde zählt
      // - bib 14: nur eliminiert
      // - bib 15: nur DNS
      expect(next).toEqual([
        {
          bib: 11,
          rank: 0,
          points: 5,
          eliminated: false,
          eliminationLap: 0,
          dns: false,
          dsq: false,
          lapsCompleted: 15,
          finishTime: "00:10.000",
          finishRank: 3,
        },
        {
          bib: 12,
          rank: 0,
          points: 0,
          eliminated: false,
          eliminationLap: 0,
          dns: false,
          dsq: true,
          lapsCompleted: 15,
          finishTime: "00:09.500",
          finishRank: 1,
        },
        {
          bib: 13,
          rank: 0,
          points: 3,
          eliminated: true,
          eliminationLap: 9,
          dns: false,
          dsq: false,
          lapsCompleted: 0,
          finishTime: "",
          finishRank: 0,
        },
        {
          bib: 14,
          rank: 0,
          points: 0,
          eliminated: true,
          eliminationLap: 9,
          dns: false,
          dsq: false,
          lapsCompleted: 0,
          finishTime: "",
          finishRank: 0,
        },
        {
          bib: 15,
          rank: 0,
          points: 0,
          eliminated: false,
          eliminationLap: 0,
          dns: true,
          dsq: false,
          lapsCompleted: 0,
          finishTime: "",
          finishRank: 0,
        },
      ]);
    });

    it("ignores deleted activity effects and keeps stable ordering of previous rows before new bibs", () => {
      const next = applyActivitiesToRaceResults({
        prevResults: [raceResult({ bib: 5 }), raceResult({ bib: 2 })],
        starters: [athlete(7)],
        activities: [
          pointsSprintActivity("ps-deleted", 3, [{ bib: 5, points: 99 }], true),
          eliminationActivity("elim-deleted", 6, [2], true),
          dsqActivity("dsq-deleted", 7, true),
          dnsActivity("dns-deleted", 8, true),
          pointsSprintActivity("ps-active", 8, [{ bib: 9, points: 3 }]),
        ],
      });

      // Auch gelöschte Activities tragen weiterhin dazu bei, dass eine Result-Zeile
      // für die betroffene Bib existiert. Sie dürfen aber keine fachlichen Effekte
      // (Punkte / Eliminierung / DSQ / DNS) mehr verursachen.
      expect(next.map((r) => r.bib)).toEqual([5, 2, 7, 8, 9]);
      expect(next.find((r) => r.bib === 5)?.points).toBe(0);
      expect(next.find((r) => r.bib === 2)?.eliminated).toBe(false);
      expect(next.find((r) => r.bib === 7)?.dsq).toBe(false);
      expect(next.find((r) => r.bib === 8)).toEqual(makeDefaultRaceResult(8));
      expect(next.find((r) => r.bib === 9)?.points).toBe(3);
    });
  });

  // Prüft die reine Sortierreihenfolge der aktuellen Ranking-Logik.
  //
  // Dokumentierte aktuelle Sortierregel für Standings:
  // 1) Zuerst der Status-Bucket:
  //    - normale Fahrer (kein DNS / DSQ / ELIM)
  //    - danach eliminierte Fahrer
  //    - danach DSQ
  //    - danach DNS
  //
  // 2) Innerhalb desselben Buckets wird aktuell wie folgt verglichen:
  //    - höhere eliminationLap zuerst
  //    - danach mehr Punkte zuerst
  //    - danach kleinere finishRank zuerst
  //
  // Fachliche Domänenannahme für gültige Daten:
  // Ein Starter hat genau einen Sonderstatus oder keinen.
  // Also entweder normal ODER eliminiert ODER DSQ ODER DNS.
  describe("sortRaceResultsForStandings", () => {
    it("sorts by status bucket, then elimination lap, then points, then finish rank", () => {
      const sorted = sortRaceResultsForStandings([
        raceResult({ bib: 41, dns: true }),
        raceResult({ bib: 31, dsq: true }),
        raceResult({ bib: 21, eliminated: true, eliminationLap: 8, points: 3 }),
        raceResult({ bib: 22, eliminated: true, eliminationLap: 12, points: 1 }),
        raceResult({ bib: 12, points: 2, finishRank: 2 }),
        raceResult({ bib: 11, points: 3, finishRank: 4 }),
        raceResult({ bib: 13, points: 3, finishRank: 1 }),
      ]);

      // Erwartete Reihenfolge nach der aktuell implementierten Priorität:
      // - 13 vor 11, weil beide normale Fahrer mit gleicher Punktzahl sind,
      //   aber 13 die bessere finishRank hat.
      // - 11 vor 12, weil bei normalen Fahrern zunächst Punkte verglichen werden.
      // - 22 vor 21, obwohl 21 mehr Punkte hat, weil bei eliminierten Fahrern
      //   zuerst die eliminationLap verglichen wird.
      // - DSQ vor DNS, weil statusBucket(DSQ)=2 und statusBucket(DNS)=3.
      expect(sorted.map((r) => r.bib)).toEqual([13, 11, 12, 22, 21, 31, 41]);
    });
  });

  // Prüft die eigentliche Rank-Vergabe auf Basis der Sortierlogik.
  // Wichtig dabei:
  // - zuerst wird intern nach der dokumentierten Standing-Regel sortiert
  // - Gleichstände erhalten denselben Rang
  // - nach einem Gleichstand wird korrekt "gesprungen" (1, 1, 3 ...)
  // - die Rückgabe bleibt in der ursprünglichen Eingabereihenfolge,
  //   damit bestehende Dokumente möglichst wenig umsortiert werden
  describe("recomputeRaceResults", () => {
    it("assigns ranks with ties and keeps the original output order", () => {
      const input = [
        raceResult({ bib: 20, points: 2, finishRank: 2 }),
        raceResult({ bib: 10, points: 3, finishRank: 1 }),
        raceResult({ bib: 30, points: 3, finishRank: 1 }),
        raceResult({ bib: 40, eliminated: true, eliminationLap: 9 }),
      ];

      const recomputed = recomputeRaceResults(input);

      // bib 10 und 30 sind im Sortierschlüssel identisch
      // (gleicher Status, gleiche Punkte, gleiche finishRank)
      // und erhalten deshalb beide Rang 1.
      // Danach wird der nächste Rang korrekt als 3 vergeben.
      expect(recomputed.map((r) => ({ bib: r.bib, rank: r.rank }))).toEqual([
        { bib: 20, rank: 3 },
        { bib: 10, rank: 1 },
        { bib: 30, rank: 1 },
        { bib: 40, rank: 4 },
      ]);
    });
  });

  // Reales Rennbeispiel als Regression-Test für die aktuelle Ranking-Logik.
  //
  // Wichtig:
  // - Für `recomputeRaceResults(...)` sind nur die vorhandenen `raceResults`
  //   relevant; `raceStarters` und `raceActivities` werden hier deshalb nicht benötigt.
  // - Die Erwartungen dokumentieren das aktuell berechnete IST-Verhalten.
  // - Wenn sich die fachliche Ranking-Regel ändert, müssen genau diese
  //   Erwartungen bewusst angepasst werden.
  describe("recomputeRaceResults - real race sample", () => {
    it("recomputes the expected ranks for the real race sample", () => {
      const realRaceResults: RaceResult[] = [
        raceResult({ bib: 347, rank: 0, points: 8, eliminated: false, eliminationLap: 0, dns: false, dsq: false, lapsCompleted: 25, finishTime: "8:03.873", finishRank: 1 }),
        raceResult({ bib: 304, rank: 0, points: 6, eliminated: false, eliminationLap: 0, dns: false, dsq: false, lapsCompleted: 25, finishTime: "8:03.899", finishRank: 2 }),
        raceResult({ bib: 303, rank: 0, points: 1, eliminated: false, eliminationLap: 0, dns: false, dsq: false, lapsCompleted: 25, finishTime: "8:07.349", finishRank: 3 }),
        raceResult({ bib: 348, rank: 0, points: 0, eliminated: false, eliminationLap: 0, dns: false, dsq: false, lapsCompleted: 25, finishTime: "8:07.575", finishRank: 4 }),
        raceResult({ bib: 359, rank: 0, points: 9, eliminated: false, eliminationLap: 0, dns: false, dsq: false, lapsCompleted: 25, finishTime: "8:08.270", finishRank: 5 }),
        raceResult({ bib: 312, rank: 0, points: 10, eliminated: false, eliminationLap: 0, dns: false, dsq: false, lapsCompleted: 25, finishTime: "8:08.818", finishRank: 6 }),
        raceResult({ bib: 369, rank: 0, points: 0, eliminated: false, eliminationLap: 0, dns: false, dsq: false, lapsCompleted: 24, finishTime: "", finishRank: 7 }),
        raceResult({ bib: 349, rank: 0, points: 0, eliminated: false, eliminationLap: 0, dns: false, dsq: false, lapsCompleted: 23, finishTime: "", finishRank: 8 }),
        raceResult({ bib: 358, rank: 0, points: 0, eliminated: false, eliminationLap: 0, dns: false, dsq: false, lapsCompleted: 20, finishTime: "", finishRank: 9 }),
        raceResult({ bib: 345, rank: 0, points: 0, eliminated: false, eliminationLap: 0, dns: false, dsq: false, lapsCompleted: 18, finishTime: "", finishRank: 10 }),
        raceResult({ bib: 342, rank: 11, points: 0, eliminated: false, eliminationLap: 0, dns: false, dsq: false, lapsCompleted: 16, finishTime: "", finishRank: 11 }),
        raceResult({ bib: 371, rank: 12, points: 0, eliminated: false, eliminationLap: 0, dns: false, dsq: false, lapsCompleted: 14, finishTime: "", finishRank: 12 }),
        raceResult({ bib: 298, rank: 14, points: 0, eliminated: true, eliminationLap: 17, dns: false, dsq: false, lapsCompleted: 12, finishTime: "", finishRank: 13 }),
        raceResult({ bib: 352, rank: 15, points: 0, eliminated: true, eliminationLap: 16, dns: false, dsq: false, lapsCompleted: 11, finishTime: "", finishRank: 14 }),
        raceResult({ bib: 383, rank: 16, points: 0, eliminated: true, eliminationLap: 15, dns: false, dsq: false, lapsCompleted: 8, finishTime: "", finishRank: 15 }),
        raceResult({ bib: 294, rank: 17, points: 0, eliminated: true, eliminationLap: 15, dns: false, dsq: false, lapsCompleted: 6, finishTime: "", finishRank: 16 }),
        raceResult({ bib: 302, rank: 18, points: 0, eliminated: true, eliminationLap: 14, dns: false, dsq: false, lapsCompleted: 5, finishTime: "", finishRank: 17 }),
        raceResult({ bib: 331, rank: 20, points: 0, eliminated: false, eliminationLap: 0, dns: true, dsq: false, lapsCompleted: 0, finishTime: "", finishRank: 18 }),
        raceResult({ bib: 356, rank: 21, points: 0, eliminated: false, eliminationLap: 0, dns: true, dsq: false, lapsCompleted: 0, finishTime: "", finishRank: 19 }),
        raceResult({ bib: 297, rank: 22, points: 0, eliminated: false, eliminationLap: 0, dns: true, dsq: false, lapsCompleted: 0, finishTime: "", finishRank: 20 }),
        raceResult({ bib: 301, rank: 23, points: 0, eliminated: false, eliminationLap: 0, dns: true, dsq: false, lapsCompleted: 0, finishTime: "", finishRank: 21 }),
        raceResult({ bib: 325, rank: 24, points: 0, eliminated: false, eliminationLap: 0, dns: true, dsq: false, lapsCompleted: 0, finishTime: "", finishRank: 22 }),
        raceResult({ bib: 355, rank: 25, points: 0, eliminated: false, eliminationLap: 0, dns: true, dsq: false, lapsCompleted: 0, finishTime: "", finishRank: 23 }),
        raceResult({ bib: 350, rank: 19, points: 2, eliminated: false, eliminationLap: 0, dns: true, dsq: false, lapsCompleted: 0, finishTime: "", finishRank: 24 }),
        raceResult({ bib: 326, rank: 26, points: 0, eliminated: false, eliminationLap: 0, dns: true, dsq: false, lapsCompleted: 0, finishTime: "", finishRank: 25 }),
        raceResult({ bib: 366, rank: 27, points: 0, eliminated: false, eliminationLap: 0, dns: true, dsq: false, lapsCompleted: 0, finishTime: "", finishRank: 26 }),
        raceResult({ bib: 380, rank: 28, points: 0, eliminated: false, eliminationLap: 0, dns: true, dsq: false, lapsCompleted: 0, finishTime: "", finishRank: 27 }),
        raceResult({ bib: 313, rank: 29, points: 0, eliminated: false, eliminationLap: 0, dns: true, dsq: false, lapsCompleted: 0, finishTime: "", finishRank: 28 }),
        raceResult({ bib: 324, rank: 30, points: 0, eliminated: false, eliminationLap: 0, dns: true, dsq: false, lapsCompleted: 0, finishTime: "", finishRank: 29 }),
        raceResult({ bib: 353, rank: 31, points: 0, eliminated: false, eliminationLap: 0, dns: true, dsq: false, lapsCompleted: 0, finishTime: "", finishRank: 30 }),
      ];

      const recomputed = recomputeRaceResults(realRaceResults);

      // Erwartung in ursprünglicher Eingabereihenfolge:
      // `recomputeRaceResults(...)` sortiert intern für die Rank-Berechnung,
      // gibt aber bewusst dieselbe Dokument-Reihenfolge zurück.
      expect(recomputed.map((r) => ({ bib: r.bib, rank: r.rank }))).toEqual([
        { bib: 347, rank: 3 },
        { bib: 304, rank: 4 },
        { bib: 303, rank: 5 },
        { bib: 348, rank: 6 },
        { bib: 359, rank: 2 },
        { bib: 312, rank: 1 },
        { bib: 369, rank: 7 },
        { bib: 349, rank: 8 },
        { bib: 358, rank: 9 },
        { bib: 345, rank: 10 },
        { bib: 342, rank: 11 },
        { bib: 371, rank: 12 },
        { bib: 298, rank: 13 },
        { bib: 352, rank: 14 },
        { bib: 383, rank: 15 },
        { bib: 294, rank: 16 },
        { bib: 302, rank: 17 },
        { bib: 331, rank: 19 },
        { bib: 356, rank: 20 },
        { bib: 297, rank: 21 },
        { bib: 301, rank: 22 },
        { bib: 325, rank: 23 },
        { bib: 355, rank: 24 },
        { bib: 350, rank: 18 },
        { bib: 326, rank: 25 },
        { bib: 366, rank: 26 },
        { bib: 380, rank: 27 },
        { bib: 313, rank: 28 },
        { bib: 324, rank: 29 },
        { bib: 353, rank: 30 },
      ]);
    });
  });

  // Prüft den typischen Gesamtablauf der Domain:
  // Activities anwenden und anschließend konsolidierte Ränge berechnen.
  describe("materializeRaceResults", () => {
    it("derives activity fields first and then computes ranks", () => {
      const materialized = materializeRaceResults({
        prevResults: [
          raceResult({ bib: 1, finishRank: 2 }),
          raceResult({ bib: 2, finishRank: 1 }),
          raceResult({ bib: 3 }),
        ],
        starters: [athlete(1), athlete(2), athlete(3)],
        activities: [
          pointsSprintActivity("ps-1", 5, [
            { bib: 1, points: 3 },
            { bib: 2, points: 2 },
          ]),
          eliminationActivity("elim-1", 7, [3]),
        ],
      });

      expect(materialized.map((r) => ({ bib: r.bib, points: r.points, eliminated: r.eliminated, rank: r.rank }))).toEqual([
        { bib: 1, points: 3, eliminated: false, rank: 1 },
        { bib: 2, points: 2, eliminated: false, rank: 2 },
        { bib: 3, points: 0, eliminated: true, rank: 3 },
      ]);
    });
  });
});
