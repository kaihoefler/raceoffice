
export type Visualization = {
  id: string;
  name: string;
};

export type FullVisualization = Visualization & {
  /** Background color for the visualization page (e.g. "#000000" or "black"). */
  backgroundColor: string;

  /** Default font size for the visualization (CSS value or number-as-string, e.g. "16px"). */
  fontSize: string;

  /** Default font color for the visualization (e.g. "#ffffff" or "white"). */
  fontColor: string;
};



/**
 * VisualizationList ist  ein Container:
 * - activeVisualizationId: aktuell aktive Visualisierung (oder null)
 * - visualizations: die Liste der Visualisierungen 
 */
export type VisualizationList = {

  activeVisualizationId: string | null;
  visualizations: Visualization[];
};

