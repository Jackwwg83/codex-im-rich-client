import { JsonRpcResponseError } from "@codex-im/app-server-client";
import { CodexCapabilities } from "@codex-im/codex-runtime";
import type { Target } from "@codex-im/core";
import { describe, expect, it, vi } from "vitest";
import { type ThreadRenameContext, renameThread } from "../src/thread-rename.js";

const TARGET: Target = { platform: "telegram", chatId: "-1001" };
const THREAD_ID = "thread-1";
const NOW = "2026-05-10T12:00:00.000Z";

type ThreadSetNameFn = (p: { threadId: string; name: string }) => Promise<unknown>;

interface MakeContextOverrides {
  threadSetName?: ThreadSetNameFn | "no-runtime";
  rename?: (...args: unknown[]) => unknown;
  capabilities?: CodexCapabilities;
}

function makeContext(overrides: MakeContextOverrides = {}): ThreadRenameContext & {
  capabilities: CodexCapabilities;
  threadSetName: ReturnType<typeof vi.fn> | undefined;
  rename: ReturnType<typeof vi.fn>;
} {
  const noRuntime = overrides.threadSetName === "no-runtime";
  const defaultSetName = vi.fn<ThreadSetNameFn>(async () => ({}));
  const threadSetName = noRuntime
    ? undefined
    : ((overrides.threadSetName as ThreadSetNameFn | undefined) ??
      (defaultSetName as unknown as ThreadSetNameFn));
  const rename = (overrides.rename ?? vi.fn()) as ReturnType<typeof vi.fn>;
  const capabilities = overrides.capabilities ?? new CodexCapabilities();
  return {
    runtime: threadSetName === undefined ? undefined : { threadSetName },
    capabilities,
    threadSessions: { rename: rename as never },
    nowIso: () => NOW,
    threadSetName: threadSetName as ReturnType<typeof vi.fn> | undefined,
    rename,
  };
}

describe("renameThread", () => {
  it("calls runtime.threadSetName and updates local title on success", async () => {
    const ctx = makeContext({
      threadSetName: vi.fn(async () => ({})),
    });
    const out = await renameThread(ctx, TARGET, THREAD_ID, "alpha");
    expect(out).toEqual({ kind: "remote_renamed", title: "alpha" });
    expect(ctx.threadSetName).toHaveBeenCalledWith({ threadId: THREAD_ID, name: "alpha" });
    expect(ctx.rename).toHaveBeenCalledWith(TARGET, THREAD_ID, "alpha", NOW);
    expect(ctx.capabilities.isLikelySupported("thread/name/set")).toBe(true);
  });

  it("falls back to local_only when threadSetName returns -32601 and updates capability cache", async () => {
    const ctx = makeContext({
      threadSetName: vi.fn(async () => {
        throw new JsonRpcResponseError({ code: -32601, message: "method not found" });
      }),
    });
    const out = await renameThread(ctx, TARGET, THREAD_ID, "beta");
    expect(out).toEqual({ kind: "local_only", title: "beta", reason: "unsupported" });
    expect(ctx.rename).toHaveBeenCalledWith(TARGET, THREAD_ID, "beta", NOW);
    expect(ctx.capabilities.isLikelySupported("thread/name/set")).toBe(false);
  });

  it("skips the runtime call when capability cache says unsupported", async () => {
    const capabilities = new CodexCapabilities();
    capabilities.recordUnsupported("thread/name/set");
    const ctx = makeContext({
      threadSetName: vi.fn<ThreadSetNameFn>(async () => ({})),
      capabilities,
    });
    const out = await renameThread(ctx, TARGET, THREAD_ID, "gamma");
    expect(ctx.threadSetName).not.toHaveBeenCalled();
    expect(out).toEqual({ kind: "local_only", title: "gamma", reason: "unsupported" });
    expect(ctx.rename).toHaveBeenCalledWith(TARGET, THREAD_ID, "gamma", NOW);
  });

  it("returns local_only when runtime is undefined", async () => {
    const ctx = makeContext({ threadSetName: "no-runtime" });
    const out = await renameThread(ctx, TARGET, THREAD_ID, "delta");
    expect(out).toEqual({ kind: "local_only", title: "delta", reason: "no_runtime" });
    expect(ctx.rename).toHaveBeenCalledWith(TARGET, THREAD_ID, "delta", NOW);
  });

  it("returns failed when threadSetName throws a non-32601 error and DOES NOT touch local title", async () => {
    const ctx = makeContext({
      threadSetName: vi.fn(async () => {
        throw new JsonRpcResponseError({ code: -32000, message: "thread not found" });
      }),
    });
    const out = await renameThread(ctx, TARGET, THREAD_ID, "eps");
    expect(out.kind).toBe("failed");
    if (out.kind === "failed") {
      expect(out.error).toContain("thread not found");
    }
    expect(ctx.rename).not.toHaveBeenCalled();
    // Cache untouched: still "likely supported" (the -32000 may have
    // been a transient codex condition; we should not flip the gate).
    expect(ctx.capabilities.isLikelySupported("thread/name/set")).toBe(true);
  });

  it("returns local_only with reason no_storage when threadSessions.rename is missing", async () => {
    const out = await renameThread(
      {
        runtime: { threadSetName: vi.fn() },
        capabilities: new CodexCapabilities(),
        threadSessions: undefined,
        nowIso: () => NOW,
      },
      TARGET,
      THREAD_ID,
      "zeta",
    );
    expect(out).toEqual({ kind: "local_only", title: "zeta", reason: "no_storage" });
  });
});
