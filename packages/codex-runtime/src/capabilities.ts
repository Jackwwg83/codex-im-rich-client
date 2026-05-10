// Slice 3 A1 — codex App Server capability detection.
//
// Two-layer detection per ADR 0003 (docs/architecture/decisions/0003-
// capability-detection.md), with a retrospective amendment dated
// 2026-05-10:
//
//   Layer A (compile-time)  — already enforced by tsc against
//     packages/codex-protocol/src/generated. If the codex bump removed a
//     type or method literal, the runtime wrapper that mentions it
//     fails to compile. Daemons that build and ship are inherently
//     compile-time-aware of their pinned protocol.
//
//   Layer B (runtime)        — observe-and-cache. The class below
//     records `unsupported` only when a real JSON-RPC call returns
//     `-32601` (Method Not Found). Defaults to "likely supported"
//     because Layer A already gates compile-time presence. Mismatches
//     between the generated protocol and the running codex are caught
//     lazily on first invocation and cached; subsequent calls fall
//     back without retrying.
//
// This intentionally avoids speculative startup probing: codex 0.128.0
// has no dedicated capability-discovery RPC, and synthesizing a probe
// (e.g. sending a thread/setName with a stub thread) has surprising
// side effects. Lazy passive detection is good enough for the IM bridge
// because every capability-gated command path has a graceful local
// fallback.

import { JsonRpcResponseError } from "@codex-im/app-server-client";

/**
 * Lazy passive cache of which JSON-RPC method literals the running
 * codex supports. Constructed once per Daemon (per spawn); shared by
 * every command handler that needs a capability gate.
 *
 * The cache stores three states implicitly:
 *
 *   - explicit `false` (recorded after observing -32601) — DO NOT call
 *     this method again; fall back instead
 *   - explicit `true`  (recorded after observing a non-error or any
 *     other error code) — method exists; call freely
 *   - missing entry (default) — assume supported, call optimistically
 *
 * `isLikelySupported(method)` returns true for both "explicit true" and
 * "missing entry"; only an explicit `false` flips the answer. This is
 * the right default for compiled code that imported the type from
 * `@codex-im/protocol` — Layer A has already approved it.
 */
export class CodexCapabilities {
  readonly #cache = new Map<string, boolean>();

  isLikelySupported(method: string): boolean {
    return this.#cache.get(method) !== false;
  }

  recordSupported(method: string): void {
    this.#cache.set(method, true);
  }

  recordUnsupported(method: string): void {
    this.#cache.set(method, false);
  }

  /**
   * Test / inspection helper. Returns a snapshot of cache contents.
   * The map is a copy; mutating it does not affect the source.
   */
  snapshot(): ReadonlyMap<string, boolean> {
    return new Map(this.#cache);
  }

  /**
   * Convenience wrapper. Invokes `fn` and updates the cache based on
   * what happens:
   *
   *   - resolves with `T`         -> recordSupported(method) + return T
   *   - throws -32601             -> recordUnsupported(method) + return undefined
   *   - throws any other error    -> rethrows; cache untouched
   *
   * Caller chooses what `undefined` means (typically: fall back to a
   * local-only path).
   */
  async tryCall<T>(method: string, fn: () => Promise<T>): Promise<T | undefined> {
    try {
      const result = await fn();
      this.recordSupported(method);
      return result;
    } catch (err) {
      if (isMethodNotFoundError(err)) {
        this.recordUnsupported(method);
        return undefined;
      }
      throw err;
    }
  }
}

/**
 * Recognise the canonical JSON-RPC "method not found" error
 * (code -32601). Also accepts plain `{ code: -32601 }` objects so
 * upstream wrappers that flatten the error don't bypass the check.
 */
export function isMethodNotFoundError(err: unknown): boolean {
  if (err instanceof JsonRpcResponseError) {
    return err.code === -32601;
  }
  if (err !== null && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    return code === -32601;
  }
  return false;
}
