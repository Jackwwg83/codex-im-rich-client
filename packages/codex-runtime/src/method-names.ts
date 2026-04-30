// Phase 1 codex-runtime — typed narrowing helper for
// ServerNotification methods.
//
// Codex outside-voice B5 caught that `Set<ServerNotification["method"]>`
// silently accepts strict subsets — adding a generated arm to the union
// while forgetting to add it to the runtime Set produces no compile
// error. The fix is to derive the runtime check from METHOD_CLASS,
// whose `satisfies Record<ServerNotification["method"], EventClass>`
// constraint enforces exhaustiveness in both directions.
//
// `Object.hasOwn(METHOD_CLASS, m)` (not `m in METHOD_CLASS`) so
// prototype-chain keys like "constructor" or "toString" are NOT
// silently accepted.

import type { ServerNotification } from "@codex-im/protocol";
import { METHOD_CLASS } from "./event-class.js";

export type ServerNotificationMethod = ServerNotification["method"];

/**
 * Type guard: true iff `m` is a valid ServerNotification method per
 * the generated codex 0.125 protocol union. Narrows `m` to
 * ServerNotificationMethod inside the truthy branch.
 *
 * Implementation derives from METHOD_CLASS (exhaustive over the union
 * by `satisfies` constraint) so this stays in sync automatically with
 * codex upgrades.
 */
export function isServerNotificationMethod(m: string): m is ServerNotificationMethod {
  return Object.hasOwn(METHOD_CLASS, m);
}

/**
 * Frozen list of all known notification methods. The order matches
 * METHOD_CLASS source order; downstream consumers should treat this
 * as a set, not a sequence.
 */
export const KNOWN_NOTIFICATION_METHODS: readonly ServerNotificationMethod[] = Object.freeze(
  Object.keys(METHOD_CLASS) as ServerNotificationMethod[],
);
