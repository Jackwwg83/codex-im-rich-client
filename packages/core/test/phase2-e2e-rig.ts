// T21.1 (Phase 2) — full fake e2e rig (test helper, NOT a test file).
//
// Plan: docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md §5 T21.1
//
// Wires the entire Phase 2 pipeline together for tests:
//   FakeAppServer + InMemoryTransport + AppServerClient + ApprovalBroker
//   + AuditEmitter + TelegramShapeFakeChannelAdapter + a tiny daemon-
//   wireup function that bridges broker ↔ adapter.
//
// The daemon-wireup function is the Phase 2 minimum for Phase 3 to take
// over. Its job:
//   1. broker.onPendingCreated → projectAsRichBlock → adapter.sendCard
//      → bindActorPolicy with the returned MessageRef + nonce.
//   2. adapter.onAction → broker.resolve(...) (translating InboundAction
//      to ResolveApprovalInput).
//
// Tests construct an `E2eRig` per test, drive it via `fake.emitServerRequest`
// + `adapter.injectAction`, then inspect `audit.recent()`, broker state,
// and adapter recorded edits/acks.

import {
  type AppServerClient,
  AppServerClient as AppServerClientCtor,
} from "@codex-im/app-server-client";
import {
  type InboundAction,
  type SendCardResult,
  type Target,
  TelegramShapeFakeChannelAdapter,
} from "@codex-im/channel-core";
import { projectAsRichBlock } from "@codex-im/render";
import { FakeAppServer } from "@codex-im/testkit";
import { ApprovalBroker } from "../src/approval-broker.js";
import { AuditEmitter } from "../src/audit.js";
import type { ActorPolicy } from "../src/types.js";

export type E2eRig = {
  fake: FakeAppServer;
  client: AppServerClient;
  broker: ApprovalBroker;
  adapter: TelegramShapeFakeChannelAdapter;
  audit: AuditEmitter;
  /** Static target the daemon-wireup binds approvals to. */
  target: Target;
  /** Static actor allowed to approve in this rig. */
  allowedActor: { kind: "im"; platform: string; userId: string };
  /** Map of approvalId → SendCardResult for assertions / inject lookup. */
  sentCards: Map<string, SendCardResult>;
  cleanup: () => Promise<void>;
};

export type E2eRigOptions = {
  /**
   * Methods to enable pending-mode for. Tests typically pass exactly
   * the kind they exercise (e.g. ["item/commandExecution/requestApproval"]).
   * Defaults to all 8 IM-routable methods (everything except auth-refresh).
   */
  pendingModeMethods?: ReadonlyArray<Parameters<ApprovalBroker["enablePendingMode"]>[0]>;
  /**
   * Override the default static actor (useful for wrong_actor test paths
   * where two distinct actors share the same chat).
   */
  allowedActor?: { kind: "im"; platform: string; userId: string };
  /** Override the default chat target. */
  target?: Target;
  /** Override broker TTL. Default 30 minutes. */
  approvalTtlMs?: number;
  /**
   * Skip the daemon-wireup's automatic bindActorPolicy after sendCard.
   * Used by the binding_required test path to simulate a wire-up bug
   * where the IM rendering installed but bind was never called.
   */
  disableAutoBind?: boolean;
};

const DEFAULT_PENDING_METHODS = [
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
  "item/tool/requestUserInput",
  "item/tool/call",
  "mcpServer/elicitation/request",
  "applyPatchApproval",
  "execCommandApproval",
] as const;

export async function buildE2eRig(opts: E2eRigOptions = {}): Promise<E2eRig> {
  const fake = new FakeAppServer();
  const client = new AppServerClientCtor(fake.clientSide);
  await client.start();
  const audit = new AuditEmitter();
  const broker = new ApprovalBroker(client, {
    audit,
    ...(opts.approvalTtlMs !== undefined && { approvalTtlMs: opts.approvalTtlMs }),
  });
  broker.attach();
  for (const method of opts.pendingModeMethods ?? DEFAULT_PENDING_METHODS) {
    broker.enablePendingMode(method);
  }

  const adapter = new TelegramShapeFakeChannelAdapter();
  await adapter.start();

  const target: Target = opts.target ?? { platform: "fake-telegram", chatId: "c-team" };
  const allowedActor = opts.allowedActor ?? {
    kind: "im" as const,
    platform: "fake-telegram",
    userId: "u-alice",
  };
  const sentCards = new Map<string, SendCardResult>();

  // Daemon wire-up subscriber: on pending → render → send → (maybe) bind.
  broker.onPendingCreated((snap) => {
    void (async () => {
      const block = projectAsRichBlock(snap);
      if (block.type !== "approval") return;
      try {
        const sent = await adapter.sendCard(target, block.card);
        sentCards.set(snap.id, sent);
        if (!opts.disableAutoBind) {
          const policy: ActorPolicy = {
            allowedActors: [allowedActor],
            target,
            callbackNonce: sent.callbackNonce,
          };
          broker.bindActorPolicy(snap.id, policy);
        }
      } catch {
        // sendCard may throw (e.g. callback_data overflow in T21.5);
        // tests assert via broker.listPending() / audit afterwards.
      }
    })();
  });

  // Daemon wire-up subscriber: on action → resolve.
  adapter.onAction((action: InboundAction) => {
    void (async () => {
      const result = await broker.resolve({
        approvalId: action.approvalId,
        decision: action.uiAction,
        actor:
          action.sender.userId === allowedActor.userId
            ? allowedActor
            : {
                kind: "im",
                platform: action.target.platform,
                userId: action.sender.userId,
              },
        target: action.target,
        callbackNonce: action.callbackNonce,
      });
      // Ack the platform callback so the user's UI un-spins. Mirror the
      // resolve outcome in the user-facing message text.
      try {
        await adapter.answerAction(action.callbackHandle, {
          ok: result.kind === "ok",
          userMessage:
            result.kind === "ok"
              ? `Decision recorded: ${action.uiAction.kind}`
              : `Could not record decision: ${result.error.kind}`,
        });
      } catch {
        // answerAction may reject post-stop or post-deadline; tests
        // assert via adapter._acksForTest() or audit.
      }
    })();
  });

  return {
    fake,
    client,
    broker,
    adapter,
    audit,
    target,
    allowedActor,
    sentCards,
    cleanup: async () => {
      await adapter.stop();
      await client.stop();
    },
  };
}

/** Standard bad-payload fixture per R4 round-2 — every e2e fixture has these. */
export const BAD_PAYLOAD_FIXTURES = {
  telegramBotToken: "1234567890:AAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  absPath: "/Users/secret/proj/.env.production",
  awsKeyShape: "AKIAIOSFODNN7EXAMPLE",
} as const;

/**
 * Build a params object that contains all three known-bad payloads in
 * different fields. Audit-redaction-per-failure-branch (R4 round-2)
 * asserts these strings DO NOT appear verbatim in any audit event.
 */
export function badParams(): Record<string, unknown> {
  return {
    command: `cat ${BAD_PAYLOAD_FIXTURES.absPath}`,
    cwd: BAD_PAYLOAD_FIXTURES.absPath,
    reason: `Bot token is ${BAD_PAYLOAD_FIXTURES.telegramBotToken}; AWS key ${BAD_PAYLOAD_FIXTURES.awsKeyShape}`,
  };
}

export type EmitOptions = {
  method?: string;
  params?: unknown;
  id?: number;
  /**
   * When true (default), waits up to ~10 microtask cycles for the
   * daemon-wireup's onPendingCreated subscriber to finish
   * adapter.sendCard + bindActorPolicy. Set false to test the
   * binding_required path or any "click before bind" race.
   */
  waitForBind?: boolean;
};

// IDs MUST be small enough that `approval-${id}` + `|allow_session|` +
// 32-char nonce fits in 62 bytes (TelegramShapeFakeChannelAdapter limit).
// `approval-` is 9 chars + max 8 digits + `|allow_session|` is 15 chars +
// 32-char nonce = 64 — too big for an 8-digit id.
// 6 digits gives: 9 + 6 + 15 + 32 = 62 — exactly at limit. Stay under
// to leave a byte of headroom: start at 100 and increment.
let _e2eIdSeq = 100;
export function nextE2eId(): number {
  _e2eIdSeq += 1;
  return _e2eIdSeq;
}

/**
 * Emit a server-request from the fake. Returns approvalId + a promise
 * that resolves when the wire response lands (or undefined on timeout
 * / error). Waits until the daemon-wireup has finished binding the
 * actor policy (via sentCards population) so subsequent injectUserClick
 * sees a fully-set-up pending entry. Pass `waitForBind: false` to skip
 * the bind-wait when testing the binding_required path.
 */
export async function emitFakeServerRequest(
  rig: E2eRig,
  opts: EmitOptions = {},
): Promise<{ id: number; approvalId: string; wirePromise: Promise<unknown> }> {
  const method = opts.method ?? "item/commandExecution/requestApproval";
  const params = opts.params ?? badParams();
  const id = opts.id ?? nextE2eId();
  const approvalId = `approval-${id}`;
  const wirePromise = rig.fake.emitServerRequest(method, params, id).catch(() => undefined);
  // Yield repeatedly so the broker's #handle, the daemon-wireup
  // onPendingCreated subscriber (async), and adapter.sendCard's
  // microtask all settle before tests inspect state.
  if (opts.waitForBind ?? true) {
    for (let i = 0; i < 10; i += 1) {
      await new Promise((r) => setImmediate(r));
      if (rig.sentCards.has(approvalId)) break;
    }
  } else {
    await new Promise((r) => setImmediate(r));
  }
  return { id, approvalId, wirePromise };
}

/**
 * Inject a user-action through the adapter for an existing pending
 * approvalId. Looks up the SendCardResult so the round-tripped nonce
 * matches the bound policy by default. Tests can override individual
 * fields to exercise wrong_actor / wrong_target / stale_callback.
 */
export function injectUserClick(
  rig: E2eRig,
  approvalId: string,
  uiAction: InboundAction["uiAction"],
  overrides: Partial<Omit<InboundAction, "approvalId" | "uiAction">> = {},
): void {
  const sent = rig.sentCards.get(approvalId);
  const callbackNonce = overrides.callbackNonce ?? sent?.callbackNonce ?? "nonce-missing";
  const target = overrides.target ?? rig.target;
  const sender = overrides.sender ?? { userId: rig.allowedActor.userId };
  const callbackHandle = overrides.callbackHandle ?? `cb-${approvalId}`;
  const receivedAt = overrides.receivedAt ?? new Date();
  rig.adapter.injectAction({
    approvalId,
    uiAction,
    target,
    sender,
    callbackNonce,
    receivedAt,
    callbackHandle,
  });
}

/** Concise audit-event extractor for assertions. */
export function auditKinds(rig: E2eRig): string[] {
  return rig.audit.recent().map((e) => e.kind);
}

/** Yield enough microtasks for async daemon-wireup paths to settle. */
export async function flushAsync(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await new Promise((r) => setImmediate(r));
  }
}
