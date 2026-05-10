// Slice 2.1 hardening item #2 — ADR 0002 invariant guards.
//
// docs/architecture/decisions/0002-cwd-trust-boundary.md says:
//   - codex-returned cwd lands in `app_default`, NOT `configured_project`
//   - even if codex's cwd happens to equal a configured project's cwd,
//     the binding does not promote
//   - configured_project is only reachable via explicit user `/use`
//
// These tests assert the invariant at the routing layer: no matter what
// cwd the runtime returns from threadStart, /new without a prior /use
// produces a binding with contextKind="app_default".

import { tmpdir } from "node:os";
import { join } from "node:path";
import { type SecurityPolicySender, SessionRouter, type Target } from "@codex-im/core";
import { describe, expect, it, vi } from "vitest";
import { Daemon } from "../src/index.js";

const FIXTURE_CWD = join(tmpdir(), "codex-im-rich-client-fixture-cwd");
const CONFIGURED_PROJECT_CWD = join(tmpdir(), "codex-im-cut-trust-boundary-project");

const TARGET: Target = { platform: "telegram", chatId: "-1001" };
const SENDER: SecurityPolicySender = { userId: "u-alice" };
const NOW = new Date("2026-05-10T10:00:00.000Z");

async function flushDaemonHandlers(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("ADR 0002 — codex-returned cwd never promotes to configured_project", () => {
  it("/new in default context binds app_default even when codex's cwd matches a configured project's cwd", async () => {
    let messageHandler: ((message: unknown) => void) | undefined;
    const bindings = {
      upsert: vi.fn((input) => ({
        id: "binding-trap",
        target: input.target,
        contextKind: input.contextKind,
        projectId: input.projectId,
        projectLabel: input.projectLabel,
        cwd: input.cwd,
        codexThreadId: input.codexThreadId,
        activeTurnId: input.activeTurnId,
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      })),
      findByTarget: vi.fn(),
    };
    const sessionRouter = new SessionRouter({ bindings });
    const runtime = {
      // The trap: codex returns a cwd that exactly equals the
      // configured project's cwd. ADR 0002: this MUST NOT promote
      // the binding to contextKind="configured_project".
      threadStart: vi.fn(() => ({
        thread: { id: "thread-trap", cwd: CONFIGURED_PROJECT_CWD },
      })),
      turnStart: vi.fn(() => ({ turn: { id: "turn-trap" } })),
      turnSteer: vi.fn(),
      turnInterrupt: vi.fn(),
    };
    const threadSessionRepository = {
      upsert: vi.fn(() => ({
        id: "ts-trap",
        target: TARGET,
        contextKind: "app_default" as const,
        projectLabel: "Codex default",
        codexThreadId: "thread-trap",
        title: "test",
        status: "open" as const,
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
        lastUsedAt: NOW.toISOString(),
      })),
    };
    const adapter = {
      onAction: vi.fn(() => () => undefined),
      onMessage: vi.fn((handler: (message: unknown) => void) => {
        messageHandler = handler;
        return () => undefined;
      }),
      editText: vi.fn(),
    };

    // Configured project whose cwd coincidentally equals codex's returned cwd.
    const daemon = new Daemon({
      loadConfig: () => ({
        projects: {
          coincidence: {
            cwd: CONFIGURED_PROJECT_CWD,
            allowedUsers: [`telegram:${SENDER.userId}`],
            allowedChats: [`telegram:${TARGET.chatId}`],
          },
        },
      }),
      openStorage: () => ({}),
      createBroker: () => ({
        attach: vi.fn(),
        enablePendingMode: vi.fn(),
        listPending: vi.fn(() => []),
      }),
      createSecurityPolicy: () => ({
        checkUserAndChat: () => ({ kind: "allow" as const }),
        checkProjectAccess: () => ({ kind: "allow" as const }),
      }),
      createSessionRouter: () => sessionRouter,
      createSupervisor: () => ({ currentRuntime: () => runtime }),
      createAdapter: () => adapter,
      threadSessionRepository,
      now: () => NOW,
    });

    await daemon.start();
    messageHandler?.({
      target: TARGET,
      sender: SENDER,
      text: "/new run something",
      messageRef: { target: TARGET, messageId: "msg-1" },
      receivedAt: NOW,
    });
    await flushDaemonHandlers();

    // Both the thread session repository write AND the session router
    // bind must record contextKind="app_default" — not "configured_project"
    // — even though the codex cwd matches a configured project.
    expect(threadSessionRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        contextKind: "app_default",
        projectLabel: "Codex default",
        cwd: CONFIGURED_PROJECT_CWD,
      }),
    );
    expect(bindings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        contextKind: "app_default",
        projectLabel: "Codex default",
        cwd: CONFIGURED_PROJECT_CWD,
      }),
    );
    // Negative: no bindings.upsert call ever uses contextKind="configured_project"
    // even though codex returned the configured project's cwd.
    for (const call of bindings.upsert.mock.calls) {
      expect(call[0].contextKind).not.toBe("configured_project");
    }

    await daemon.stop();
  });

  it("/new in default context still uses app_default when no configured project exists at all", async () => {
    let messageHandler: ((message: unknown) => void) | undefined;
    const bindings = {
      upsert: vi.fn((input) => ({
        id: "binding-default",
        target: input.target,
        contextKind: input.contextKind,
        projectId: input.projectId,
        projectLabel: input.projectLabel,
        cwd: input.cwd,
        codexThreadId: input.codexThreadId,
        activeTurnId: input.activeTurnId,
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      })),
      findByTarget: vi.fn(),
    };
    const sessionRouter = new SessionRouter({ bindings });
    const runtime = {
      threadStart: vi.fn(() => ({
        thread: { id: "thread-default", cwd: FIXTURE_CWD },
      })),
      turnStart: vi.fn(() => ({ turn: { id: "turn-default" } })),
      turnSteer: vi.fn(),
      turnInterrupt: vi.fn(),
    };
    const threadSessionRepository = {
      upsert: vi.fn(() => ({
        id: "ts-default",
        target: TARGET,
        contextKind: "app_default" as const,
        projectLabel: "Codex default",
        codexThreadId: "thread-default",
        title: "test",
        status: "open" as const,
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
        lastUsedAt: NOW.toISOString(),
      })),
    };
    const adapter = {
      onAction: vi.fn(() => () => undefined),
      onMessage: vi.fn((handler: (message: unknown) => void) => {
        messageHandler = handler;
        return () => undefined;
      }),
      editText: vi.fn(),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}), // zero configured projects
      openStorage: () => ({}),
      createBroker: () => ({
        attach: vi.fn(),
        enablePendingMode: vi.fn(),
        listPending: vi.fn(() => []),
      }),
      createSecurityPolicy: () => ({
        checkUserAndChat: () => ({ kind: "allow" as const }),
      }),
      createSessionRouter: () => sessionRouter,
      createSupervisor: () => ({ currentRuntime: () => runtime }),
      createAdapter: () => adapter,
      threadSessionRepository,
      now: () => NOW,
    });

    await daemon.start();
    messageHandler?.({
      target: TARGET,
      sender: SENDER,
      text: "/new run something",
      messageRef: { target: TARGET, messageId: "msg-1" },
      receivedAt: NOW,
    });
    await flushDaemonHandlers();

    expect(bindings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ contextKind: "app_default" }),
    );

    await daemon.stop();
  });
});
