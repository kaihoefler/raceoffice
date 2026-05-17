// src/router.tsx
import { Navigate, createBrowserRouter } from "react-router-dom";

import LiveTrackingControlPage from "./pages/livetracking/LiveTrackingControlPage";
import LiveTrackingParticipantsPage from "./pages/livetracking/LiveTrackingParticipantsPage";
import LiveTrackingSimpleVisualizationPage from "./pages/livetracking/LiveTrackingSimpleVisualizationPage";
import LiveTrackingVisualizationsPage from "./pages/livetracking/LiveTrackingVisualizationsPage";
import LiveTrackingVisualizerPage from "./pages/livetracking/LiveTrackingVisualizerPage";
import LiveTrackingLayout from "./ui/LiveTrackingLayout";

export const router = createBrowserRouter(
  [
    {
      element: <LiveTrackingLayout />,
      children: [
        { path: "/", element: <Navigate to="/live-tracking/setup" replace /> },
        { path: "/live-tracking", element: <Navigate to="/live-tracking/setup" replace /> },
        { path: "/live-tracking/setup", element: <LiveTrackingControlPage /> },
        { path: "/live-tracking/participants", element: <LiveTrackingParticipantsPage /> },
        { path: "/live-tracking/visualization", element: <LiveTrackingVisualizationsPage /> },
        { path: "/live-tracking/board", element: <LiveTrackingSimpleVisualizationPage /> },
      ],
    },
    {
      children: [
        { path: "/live-tracking/visualizer", element: <LiveTrackingVisualizerPage /> },
        { path: "/live-tracking/visualizer/:visualizationId", element: <LiveTrackingVisualizerPage /> },
      ],
    },
  ],
  {
    basename: "/livetracking",
  },
);


