// Slice 2 Cut 2 — schema parser for the `computerUse` config block.
//
// Pulled out of packages/daemon/src/daemon.ts because the schema knowledge
// (which fields are valid, defaults, type-guarding) belongs alongside the
// ComputerUsePolicyConfig type itself, not inside the daemon. The daemon
// only knows that some opaque config object exists; it should ask core
// for a typed view.

import type { ComputerUsePolicyConfig } from "./computer-use-policy.js";

/**
 * Parse a daemon `config.computerUse` blob into a typed
 * `ComputerUsePolicyConfig`. Returns `undefined` when the input is not an
 * object or when the `.computerUse` field is missing or not an object.
 *
 * Defaults (kept identical to the legacy daemon behavior so this is a
 * pure refactor):
 *   - `enabled`              defaults to `false` (must be `=== true` to enable)
 *   - `requireExplicitPrefix` defaults to `true`
 *   - `unknownAppPolicy`     is always `"deny"` (no other policy is supported)
 *   - `liveSmokeEnabled`     defaults to `false`
 *
 * Optional fields are only included on the returned object when present in
 * the input, so callers can rely on `Object.hasOwn(...)` semantics for
 * `defaultApp`, `denyApps`, and `requireApprovalKeywords`.
 */
export function parseComputerUsePolicyConfig(config: unknown): ComputerUsePolicyConfig | undefined {
  if (typeof config !== "object" || config === null) {
    return undefined;
  }
  const raw = (config as { computerUse?: unknown }).computerUse;
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const candidate = raw as Partial<{
    enabled: unknown;
    requireExplicitPrefix: unknown;
    defaultApp: unknown;
    allowedApps: unknown;
    denyApps: unknown;
    unknownAppPolicy: unknown;
    requireApprovalKeywords: unknown;
    liveSmokeEnabled: unknown;
  }>;

  return {
    enabled: candidate.enabled === true,
    requireExplicitPrefix:
      typeof candidate.requireExplicitPrefix === "boolean" ? candidate.requireExplicitPrefix : true,
    ...(typeof candidate.defaultApp === "string" ? { defaultApp: candidate.defaultApp } : {}),
    allowedApps: stringArray(candidate.allowedApps),
    ...(candidate.denyApps === undefined ? {} : { denyApps: stringArray(candidate.denyApps) }),
    unknownAppPolicy: "deny",
    ...(candidate.requireApprovalKeywords === undefined
      ? {}
      : { requireApprovalKeywords: stringArray(candidate.requireApprovalKeywords) }),
    liveSmokeEnabled:
      typeof candidate.liveSmokeEnabled === "boolean" ? candidate.liveSmokeEnabled : false,
  };
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}
