import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Load .env into process.env before test files evaluate skipIf(hasIntegrationCredentials()).
Object.assign(process.env, loadEnv("", process.cwd(), ""));

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/integration/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**"],
    },
  },
});
