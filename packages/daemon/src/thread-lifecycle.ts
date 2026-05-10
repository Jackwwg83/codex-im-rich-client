// Slice 3 A3 — capability-gated /archive and /unarchive.
//
// Both commands have the same shape as /rename (Slice 3 A2):
//   - try the codex RPC behind a capability gate
//   - update the local thread_sessions.status to "archived" or "open"
//     iff the remote call succeeded or fell back via -32601 / no_runtime
//   - on a non-32601 error, surface failed without touching local state

import type { CodexCapabilities } from "@codex-im/codex-runtime";
import type { Target } from "@codex-im/core";

const ARCHIVE_METHOD = "thread/archive";
const UNARCHIVE_METHOD = "thread/unarchive";

export interface ThreadLifecycleRuntime {
  threadArchive?: (params: { threadId: string }) => Promise<unknown> | unknown;
  threadUnarchive?: (params: { threadId: string }) => Promise<unknown> | unknown;
}

export interface ThreadLifecycleStorage {
  setStatus?: (
    target: Target,
    codexThreadId: string,
    status: "open" | "archived",
    now?: string,
  ) => unknown;
}

export interface ThreadLifecycleContext {
  readonly runtime: ThreadLifecycleRuntime | undefined;
  readonly capabilities: CodexCapabilities;
  readonly threadSessions: ThreadLifecycleStorage | undefined;
  readonly nowIso: () => string;
}

export type ThreadLifecycleOutcome =
  | { readonly kind: "remote_changed" }
  | {
      readonly kind: "local_only";
      readonly reason: "unsupported" | "no_runtime" | "no_storage";
    }
  | { readonly kind: "failed"; readonly error: string };

export async function archiveThread(
  ctx: ThreadLifecycleContext,
  target: Target,
  codexThreadId: string,
): Promise<ThreadLifecycleOutcome> {
  return runLifecycle(
    ctx,
    target,
    codexThreadId,
    "archived",
    ARCHIVE_METHOD,
    ctx.runtime?.threadArchive,
  );
}

export async function unarchiveThread(
  ctx: ThreadLifecycleContext,
  target: Target,
  codexThreadId: string,
): Promise<ThreadLifecycleOutcome> {
  return runLifecycle(
    ctx,
    target,
    codexThreadId,
    "open",
    UNARCHIVE_METHOD,
    ctx.runtime?.threadUnarchive,
  );
}

async function runLifecycle(
  ctx: ThreadLifecycleContext,
  target: Target,
  codexThreadId: string,
  newStatus: "archived" | "open",
  methodName: string,
  rpc: ((params: { threadId: string }) => Promise<unknown> | unknown) | undefined,
): Promise<ThreadLifecycleOutcome> {
  if (ctx.threadSessions?.setStatus === undefined) {
    return { kind: "local_only", reason: "no_storage" };
  }

  if (rpc !== undefined && ctx.capabilities.isLikelySupported(methodName)) {
    try {
      const ok = await ctx.capabilities.tryCall(methodName, async () =>
        rpc({ threadId: codexThreadId }),
      );
      if (ok !== undefined) {
        ctx.threadSessions.setStatus(target, codexThreadId, newStatus, ctx.nowIso());
        return { kind: "remote_changed" };
      }
      // -32601 fell through. Cache already updated; carry on with local-only.
    } catch (error) {
      return {
        kind: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  ctx.threadSessions.setStatus(target, codexThreadId, newStatus, ctx.nowIso());
  const reason: "no_runtime" | "unsupported" = rpc === undefined ? "no_runtime" : "unsupported";
  return { kind: "local_only", reason };
}
