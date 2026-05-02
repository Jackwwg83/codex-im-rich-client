// T7 (Phase 2) — broker public surface tests.
//
// Plan: docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md §5 T7
//
// Covers four areas (one combined file rather than the 4 files plan §5
// suggested — same test surface, fewer files to maintain):
//   1. Secondary `#pendingById` index — lock-step insert/delete with `#pending`
//      and broker-internal terminal-record retention (D12 / D15).
//   2. Public read surface — `listPending()` / `getPending(id)` /
//      `isAttached()` semantics; defensive snapshot copies (D12).
//   3. Lifecycle emitters — `onPendingCreated` / `onPendingResolved`
//      fire at the `#settleEntry` boundary; unsubscribe works;
//      multi-subscribers; observer exceptions don't break the broker (D21).
//   4. `#settleEntry` byte-identical settleOnce guard — Phase 1's
//      `entry.settleOnce` body is preserved exactly; the broker only
//      changes the call sites (D21 / round-2 T3). Plus late-settle
//      audit visibility (`approval.duplicate_attempt`).

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  type AppServerClient,
  AppServerClient as AppServerClientCtor,
} from "@codex-im/app-server-client";
import type { FileChangeRequestApprovalResponse } from "@codex-im/protocol";
import { FakeAppServer } from "@codex-im/testkit";
import { describe, expect, it, vi } from "vitest";
import { ApprovalBroker, type ResolvedOutcome } from "../src/approval-broker.js";
import { AuditEmitter } from "../src/audit.js";

type FileChangeResolver = (value: FileChangeRequestApprovalResponse) => void;

// ─── Helpers ──────────────────────────────────────────────────────────────

async function makeBroker(opts?: { audit?: AuditEmitter }): Promise<{
  client: AppServerClient;
  fake: FakeAppServer;
  broker: ApprovalBroker;
  audit: AuditEmitter;
  cleanup: () => Promise<void>;
}> {
  const fake = new FakeAppServer();
  const client = new AppServerClientCtor(fake.clientSide);
  await client.start();
  const audit = opts?.audit ?? new AuditEmitter();
  const broker = new ApprovalBroker(client, { audit });
  broker.attach();
  return {
    client,
    fake,
    broker,
    audit,
    cleanup: async () => {
      await client.stop();
    },
  };
}

let _fakeIdSeq = 1_000_000;
function nextFakeId(): number {
  _fakeIdSeq += 1;
  return _fakeIdSeq;
}

/** Emit a server-request from the fake; returns the wire-id used + the response promise. */
async function emitFakeApproval(
  fake: FakeAppServer,
  method = "item/fileChange/requestApproval",
  params: unknown = { synthetic: true },
): Promise<{ id: number; responsePromise: Promise<unknown> }> {
  const id = nextFakeId();
  // FakeAppServer.emitServerRequest swallows rejections internally if the
  // client never responds; we await the response promise OUTSIDE the timeout
  // window when needed. Wrap to silence unhandled rejection if the test
  // path doesn't await it (entries that stay pending — e.g. expirePending
  // tests — never settle the wire from the fake's perspective).
  const responsePromise = fake.emitServerRequest(method, params, id).catch(() => undefined);
  // Yield so #handle's microtask registers the entry before assertions.
  await new Promise((r) => setImmediate(r));
  return { id, responsePromise };
}

// ─── 1. Secondary #pendingById index ──────────────────────────────────────

describe("ApprovalBroker — #pendingById secondary index (T7 / D15)", () => {
  it("inserts in lock-step with #pending when #handle creates a PendingEntry", async () => {
    const { broker, fake, cleanup } = await makeBroker();
    try {
      // Pending-mode isn't yet wired (T8); use the registered-handler path.
      // Register a never-resolving handler so the entry stays pending.
      let resolveHandler!: FileChangeResolver;
      broker.registerHandler(
        "item/fileChange/requestApproval",
        () =>
          new Promise((res) => {
            resolveHandler = res;
          }),
      );
      const { id } = await emitFakeApproval(fake);
      const expectedApprovalId = `approval-${id}`;
      // Both views should see the entry as pending.
      const list = broker.listPending();
      expect(list.length).toBe(1);
      expect(list[0]?.id).toBe(expectedApprovalId);
      expect(broker.getPending(expectedApprovalId)?.id).toBe(expectedApprovalId);
      // Resolve via handler so the test can clean up.
      resolveHandler({ decision: "decline" });
      await new Promise((r) => setImmediate(r));
    } finally {
      await cleanup();
    }
  });

  it("deletes from BOTH maps in lock-step on handler-mode happy path", async () => {
    const { broker, fake, cleanup } = await makeBroker();
    try {
      broker.registerHandler("item/fileChange/requestApproval", async () => ({
        decision: "accept" as const,
      }));
      const { id, responsePromise } = await emitFakeApproval(fake);
      await responsePromise;
      const expectedApprovalId = `approval-${id}`;
      // Handler won; status flipped through #settleEntry; finally block deleted from BOTH maps.
      expect(broker.listPending()).toEqual([]);
      expect(broker.getPending(expectedApprovalId)).toBeNull();
    } finally {
      await cleanup();
    }
  });

  it("retains terminal records in BOTH maps after expirePending (D6 audit invariant)", async () => {
    const { broker, fake, cleanup } = await makeBroker();
    try {
      let resolveHandler!: FileChangeResolver;
      broker.registerHandler(
        "item/fileChange/requestApproval",
        () =>
          new Promise((res) => {
            resolveHandler = res;
          }),
      );
      const { id } = await emitFakeApproval(fake);
      const expectedApprovalId = `approval-${id}`;
      // Force expiry by passing maxAgeMs = -1 so EVERY pending qualifies.
      const expired = broker.expirePending(-1);
      expect(expired).toBe(1);
      // Public surface filters by status: terminal records are NOT in listPending / getPending.
      expect(broker.listPending()).toEqual([]);
      expect(broker.getPending(expectedApprovalId)).toBeNull();
      // But the broker-internal _pendingRecordsForTest sees the terminal record.
      const internal = broker._pendingRecordsForTest();
      expect(internal.size).toBe(1);
      expect(internal.get(id)?.status).toBe("expired");
      // Drain the late handler resolution.
      resolveHandler({ decision: "decline" });
      await new Promise((r) => setImmediate(r));
    } finally {
      await cleanup();
    }
  });
});

// ─── 2. Public read surface ───────────────────────────────────────────────

describe("ApprovalBroker — public read surface (T7 / D12)", () => {
  it("listPending() returns frozen snapshots that don't expose mutable state", async () => {
    const { broker, fake, cleanup } = await makeBroker();
    try {
      let resolveHandler!: FileChangeResolver;
      broker.registerHandler(
        "item/fileChange/requestApproval",
        () =>
          new Promise((res) => {
            resolveHandler = res;
          }),
      );
      await emitFakeApproval(fake);
      const list = broker.listPending();
      expect(list.length).toBe(1);
      const snap = list[0];
      expect(snap).toBeDefined();
      // Frozen — assignment to readonly throws at runtime in strict mode.
      expect(Object.isFrozen(snap)).toBe(true);
      // Resolve to clean up.
      resolveHandler({ decision: "decline" });
      await new Promise((r) => setImmediate(r));
    } finally {
      await cleanup();
    }
  });

  it("getPending(unknown id) returns null", async () => {
    const { broker, cleanup } = await makeBroker();
    try {
      expect(broker.getPending("approval-does-not-exist")).toBeNull();
    } finally {
      await cleanup();
    }
  });

  it("isAttached() reflects attach() state", async () => {
    const fake = new FakeAppServer();
    const client = new AppServerClientCtor(fake.clientSide);
    await client.start();
    const broker = new ApprovalBroker(client);
    expect(broker.isAttached()).toBe(false);
    broker.attach();
    expect(broker.isAttached()).toBe(true);
    await client.stop();
  });
});

// ─── 3. Lifecycle emitters ────────────────────────────────────────────────

describe("ApprovalBroker — onPendingCreated / onPendingResolved (T7 / D12 / D21)", () => {
  it("onPendingCreated fires synchronously when a PendingEntry is registered", async () => {
    const { broker, fake, cleanup } = await makeBroker();
    try {
      const created = vi.fn();
      broker.onPendingCreated(created);
      let resolveHandler!: FileChangeResolver;
      broker.registerHandler(
        "item/fileChange/requestApproval",
        () =>
          new Promise((res) => {
            resolveHandler = res;
          }),
      );
      const { id } = await emitFakeApproval(fake);
      expect(created).toHaveBeenCalledTimes(1);
      const snap = created.mock.calls[0]?.[0];
      expect(snap?.id).toBe(`approval-${id}`);
      resolveHandler({ decision: "decline" });
      await new Promise((r) => setImmediate(r));
    } finally {
      await cleanup();
    }
  });

  it("onPendingResolved fires on settleOnce-WIN (handler-mode happy path)", async () => {
    const { broker, fake, cleanup } = await makeBroker();
    try {
      const resolved = vi.fn();
      broker.onPendingResolved(resolved);
      broker.registerHandler("item/fileChange/requestApproval", async () => ({
        decision: "accept" as const,
      }));
      const { responsePromise } = await emitFakeApproval(fake);
      await responsePromise;
      expect(resolved).toHaveBeenCalledTimes(1);
      const outcome = resolved.mock.calls[0]?.[1] as ResolvedOutcome;
      expect(outcome.kind).toBe("handler");
    } finally {
      await cleanup();
    }
  });

  it("onPendingResolved fires once for system-driven expirePending settle", async () => {
    const { broker, fake, cleanup } = await makeBroker();
    try {
      const resolved = vi.fn();
      broker.onPendingResolved(resolved);
      let resolveHandler!: FileChangeResolver;
      broker.registerHandler(
        "item/fileChange/requestApproval",
        () =>
          new Promise((res) => {
            resolveHandler = res;
          }),
      );
      await emitFakeApproval(fake);
      broker.expirePending(-1);
      expect(resolved).toHaveBeenCalledTimes(1);
      const outcome = resolved.mock.calls[0]?.[1] as ResolvedOutcome;
      expect(outcome.kind).toBe("system");
      if (outcome.kind === "system") {
        expect(outcome.reason).toBe("expired");
      }
      resolveHandler({ decision: "decline" });
      await new Promise((r) => setImmediate(r));
    } finally {
      await cleanup();
    }
  });

  it("returns an unsubscribe function", async () => {
    const { broker, fake, cleanup } = await makeBroker();
    try {
      const created = vi.fn();
      const unsub = broker.onPendingCreated(created);
      unsub();
      // Subsequent emit should NOT fire the handler.
      let resolveHandler!: FileChangeResolver;
      broker.registerHandler(
        "item/fileChange/requestApproval",
        () =>
          new Promise((res) => {
            resolveHandler = res;
          }),
      );
      await emitFakeApproval(fake);
      expect(created).not.toHaveBeenCalled();
      resolveHandler({ decision: "decline" });
      await new Promise((r) => setImmediate(r));
    } finally {
      await cleanup();
    }
  });

  it("supports multiple subscribers (each receives the event)", async () => {
    const { broker, fake, cleanup } = await makeBroker();
    try {
      const a = vi.fn();
      const b = vi.fn();
      broker.onPendingCreated(a);
      broker.onPendingCreated(b);
      let resolveHandler!: FileChangeResolver;
      broker.registerHandler(
        "item/fileChange/requestApproval",
        () =>
          new Promise((res) => {
            resolveHandler = res;
          }),
      );
      await emitFakeApproval(fake);
      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(1);
      resolveHandler({ decision: "decline" });
      await new Promise((r) => setImmediate(r));
    } finally {
      await cleanup();
    }
  });

  it("subscriber exceptions do NOT break the broker", async () => {
    const { broker, fake, cleanup } = await makeBroker();
    try {
      const a = vi.fn(() => {
        throw new Error("subscriber bug");
      });
      const b = vi.fn();
      broker.onPendingCreated(a);
      broker.onPendingCreated(b);
      let resolveHandler!: FileChangeResolver;
      broker.registerHandler(
        "item/fileChange/requestApproval",
        () =>
          new Promise((res) => {
            resolveHandler = res;
          }),
      );
      await emitFakeApproval(fake);
      // a threw, but b still fired and broker continued normally.
      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(1);
      // Broker still sees the pending.
      expect(broker.listPending().length).toBe(1);
      resolveHandler({ decision: "decline" });
      await new Promise((r) => setImmediate(r));
    } finally {
      await cleanup();
    }
  });
});

// ─── 4. settleOnce byte-identical guard + late-settle audit ───────────────

describe("ApprovalBroker — settleOnce byte-identical to Phase 1 (T7.2 / D21)", () => {
  it("entry.settleOnce body in working tree matches phase-1-runtime-complete tag verbatim", () => {
    // Codex round-2 T3: extract settleOnce body from the immutable Phase 1
    // tag via `git show`, extract from working tree, compare verbatim.
    // Detects ANY change to the load-bearing B-clean lifecycle. Detection
    // is strict — even whitespace / formatting deltas fail. Intentional:
    // the whole point is to prevent silent drift.
    const phase1Source = execFileSync(
      "git",
      ["show", "phase-1-runtime-complete:packages/core/src/approval-broker.ts"],
      { encoding: "utf-8" },
    );
    const currentSource = readFileSync("packages/core/src/approval-broker.ts", "utf-8");
    const phase1Body = extractSettleOnceBody(phase1Source);
    const currentBody = extractSettleOnceBody(currentSource);
    expect(phase1Body).not.toBe("");
    expect(currentBody).toBe(phase1Body);
  });

  it("createPendingEntry function body in working tree matches phase-1-runtime-complete tag verbatim", () => {
    // Same byte-identical guard for the surrounding factory function.
    const phase1Source = execFileSync(
      "git",
      ["show", "phase-1-runtime-complete:packages/core/src/approval-broker.ts"],
      { encoding: "utf-8" },
    );
    const currentSource = readFileSync("packages/core/src/approval-broker.ts", "utf-8");
    const phase1Body = extractCreatePendingEntryBody(phase1Source);
    const currentBody = extractCreatePendingEntryBody(currentSource);
    expect(phase1Body).not.toBe("");
    expect(currentBody).toBe(phase1Body);
  });
});

describe("ApprovalBroker — late-settle audit visibility (T7 / D21)", () => {
  it("late expirePending after handler resolved emits approval.duplicate_attempt audit (no second wire response)", async () => {
    const audit = new AuditEmitter();
    const { broker, fake, cleanup } = await makeBroker({ audit });
    try {
      broker.registerHandler("item/fileChange/requestApproval", async () => ({
        decision: "accept" as const,
      }));
      const { responsePromise } = await emitFakeApproval(fake);
      await responsePromise;
      // Handler already won; expirePending now should NOT settle anything
      // (status is no longer pending). But also no late-settle audit fires
      // because the entry is GONE from #pending (handler-mode happy path
      // deleted it in the finally block).
      const before = audit.recent().length;
      const expired = broker.expirePending(-1);
      expect(expired).toBe(0);
      expect(audit.recent().length).toBe(before);
    } finally {
      await cleanup();
    }
  });

  it("emit-approval.created + emit-approval.resolved fire on handler-mode happy path", async () => {
    const audit = new AuditEmitter();
    const { broker, fake, cleanup } = await makeBroker({ audit });
    try {
      broker.registerHandler("item/fileChange/requestApproval", async () => ({
        decision: "accept" as const,
      }));
      const { responsePromise } = await emitFakeApproval(fake);
      await responsePromise;
      const events = audit.recent();
      const kinds = events.map((e) => e.kind);
      expect(kinds).toContain("approval.created");
      expect(kinds).toContain("approval.resolved");
    } finally {
      await cleanup();
    }
  });
});

// ─── Source extractors for byte-identical guard ──────────────────────────
//
// Marker-free extraction: regex-anchored on the function syntax that
// Phase 1 actually uses. If a future maintainer reformats the function
// (e.g. moves the brace), both extractors will see the same shape OR
// both will fail in the same way — the test detects ANY drift.

/** Extract `settleOnce(outcome) { ... },` from approval-broker.ts source. */
function extractSettleOnceBody(src: string): string {
  // Phase 1 shape:
  //   settleOnce(outcome) {
  //     ...body...
  //   },
  const match = src.match(/(\s+)settleOnce\(outcome\) \{\n([\s\S]*?)\n\1\},/);
  return match?.[2] ?? "";
}

/** Extract the `createPendingEntry` function body from approval-broker.ts source. */
function extractCreatePendingEntryBody(src: string): string {
  // Phase 1 shape:
  //   function createPendingEntry(
  //     record: ApprovalRecord,
  //     spec: DispatchTable[keyof DispatchTable],
  //   ): PendingEntry {
  //     ...body...
  //   }
  const match = src.match(
    /function createPendingEntry\([\s\S]*?\): PendingEntry \{\n([\s\S]*?)\n\}/,
  );
  return match?.[1] ?? "";
}
