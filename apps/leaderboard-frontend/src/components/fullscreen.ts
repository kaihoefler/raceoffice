/** Toggles the browser fullscreen mode (Fullscreen API); Esc leaves it. */
export function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen?.();
  else void document.documentElement.requestFullscreen?.();
}
