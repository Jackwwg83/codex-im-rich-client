// Slice 3 A2 — capability-gated thread rename.
//
// /rename calls codex's thread/name/set when the server supports it,
// and always updates the local thread_sessions.title alias. /alias
// remains the local-only path; /rename is layered on top.
//
// The capability gate is observe-and-cache from CodexCapabilities:
//   - first call optimistically attempts threadSetName
//   - on -32601 the cache flips to "unsupported" and subsequent calls
//     skip the network round-trip
//   - on success the cache (re-)flips to "supported"

import type { CodexCapabilities } from "@codex-im/codex-runtime";
import type { Target } from "@codex-im/core";

const METHOD_NAME = "thread/name/set";

/**
 * Minimal contract for the part of CodexRuntime we touch. Kept as a
 * structural type so this module does not import the runtime class
 * (avoiding a heavy dep when daemon-side tests want to stub it).
 */
export interface ThreadRenameRuntime {
  threadSetName?: (params: { threadId: string; name: string }) => Promise<unknown> | unknown;
}

/**
 * Minimal contract for the storage repository surface. Matches the
 * subset of `ThreadSessionRepository.rename` that daemon already uses
 * elsewhere.
 */
export interface ThreadRenameStorage {
  rename?: (
    target: Target,
    codexThreadId: string,
    title: string | undefined,
    now?: string,
  ) => unknown;
}

export interface ThreadRenameContext {
  readonly runtime: ThreadRenameRuntime | undefined;
  readonly capabilities: CodexCapabilities;
  readonly threadSessions: ThreadRenameStorage | undefined;
  readonly nowIso: () => string;
}

export type ThreadRenameOutcome =
  | { readonly kind: "remote_renamed"; readonly title: string }
  | {
      readonly kind: "local_only";
      readonly title: string;
      readonly reason: "unsupported" | "no_runtime" | "no_storage";
    }
  | { readonly kind: "failed"; readonly error: string };

/**
 * Try to rename a Codex thread on the server, then update the local
 * thread_sessions title. Returns a discriminated outcome describing
 * what actually happened so callers can craft an IM-friendly reply.
 *
 * Errors from runtime.threadSetName that are NOT -32601 surface as
 * `{ kind: "failed", error }` with the cache untouched — operators can
 * retry later. The local rename only runs if the remote call either
 * succeeded or fell back via -32601 / no-runtime; we never silently
 * drift the local alias when the network call failed for a real
 * reason (transport down, validation rejected by codex, etc.).
 */
export async function renameThread(
  ctx: ThreadRenameContext,
  target: Target,
  codexThreadId: string,
  title: string,
): Promise<ThreadRenameOutcome> {
  if (ctx.threadSessions?.rename === undefined) {
    return { kind: "local_only", title, reason: "no_storage" };
  }

  let remoteAttempted = false;
  if (ctx.runtime?.threadSetName !== undefined && ctx.capabilities.isLikelySupported(METHOD_NAME)) {
    remoteAttempted = true;
    try {
      const setName = ctx.runtime.threadSetName;
      const ok = await ctx.capabilities.tryCall(METHOD_NAME, async () =>
        setName({ threadId: codexThreadId, name: title }),
      );
      if (ok !== undefined) {
        // Remote rename succeeded. Update local alias too.
        ctx.threadSessions.rename(target, codexThreadId, title, ctx.nowIso());
        return { kind: "remote_renamed", title };
      }
      // tryCall returned undefined => -32601, fell back; cache already updated.
    } catch (error) {
      return {
        kind: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Either no runtime, or remote was attempted and returned -32601, or
  // a previous call had already cached the method as unsupported. In
  // every case: update the local alias and tell the caller.
  ctx.threadSessions.rename(target, codexThreadId, title, ctx.nowIso());
  const reason: "no_runtime" | "unsupported" =
    ctx.runtime?.threadSetName === undefined ? "no_runtime" : "unsupported";
  void remoteAttempted;
  return { kind: "local_only", title, reason };
}
