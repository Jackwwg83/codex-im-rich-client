import { defineConfig } from "vitest/config";

// Three projects:
//   unit       — default `pnpm test` runs this. Excludes smoke-* (subprocess
//                concern; future iterations may grow the file into one) and
//                the contract fixture replay.
//   contract   — runs alongside unit by default. Replays codex-X.Y.Z wire
//                fixtures.
//   cli-smoke  — explicit-only via `pnpm test:cli-smoke`. NOT included in
//                default `pnpm test`. Required by `bash scripts/ci-check.sh`
//                (the script lands in T3 alongside the codex-runtime
//                skeleton). Tests in this project use FakeAppServer +
//                InMemoryTransport — no real subprocess, no model call.
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
      {
        extends: true,
        test: {
          name: "cli-smoke",
          include: ["packages/cli/test/smoke-*.test.ts"],
        },
      },
    ],
  },
});
