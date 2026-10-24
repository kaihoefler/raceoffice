/** Timing-board defaults: purple for the best lap, yellow for the last lap. */
export const DEFAULT_BEST_LAP_COLOR = "#c084fc";
export const DEFAULT_LAST_LAP_COLOR = "#facc15";

export type LiveTrackingVisualization = {
  id: string;
  name: string;
};

// Full configuration for a LiveTracking visualization document (LiveTrackingVisualization-{id}).
// The table layout is fixed (training board columns), while these fields control appearance.
export type FullLiveTrackingVisualization = LiveTrackingVisualization & {
  backgroundColor: string;
  alternateRowBackgroundColor: string;
  fontSize: string;
  fontWeight: string;
  fontColor: string;
  headerFontSize: string;
  /** Training board: color of the best lap. */
  bestLapColor: string;
  /** Training board: color of the last lap. */
  lastLapColor: string;
  qualificationRecentLines: number;
  useQualificationPaging: boolean;
  qualificationPagingLines: number;
  qualificationPagingTime: number;
};

export type LiveTrackingVisualizationList = {
  activeVisualizationId: string | null;
  visualizations: LiveTrackingVisualization[];
};
