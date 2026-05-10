// Slice 2 Cut 4 — Computer Use gate wiring extracted from daemon.ts.
//
// The factory builds the per-Daemon Computer Use surface:
//   - a fresh ComputerUseSessionRegistry
//   - a ComputerUsePolicy from the daemon's config blob (defaults when
//     the blob is missing or malformed; identical to the legacy daemon
//     behavior)
//   - a ComputerUseToolGate that the broker invokes for dynamic tool
//     calls
//
// The factory subscribes the gate handler to the broker. The returned
// `{ policy, registry }` is what the daemon stores; the daemon does not
// need to retain the gate itself.
//
// Boundary: this module touches the broker via
// `registerDynamicToolCallHandler` only. ApprovalBroker settle invariants
// (Phase 2 redlines) are unaffected.

import {
  type ComputerUseAllowedTool,
  ComputerUsePolicy,
  type ComputerUseProvider,
  ComputerUseSessionRegistry,
  ComputerUseToolGate,
  type DynamicToolCallHandler,
  parseComputerUsePolicyConfig,
} from "@codex-im/core";

/**
 * Minimal contract for the broker side the wiring touches. Kept as a
 * structural type so the factory remains independent of the full
 * `DaemonBroker` interface (which is much bigger).
 */
export interface ComputerUseGateBroker {
  registerDynamicToolCallHandler?(handler: DynamicToolCallHandler): void;
}

/**
 * Audit hook shape required by `ComputerUseToolGate`. Matches
 * `Pick<AuditEmitter, "emit">` from @codex-im/core. Daemon wraps its
 * own `#emitAuditEvent` to produce this object.
 */
export interface ComputerUseGateAudit {
  emit(event: { kind: string; metadata?: Record<string, unknown> }): void;
}

export interface ComputerUseGateOptions {
  readonly broker: ComputerUseGateBroker | undefined;
  readonly config: unknown;
  readonly provider: ComputerUseProvider;
  readonly audit: ComputerUseGateAudit;
  readonly allowedTools?: readonly ComputerUseAllowedTool[];
}

export interface ComputerUseGateResult {
  readonly policy: ComputerUsePolicy;
  readonly registry: ComputerUseSessionRegistry;
}

const DEFAULT_COMPUTER_USE_ALLOWED_TOOLS: readonly ComputerUseAllowedTool[] = Object.freeze([
  { namespace: "codex_im.computer_use", tool: "operate" },
  { namespace: null, tool: "computer_use.synthetic" },
] as const satisfies readonly ComputerUseAllowedTool[]);

/**
 * Build a ComputerUseSessionRegistry + ComputerUsePolicy + ToolGate
 * trio and register the gate handler with the broker. Returns the
 * policy + registry so the caller can stash them as Daemon fields.
 *
 * Side effect: subscribes a handler to
 * `broker.registerDynamicToolCallHandler` (if provided). The
 * subscription has no unsubscribe surface — broker handlers are
 * lifetime-bound to the broker, which is itself reset on
 * Daemon.stop().
 */
export function setupComputerUseGate(opts: ComputerUseGateOptions): ComputerUseGateResult {
  const registry = new ComputerUseSessionRegistry();
  const policyConfig = parseComputerUsePolicyConfig(opts.config);
  const policy =
    policyConfig === undefined ? new ComputerUsePolicy() : new ComputerUsePolicy(policyConfig);
  const gate = new ComputerUseToolGate({
    registry,
    policy,
    provider: opts.provider,
    audit: opts.audit,
    allowedTools: opts.allowedTools ?? DEFAULT_COMPUTER_USE_ALLOWED_TOOLS,
  });

  opts.broker?.registerDynamicToolCallHandler?.((req) =>
    gate.handleToolCall({ params: req.params }),
  );

  return { policy, registry };
}
