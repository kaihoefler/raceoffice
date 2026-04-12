// src/router.tsx
import { createBrowserRouter } from "react-router-dom";
import AppLayout from "./ui/AppLayout";
import VisualizationLayout from "./ui/VisualizationLayout";

import ActiveEventPage from "./pages/ActiveEventPage";
import AboutPage from "./pages/AboutPage";
import EventsPage from "./pages/EventsPage";
import VisualizationsPage from "./pages/VisualizationsPage";
import RaceStartersPage from "./pages/RaceStartersPage";  
import ScoringPage from "./pages/ScoringPage";
import VisualizerPage from "./pages/VisualizerPage";
import LiveTrackingControlPage from "./pages/LiveTrackingControlPage";
import LiveTrackingParticipantsPage from "./pages/LiveTrackingParticipantsPage";



export const router = createBrowserRouter([


    {
    element: <AppLayout />,
    children: [
      { path: "/", element: <ActiveEventPage /> },
      { path: "/events", element: <EventsPage /> },
            { path: "/visualizations", element: <VisualizationsPage /> },
            { path: "/live-tracking", element: <LiveTrackingControlPage /> },
            { path: "/live-tracking/participants", element: <LiveTrackingParticipantsPage /> },


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


