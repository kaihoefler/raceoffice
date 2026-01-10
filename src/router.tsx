// src/router.tsx
import { createBrowserRouter } from "react-router-dom";
import AppLayout from "./ui/AppLayout";
import ActiveEventPage from "./pages/ActiveEventPage";
import AboutPage from "./pages/AboutPage";
import EventsPage from "./pages/EventsPage";
import RaceStartersPage from "./pages/RaceStartersPage";

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { path: "/", element: <ActiveEventPage /> },
      { path: "/events", element: <EventsPage /> },
      { path: "/about", element: <AboutPage /> },

      // NEW: race starters page
      { path: "/races/:raceId/starters", element: <RaceStartersPage /> },
    ],
  },
]);

