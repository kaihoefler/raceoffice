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
  activeStatusColor: string;
  inactiveStatusColor: string;
  qualificationRecentLines: number;
  useQualificationPaging: boolean;
  qualificationPagingLines: number;
  qualificationPagingTime: number;
};

export type LiveTrackingVisualizationList = {
  activeVisualizationId: string | null;
  visualizations: LiveTrackingVisualization[];
};
