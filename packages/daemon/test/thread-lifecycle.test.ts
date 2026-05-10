import { JsonRpcResponseError } from "@codex-im/app-server-client";
import { CodexCapabilities } from "@codex-im/codex-runtime";
import type { Target } from "@codex-im/core";
import { describe, expect, it, vi } from "vitest";
import {
  type ThreadLifecycleContext,
  archiveThread,
  unarchiveThread,
} from "../src/thread-lifecycle.js";

const TARGET: Target = { platform: "telegram", chatId: "-1001" };
const THREAD_ID = "thread-1";
const NOW = "2026-05-10T12:00:00.000Z";

type RpcFn = (p: { threadId: string }) => Promise<unknown>;

interface CtxOverrides {
  threadArchive?: RpcFn | "no-runtime";
  threadUnarchive?: RpcFn | "no-runtime";
  setStatus?: (...args: unknown[]) => unknown;
  capabilities?: CodexCapabilities;
}

function makeContext(overrides: CtxOverrides = {}): ThreadLifecycleContext & {
  archive: ReturnType<typeof vi.fn> | undefined;
  unarchive: ReturnType<typeof vi.fn> | undefined;
  setStatus: ReturnType<typeof vi.fn>;
  capabilities: CodexCapabilities;
} {
  const archiveNoRt = overrides.threadArchive === "no-runtime";
  const unarchiveNoRt = overrides.threadUnarchive === "no-runtime";
  const archive = archiveNoRt
    ? undefined
    : ((overrides.threadArchive as RpcFn | undefined) ??
      (vi.fn<RpcFn>(async () => ({})) as unknown as RpcFn));
  const unarchive = unarchiveNoRt
    ? undefined
    : ((overrides.threadUnarchive as RpcFn | undefined) ??
      (vi.fn<RpcFn>(async () => ({})) as unknown as RpcFn));
  const setStatus = (overrides.setStatus ?? vi.fn()) as ReturnType<typeof vi.fn>;
  const capabilities = overrides.capabilities ?? new CodexCapabilities();
  const runtime =
    archive === undefined && unarchive === undefined
      ? undefined
      : {
          ...(archive ? { threadArchive: archive } : {}),
          ...(unarchive ? { threadUnarchive: unarchive } : {}),
        };
  return {
    runtime,
    capabilities,
    threadSessions: { setStatus: setStatus as never },
    nowIso: () => NOW,
    archive: archive as ReturnType<typeof vi.fn> | undefined,
    unarchive: unarchive as ReturnType<typeof vi.fn> | undefined,
    setStatus,
  };
}

describe("archiveThread", () => {
  it("calls runtime.threadArchive and writes status='archived' on success", async () => {
    const ctx = makeContext();
    const out = await archiveThread(ctx, TARGET, THREAD_ID);
    expect(out).toEqual({ kind: "remote_changed" });
    expect(ctx.archive).toHaveBeenCalledWith({ threadId: THREAD_ID });
    expect(ctx.setStatus).toHaveBeenCalledWith(TARGET, THREAD_ID, "archived", NOW);
    expect(ctx.capabilities.isLikelySupported("thread/archive")).toBe(true);
  });

  it("falls back to local_only on -32601 and updates capability cache", async () => {
    const archive: RpcFn = async () => {
      throw new JsonRpcResponseError({ code: -32601, message: "not found" });
    };
    const ctx = makeContext({ threadArchive: archive });
    const out = await archiveThread(ctx, TARGET, THREAD_ID);
    expect(out).toEqual({ kind: "local_only", reason: "unsupported" });
    expect(ctx.setStatus).toHaveBeenCalledWith(TARGET, THREAD_ID, "archived", NOW);
    expect(ctx.capabilities.isLikelySupported("thread/archive")).toBe(false);
  });

  it("skips runtime call when cache already says unsupported", async () => {
    const capabilities = new CodexCapabilities();
    capabilities.recordUnsupported("thread/archive");
    const ctx = makeContext({ capabilities });
    const out = await archiveThread(ctx, TARGET, THREAD_ID);
    expect(ctx.archive).not.toHaveBeenCalled();
    expect(out).toEqual({ kind: "local_only", reason: "unsupported" });
    expect(ctx.setStatus).toHaveBeenCalledWith(TARGET, THREAD_ID, "archived", NOW);
  });

  it("returns no_runtime when runtime.threadArchive is missing", async () => {
    const ctx = makeContext({ threadArchive: "no-runtime" });
    const out = await archiveThread(ctx, TARGET, THREAD_ID);
    expect(out).toEqual({ kind: "local_only", reason: "no_runtime" });
    expect(ctx.setStatus).toHaveBeenCalledWith(TARGET, THREAD_ID, "archived", NOW);
  });

  it("returns failed and does NOT touch local status on a non-32601 error", async () => {
    const archive: RpcFn = async () => {
      throw new JsonRpcResponseError({ code: -32000, message: "no such thread" });
    };
    const ctx = makeContext({ threadArchive: archive });
    const out = await archiveThread(ctx, TARGET, THREAD_ID);
    expect(out.kind).toBe("failed");
    expect(ctx.setStatus).not.toHaveBeenCalled();
    expect(ctx.capabilities.isLikelySupported("thread/archive")).toBe(true);
  });

  it("returns no_storage when storage.setStatus is missing", async () => {
    const out = await archiveThread(
      {
        runtime: { threadArchive: vi.fn<RpcFn>(async () => ({})) as unknown as RpcFn },
        capabilities: new CodexCapabilities(),
        threadSessions: undefined,
        nowIso: () => NOW,
      },
      TARGET,
      THREAD_ID,
    );
    expect(out).toEqual({ kind: "local_only", reason: "no_storage" });
  });
});

describe("unarchiveThread", () => {
  it("calls runtime.threadUnarchive and writes status='open' on success", async () => {
    const ctx = makeContext();
    const out = await unarchiveThread(ctx, TARGET, THREAD_ID);
    expect(out).toEqual({ kind: "remote_changed" });
    expect(ctx.unarchive).toHaveBeenCalledWith({ threadId: THREAD_ID });
    expect(ctx.setStatus).toHaveBeenCalledWith(TARGET, THREAD_ID, "open", NOW);
  });

  it("uses the same fallback semantics as archive on -32601", async () => {
    const unarchive: RpcFn = async () => {
      throw new JsonRpcResponseError({ code: -32601, message: "not found" });
    };
    const ctx = makeContext({ threadUnarchive: unarchive });
    const out = await unarchiveThread(ctx, TARGET, THREAD_ID);
    expect(out).toEqual({ kind: "local_only", reason: "unsupported" });
    expect(ctx.setStatus).toHaveBeenCalledWith(TARGET, THREAD_ID, "open", NOW);
    expect(ctx.capabilities.isLikelySupported("thread/unarchive")).toBe(false);
  });

  it("does not affect the archive cache (independent capability gate)", async () => {
    const capabilities = new CodexCapabilities();
    const ctx = makeContext({ capabilities });
    await unarchiveThread(ctx, TARGET, THREAD_ID);
    expect(capabilities.snapshot().has("thread/archive")).toBe(false);
    expect(capabilities.snapshot().get("thread/unarchive")).toBe(true);
  });
});
