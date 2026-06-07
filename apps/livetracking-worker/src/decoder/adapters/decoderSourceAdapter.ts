export type DecoderBackendKind = "ammc" | "p3parser";

export type NormalizedPassing = {
  passingId: string;
  /** ISO-Timestamp des Passings. */
  timestamp: string;
  /** Zeitquelle – fehlt bei AMMC. */
  passingTimeSource?: "rtc" | "utc";
  /** Fortlaufende Nummer vom Decoder (0 wenn nicht verfügbar). */
  passingNumber: number;
  transponderId: string;
  transponderType: "tranx" | "prochip";
  /** Hardware-zugewiesene Decoder-ID (z.B. "40-24-04-00"). */
  decoderId: string;
  /** Fachliche Timing-Punkt-ID aus LiveTrackingTimingPoint.id. */
  timingPointId: string;
  signalStrength: number;
  hits: number;
  lowBattery: boolean;
  backend: DecoderBackendKind;
  raw?: unknown;
};

/**
 * Health-Update eines einzelnen Decoders, geliefert vom Adapter an den Worker-Loop.
 * Der Worker-Loop trägt das in das Runtime-Dokument ein.
 */
export type DecoderHealthPatch = {
  timingPointId: string;
  /** Anzeigename (point.name), wird als decoderId im Runtime-Dokument gespeichert. */
  decoderName: string;
  patch: {
    processStatus?: "stopped" | "starting" | "running" | "error";
    websocketStatus?: "disconnected" | "connecting" | "connected" | "error";
    lastConnectedAt?: string | null;
    lastMessageAt?: string | null;
    lastError?: string | null;
  };
};

export interface DecoderSourceAdapter {
  /** Startet die Decoder-Anbindung (verbindet Prozesse / TCP-Verbindungen). */
  start(): Promise<void>;
  /** Stoppt alle Verbindungen und gibt Ressourcen frei. */
  stop(): Promise<void>;
  /** Aktualisiert die verwalteten Timing-Points ohne Stop/Start des Adapters. */
  syncPoints(points: import("@raceoffice/domain").LiveTrackingTimingPoint[]): void;
  /** Registriert den Callback für normalisierte Passings. */
  onPassing(cb: (passing: NormalizedPassing) => void): void;
  /** Registriert den Callback für Warnungen (nicht-fatale Probleme). */
  onWarning(cb: (message: string) => void): void;
  /** Registriert den Callback für Decoder-Gesundheitsupdates. */
  onHealth(cb: (update: DecoderHealthPatch) => void): void;
}
