// src/router.tsx
//
// Two areas (doc/timing-architecture.md, section 7):
// - Zeitmessung (/timing/*): Control Center (worker, hardware, passings), decoder register, setups
// - Livetracking (/live-tracking/*): measurement, participants, board, visualizations
import { Navigate, createBrowserRouter, type RouteObject } from "react-router-dom";

import LiveTrackingMeasurementPage from "./pages/livetracking/LiveTrackingMeasurementPage";
import LiveTrackingParticipantsPage from "./pages/livetracking/LiveTrackingParticipantsPage";
import LiveTrackingSimpleVisualizationPage from "./pages/livetracking/LiveTrackingSimpleVisualizationPage";
import LiveTrackingVisualizationsPage from "./pages/livetracking/LiveTrackingVisualizationsPage";
import LiveTrackingVisualizerPage from "./pages/livetracking/LiveTrackingVisualizerPage";
import TimingControlCenterPage from "./pages/timing/TimingControlCenterPage";
import TimingDecodersPage from "./pages/timing/TimingDecodersPage";
import TimingSetupsPage from "./pages/timing/TimingSetupsPage";
import LiveTrackingLayout from "./ui/LiveTrackingLayout";

/** The app is served under /livetracking/ (vite base + server static mount). */
export const ROUTER_BASENAME = "/livetracking";

/** Route table; component tests mount it with createMemoryRouter (src/test/renderApp.tsx). */
export const routes: RouteObject[] = [
  {
    element: <LiveTrackingLayout />,
    children: [
      { path: "/", element: <Navigate to="/timing/control" replace /> },
      { path: "/timing", element: <Navigate to="/timing/control" replace /> },
      { path: "/timing/control", element: <TimingControlCenterPage /> },
      { path: "/timing/decoders", element: <TimingDecodersPage /> },
      { path: "/timing/setups", element: <TimingSetupsPage /> },
      { path: "/live-tracking", element: <Navigate to="/live-tracking/measurement" replace /> },
      // Former control page (bookmarks): the measurement page replaces it.
      { path: "/live-tracking/setup", element: <Navigate to="/live-tracking/measurement" replace /> },
      { path: "/live-tracking/measurement", element: <LiveTrackingMeasurementPage /> },
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
];

export const router = createBrowserRouter(routes, { basename: ROUTER_BASENAME });
