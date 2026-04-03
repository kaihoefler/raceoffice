
export type Visualization = {
  id: string;
  name: string;
};

export type VisualizationColumnAlign = "left" | "center" | "right";

export type VisualizationColumn = {
  /** Title shown in the table header for this column. */
  columnTitle: string;
  /** Width of the column (e.g. "90px", "20%", "12rem"). */
  columnWidth: string;
  /** Horizontal alignment of the column content. */
  columnAlign: VisualizationColumnAlign;
  /** Fallback text shown if the rendered content is empty. */
  columnFallback: string;
  /** Template text rendered in the column, e.g. "{{result.bib}}" or "{{athlete.firstName}} {{athlete.lastName}}". */
  columnContent: string;
};





// Vollständige Visualisierungskonfiguration, die im Realtime-Dokument
// "Visualization-{id}" gespeichert wird.
export type FullVisualization = Visualization & {

  /** Background color for the visualization page (e.g. "#000000" or "black"). */
  backgroundColor: string;

  /** Alternate row background color for the result table. Empty string disables alternating row colors. */
  alternateRowBackgroundColor: string;

  /** Enables paging in the visualization table. */
  usePaging: boolean;

    /**
   * Shows an extra "skipped rows" indicator line ("...") for hidden riders without displayable result.
   *
   * Important behavior in VisualizerPage:
   * - DNS rows are never shown.
   * - DNS rows also never trigger this indicator.
   * - Indicator rows are inserted per contiguous block of skipped non-DNS riders.
   */
  showSkippedRowsIndicator: boolean;


  /** Number of visible lines per page when paging is enabled. */
  pagingLines: number;

  /** Auto page switch interval in seconds. 0 disables automatic switching. */
  pagingTime: number;

  /** Default font size for the visualization (CSS value or number-as-string, e.g. "16px"). */
  fontSize: string;

  /** Default font weight for the visualization (e.g. "400", "700", "normal" or "bold"). */
  fontWeight: string;

  /** Default font color for the visualization (e.g. "#ffffff" or "white"). */
  fontColor: string;

  /** Column configuration for the result table on the visualization page. */
  columns: VisualizationColumn[];
};







/**
 * VisualizationList ist ein Container:
 * - activeVisualizationId: aktuell aktive Visualisierung (oder null)
 * - visualizations: die Liste der Visualisierungen
 *
 * Hinweis:
 * Die Liste enthält nur die "leichten" Basisdaten (id, name).
 * Erweiterte Anzeige-Optionen wie showSkippedRowsIndicator stehen im
 * jeweiligen FullVisualization-Dokument.
 */

export type VisualizationList = {

  activeVisualizationId: string | null;
  visualizations: Visualization[];
};

