// setup.ts
//
// Vitest setup for frontend component tests (jsdom). Use it as `setupFiles` in vite.config:
//   test: { environment: "jsdom", setupFiles: ["@raceoffice/test-utils/setup"] }
//
// - jest-dom matchers (toBeInTheDocument, toHaveValue, ...)
// - 3 s timeout for findBy/waitFor (default 1 s)
// - unmount rendered trees and undo global stubs (WebSocket, fetch) after each test
// - browser APIs jsdom lacks but MUI uses (matchMedia, ResizeObserver, scrollIntoView)

import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Pages with live polling re-render often; on slow machines (CI) 1 s is too tight for findBy/waitFor.
configure({ asyncUtilTimeout: 3000 });

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
