import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    exclude: ["tests/legacy/**", "tests/fixtures/**", "node_modules/**", "dist/**"],
    testTimeout: 15_000,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true, // SQLite tests share state via DATA_DIR
      },
    },
    env: {
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
    },
    coverage: {
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/public/**", "src/**/*.d.ts", "src/prompts/templates_*/**"],
    },
  },
});
