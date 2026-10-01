import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["src/**/*.test.ts"], environment: "node", testTimeout: 30_000, env: { FACTORY_NO_CACHE: "1", FACTORY_NO_SCREENSHOTS: "1" } },
});
