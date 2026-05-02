// Phase 2 review-nits — T18-T22 codex review P1(b).
//
// Plan: docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md §2.2
// (D14 channel-core boundary; F13 no runtime imports)
// Review: docs/phase-2/codex-review-t18-t22.md (P1: drift guard)
//
// `Target` is declared TWICE on purpose:
//   - `@codex-im/core` (canonical home for resolve/bind APIs).
//   - `@codex-im/channel-core` (declared at the boundary so channel-core
//     has no runtime import of @codex-im/core; F13 boundary test).
//
// Two declarations of the same shape can drift silently — TypeScript
// structural typing makes both compile in isolation. Production daemon
// wire-up assigns one to the other freely; if they diverge, only the
// downstream call site catches it.
//
// This test pins them to BIDIRECTIONAL assignability at the type level
// so any future shape change requires updating BOTH declarations in
// lockstep (or this test fails first). The test runs at typecheck:tests
// time, not at runtime.

import type { Target as ChannelTarget } from "@codex-im/channel-core";
import { describe, it } from "vitest";
import type { Target as CoreTarget } from "../src/types.js";

// Type-level identity helper. If `A` and `B` are mutually assignable,
// resolves to `true`; otherwise, `false`.
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

describe("Target shape drift guard (T18-T22 review P1-b)", () => {
  it("core `Target` and channel-core `Target` are exactly equal", () => {
    // Compile-time: if this fails, one of the two declarations changed
    // shape without the other. Update both before re-running.
    const _exactlyEqual: Equals<CoreTarget, ChannelTarget> = true;
    void _exactlyEqual;

    // Defense in depth: bidirectional assignability at value level.
    const fromChannel: ChannelTarget = { platform: "fake", chatId: "c-1" };
    const asCore: CoreTarget = fromChannel;
    const backToChannel: ChannelTarget = asCore;
    void backToChannel;
  });
});
