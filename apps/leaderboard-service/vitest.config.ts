import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    // Integration tests use real TCP sockets and timers.
    testTimeout: 20_000,
  },
});
