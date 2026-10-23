// src/buildInfo.ts
// Values are injected at build time via `define` in vite.config.ts.
declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;

/** Release tag (e.g. "v1.0.5") or git describe output for local builds. */
export const APP_VERSION: string = __APP_VERSION__;

/** ISO timestamp of the build. */
export const BUILD_TIME: string = __BUILD_TIME__;
