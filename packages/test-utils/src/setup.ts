// setup.ts
//
// Vitest setup for frontend component tests (jsdom). Use it as `setupFiles` in vite.config:
//   test: { environment: "jsdom", setupFiles: ["@raceoffice/test-utils/setup"] }
//
// - jest-dom matchers (toBeInTheDocument, toHaveValue, ...)
// - unmount rendered trees and undo global stubs (WebSocket, fetch) after each test
// - browser APIs jsdom lacks but MUI uses (matchMedia, ResizeObserver, scrollIntoView)

import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

if (typeof window !== "undefined") {
  if (!window.matchMedia) {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList;
  }

  if (!("ResizeObserver" in window)) {
    (window as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }

  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
}
