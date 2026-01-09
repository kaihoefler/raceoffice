// src/routes.tsx
import { createBrowserRouter } from "react-router-dom";
import AppLayout from "./ui/AppLayout";
import ActiveEventPage from "./pages/ActiveEventPage";
import AboutPage from "./pages/AboutPage";
import EventsPage from "./pages/EventsPage"; 

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { path: "/", element: <ActiveEventPage /> },
      { path: "/about", element: <AboutPage /> },
      { path: "/events", element: <EventsPage /> },
    ],
  },
]);

