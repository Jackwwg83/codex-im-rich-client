// T1.1 (Phase 3) — skeleton smoke test: package loads, exports nothing yet.
//
// Plan: docs/superpowers/plans/2026-05-02-phase-3-plan.md §16.2 T1.1
//
// Documents the empty-skeleton state. T2a will add `openDatabase` as the
// first real export; this test will then either be deleted or extended.
// Until then, importing the package must succeed (no resolution errors,
// no syntax errors) and yield zero exports.

import { describe, expect, it } from "vitest";

describe("@codex-im/storage-sqlite skeleton (T1.1)", () => {
  it("package loads and exports nothing yet", async () => {
    const mod = await import("@codex-im/storage-sqlite");
    // Empty re-export: only the synthetic `default` (undefined) may be
    // present from the bundler; real exports start in T2a.
    const realExports = Object.keys(mod).filter((k) => k !== "default");
    expect(realExports).toEqual([]);
  });
});
