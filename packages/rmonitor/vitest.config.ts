import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Vitest 5 no longer excludes dist by default; compiled output must not run twice.
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
