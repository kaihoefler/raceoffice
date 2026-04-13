// src/router.tsx
import { Navigate, createBrowserRouter } from "react-router-dom";

import ActiveEventPage from "./pages/ActiveEventPage";
import AboutPage from "./pages/AboutPage";
import EventsPage from "./pages/EventsPage";
import LiveTrackingControlPage from "./pages/livetracking/LiveTrackingControlPage";
import LiveTrackingParticipantsPage from "./pages/livetracking/LiveTrackingParticipantsPage";
import LiveTrackingVisualizationsPage from "./pages/livetracking/LiveTrackingVisualizationsPage";
import LiveTrackingSimpleVisualizationPage from "./pages/livetracking/LiveTrackingSimpleVisualizationPage";
import LiveTrackingVisualizerPage from "./pages/livetracking/LiveTrackingVisualizerPage";


import RaceStartersPage from "./pages/RaceStartersPage";
import ScoringPage from "./pages/ScoringPage";
import VisualizationsPage from "./pages/VisualizationsPage";
import VisualizerPage from "./pages/VisualizerPage";
import AppLayout from "./ui/AppLayout";
import LiveTrackingLayout from "./ui/LiveTrackingLayout";
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
  {
    element: <LiveTrackingLayout />,
    children: [
      { path: "/live-tracking", element: <Navigate to="/live-tracking/setup" replace /> },
      { path: "/live-tracking/setup", element: <LiveTrackingControlPage /> },
      { path: "/live-tracking/participants", element: <LiveTrackingParticipantsPage /> },
            { path: "/live-tracking/visualization", element: <LiveTrackingVisualizationsPage /> },
      { path: "/live-tracking/board", element: <LiveTrackingSimpleVisualizationPage /> },

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
  {
    children: [
      { path: "/live-tracking/visualizer", element: <LiveTrackingVisualizerPage /> },
      { path: "/live-tracking/visualizer/:visualizationId", element: <LiveTrackingVisualizerPage /> },
    ],
  },
]);

