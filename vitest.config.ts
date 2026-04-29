import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 10000,
    passWithNoTests: true,
    coverage: { provider: "v8", reporter: ["text", "lcov"] },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["packages/*/test/**/*.test.ts"],
          exclude: [
            "packages/cli/test/smoke-*.test.ts",
            "packages/testkit/test/fixture-replay.test.ts",
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "contract",
          include: ["packages/testkit/test/fixture-replay.test.ts"],
        },
      },
    ],
  },
});
