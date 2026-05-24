// src/router.tsx
import { createBrowserRouter } from "react-router-dom";

import ActiveEventPage from "./pages/ActiveEventPage";
import AboutPage from "./pages/AboutPage";
import EventsPage from "./pages/EventsPage";
import RaceStartersPage from "./pages/RaceStartersPage";
import ScoringPage from "./pages/ScoringPage";
import VisualizationsPage from "./pages/VisualizationsPage";
import VisualizerPage from "./pages/VisualizerPage";
import AppLayout from "./ui/AppLayout";
import VisualizationLayout from "./ui/VisualizationLayout";

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { path: "/", element: <ActiveEventPage /> },
      { path: "/events", element: <EventsPage /> },
      { path: "/visualizations", element: <VisualizationsPage /> },
      { path: "/about", element: <AboutPage /> },
      // race sub-pages
      { path: "/races/:raceId/starters", element: <RaceStartersPage /> },
      { path: "/races/:raceId/scoring", element: <ScoringPage /> },
    ],
  },
  // Fullscreen visualization (video wall)
  {
    element: <VisualizationLayout />,
    children: [
      { path: "/visualizer", element: <VisualizerPage /> },
      // Open a specific visualization without changing the globally active one
      { path: "/visualizer/:visualizationId", element: <VisualizerPage /> },
    ],
  },
]);

