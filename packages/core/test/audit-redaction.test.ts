// T5.1 (Phase 2) — failing test for AuditEmitter.emit redaction.
//
// Plan: docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md §5 T5
//
// T3 shipped `AuditEmitter` with NO redaction wired. T5 extends `emit()`
// so BEFORE the event lands in the ring AND BEFORE it reaches the
// optional logger sink, every string in `event.metadata` (recursive into
// nested objects and arrays) AND any string-typed root field is passed
// through `redact()` from T4. Plan §5 T5.3:
//
//   "deep-walk event.metadata (and any string field at the event root)
//    through redact() BEFORE storing in ring AND emitting to pino.
//    Keep stringification minimal."
//
// SCOPE PINNED BY THIS TEST FILE:
//   1.  Top-level metadata string redaction (the T5.1 plan minimum).
//   2.  Logger receives the redacted payload (not the raw event) —
//       Codex P1-3 was specifically about THIS leak vector.
//   3.  Recursive nested-object metadata redaction.
//   4.  Recursive array metadata redaction.
//   5.  Mixed-type metadata: only strings redacted; numbers / booleans /
//       null / undefined / Date preserved as-is.
//   6.  Empty / absent metadata: no error.
//   7.  Idempotency: emitting an already-redacted payload yields a ring
//       entry whose redacted state is fixed-point.
//   8.  Caller's input object is NOT mutated (defensive copy semantic).
//   9.  Object keys are NOT redacted (only values).
//   10. The structure is preserved: shape of nested objects/arrays after
//       redaction matches the input shape.
//   11. T3 baseline (audit.test.ts) regression guard — emit still
//       generates id/createdAt, ring still FIFOs, recent() still works.
//       T3's 21 tests already cover that surface; this file does NOT
//       duplicate them.
//
// PLAN T5.1 FIXTURE NOTE:
//   Plan T5.1 line 1029 cites the fixture
//   `{ command: "echo $TELEGRAM_BOT_TOKEN; pnpm publish" }`. That string
//   is a SHELL VARIABLE REFERENCE — not a token-shaped value — so T4's
//   `redact()` correctly does NOT match it (Codex T4 review explicitly
//   flagged this). We use actual token-shaped values below (Telegram
//   bot tokens, env-var-style assignments with long values, absolute
//   `/Users/...` paths) so the redact rules from T4 actually fire.
//
// FAILURE MODE EXPECTED AT T5.1:
//   `audit-redaction.test.ts` runs (file is new but its imports —
//   AuditEmitter, redact — both exist). The assertions FAIL because
//   T3's `emit()` does not yet call `redact()` on metadata. T5.3
//   implementation makes them pass.
//
// PLACEHOLDER MARKER:
//   T4's placeholders are the form `***REDACTED:<type>***`. We assert
//   STRUCTURALLY (the marker is present + the raw secret is gone)
//   rather than pinning specific placeholder strings. Lets T4
//   evolution stay decoupled from T5 tests.

import { describe, expect, it, vi } from "vitest";
import { AuditEmitter, type AuditEventInput, type AuditLogger } from "../src/audit.js";
import { redact } from "../src/redact.js";

// ─── Fake fixtures (re-using T4's discipline; obviously fake) ────────────

const FAKE_TELEGRAM_TOKEN = "1234567890:ABCDEFGHIJabcdefghij1234567890ABCDE";
// 10 digits + ":" + exactly 35 chars → matches T4's Telegram regex.

const FAKE_GITHUB_PAT = "ghp_FAKETOKEN1234567890abcdefghijklmnop";

const FAKE_SECRET_PATH = "/Users/secret/proj/.env";

const FAKE_ENV_ASSIGNMENT = "API_KEY=ARealLookingFakeSecretValue1234567890abc";

// ─── Test suite ────────────────────────────────────────────────────────────

describe("@codex-im/core AuditEmitter redaction (T5.1)", () => {
  // ─── 1. Top-level metadata string redaction (T5.1 plan minimum) ────
  describe("Top-level metadata string redaction", () => {
    it("redacts a Telegram token value in metadata.command (T5.1 minimum)", () => {
      const e = new AuditEmitter({ ringSize: 5 });
      e.emit({
        kind: "approval.created",
        metadata: { command: `send-message --token=${FAKE_TELEGRAM_TOKEN}` },
      });
      const stored = e._auditRingForTest()[0];
      expect(stored?.metadata?.command).toBeDefined();
      expect(stored?.metadata?.command).not.toContain(FAKE_TELEGRAM_TOKEN);
      expect(String(stored?.metadata?.command)).toMatch(/REDACTED/);
    });

    it("redacts an env-var-style assignment in metadata.env", () => {
      const e = new AuditEmitter({ ringSize: 5 });
      e.emit({
        kind: "approval.created",
        metadata: { env: FAKE_ENV_ASSIGNMENT },
      });
      const stored = e._auditRingForTest()[0];
      expect(stored?.metadata?.env).not.toContain("ARealLookingFakeSecretValue1234567890abc");
      expect(String(stored?.metadata?.env)).toMatch(/REDACTED/);
    });

    it("redacts an absolute /Users/<name>/ path in metadata.cwd", () => {
      const e = new AuditEmitter({ ringSize: 5 });
      e.emit({
        kind: "approval.created",
        metadata: { cwd: FAKE_SECRET_PATH },
      });
      const stored = e._auditRingForTest()[0];
      expect(stored?.metadata?.cwd).not.toContain("/Users/secret/");
      expect(stored?.metadata?.cwd).toContain("/Users/<redacted>/");
    });

    it("redacts ALL sensitive string fields in a multi-key metadata object", () => {
      const e = new AuditEmitter({ ringSize: 5 });
      e.emit({
        kind: "approval.created",
        metadata: {
          command: `git push to ${FAKE_GITHUB_PAT}`,
          cwd: FAKE_SECRET_PATH,
          env: FAKE_ENV_ASSIGNMENT,
          benign: "Reply OK",
        },
      });
      const stored = e._auditRingForTest()[0];
      expect(stored?.metadata?.command).not.toContain(FAKE_GITHUB_PAT);
      expect(stored?.metadata?.cwd).not.toContain("/Users/secret/");
      expect(stored?.metadata?.env).not.toContain("ARealLookingFakeSecretValue1234567890abc");
      // benign passthrough — no false positive
      expect(stored?.metadata?.benign).toBe("Reply OK");
    });
  });

  // ─── 2. Logger receives redacted payload (Codex P1-3) ──────────────
  describe("Logger receives redacted payload (Codex P1-3 / F10)", () => {
    it("logger.info(payload) receives metadata with secrets ALREADY redacted", () => {
      const info = vi.fn();
      const logger: AuditLogger = { info };
      const e = new AuditEmitter({ logger });
      e.emit({
        kind: "approval.resolved",
        metadata: { command: `send --token=${FAKE_TELEGRAM_TOKEN}` },
      });
      expect(info).toHaveBeenCalledTimes(1);
      const payload = info.mock.calls[0]?.[0] as { metadata?: { command?: string } };
      expect(payload).toBeDefined();
      expect(payload.metadata?.command).not.toContain(FAKE_TELEGRAM_TOKEN);
      expect(String(payload.metadata?.command)).toMatch(/REDACTED/);
    });

    it("ring AND logger see the SAME redacted payload (no divergence; full-payload equality)", () => {
      const info = vi.fn();
      const logger: AuditLogger = { info };
      const e = new AuditEmitter({ logger });
      e.emit({
        kind: "approval.resolved",
        approvalId: "appr-77",
        metadata: { secret: FAKE_GITHUB_PAT, nested: { token: FAKE_TELEGRAM_TOKEN } },
      });
      const stored = e._auditRingForTest()[0];
      const logged = info.mock.calls[0]?.[0] as Record<string, unknown>;
      // Strengthen vs. T5.1: every field must agree, not just the
      // redacted-secret one. Full-payload deep equality pins that no
      // divergence can land between ring and logger sinks.
      expect(logged).toEqual(stored);
      // And the nested redacted object reuses the same redacted instance
      // (T5 design: single deep-walk per emit; no second walk for logger).
      expect((logged.metadata as { nested: object }).nested).toBe(
        (stored?.metadata as { nested: object })?.nested,
      );
    });
  });

  // ─── 3. Recursive nested-object metadata redaction ─────────────────
  describe("Recursive nested-object metadata redaction", () => {
    it("redacts strings inside a nested metadata object", () => {
      const e = new AuditEmitter({ ringSize: 5 });
      e.emit({
        kind: "approval.created",
        metadata: {
          request: {
            command: `send --token=${FAKE_TELEGRAM_TOKEN}`,
            env: FAKE_ENV_ASSIGNMENT,
          },
          benign: "ok",
        },
      });
      const stored = e._auditRingForTest()[0];
      const request = stored?.metadata?.request as { command?: string; env?: string };
      expect(request?.command).not.toContain(FAKE_TELEGRAM_TOKEN);
      expect(String(request?.command)).toMatch(/REDACTED/);
      expect(request?.env).not.toContain("ARealLookingFakeSecretValue1234567890abc");
      expect(stored?.metadata?.benign).toBe("ok");
    });

    it("redacts strings 3 levels deep", () => {
      const e = new AuditEmitter({ ringSize: 5 });
      e.emit({
        kind: "approval.created",
        metadata: { l1: { l2: { l3: { token: FAKE_GITHUB_PAT } } } },
      });
      const stored = e._auditRingForTest()[0];
      const l1 = stored?.metadata?.l1 as { l2: { l3: { token: string } } };
      expect(l1?.l2?.l3?.token).not.toContain(FAKE_GITHUB_PAT);
      expect(l1?.l2?.l3?.token).toMatch(/REDACTED/);
    });

    it("preserves nested-object structure (keys + non-string values)", () => {
      const e = new AuditEmitter({ ringSize: 5 });
      e.emit({
        kind: "approval.created",
        metadata: {
          outer: {
            inner: {
              command: `--token=${FAKE_TELEGRAM_TOKEN}`,
              count: 42,
              flag: true,
              empty: null,
            },
          },
        },
      });
      const stored = e._auditRingForTest()[0];
      const inner = (stored?.metadata?.outer as { inner: Record<string, unknown> })?.inner;
      expect(inner).toBeDefined();
      expect(Object.keys(inner ?? {}).sort()).toEqual(["command", "count", "empty", "flag"]);
      expect(inner?.count).toBe(42);
      expect(inner?.flag).toBe(true);
      expect(inner?.empty).toBeNull();
    });
  });

  // ─── 4. Recursive array metadata redaction ─────────────────────────
  describe("Recursive array metadata redaction", () => {
    it("redacts each string element inside a metadata array", () => {
      const e = new AuditEmitter({ ringSize: 5 });
      e.emit({
        kind: "approval.created",
        metadata: {
          items: [`tok=${FAKE_TELEGRAM_TOKEN}`, "clean", FAKE_SECRET_PATH],
        },
      });
      const stored = e._auditRingForTest()[0];
      const items = stored?.metadata?.items as string[];
      expect(items[0]).not.toContain(FAKE_TELEGRAM_TOKEN);
      expect(items[0]).toMatch(/REDACTED/);
      expect(items[1]).toBe("clean");
      expect(items[2]).not.toContain("/Users/secret/");
      expect(items[2]).toContain("/Users/<redacted>/");
    });

    it("redacts strings inside arrays of objects", () => {
      const e = new AuditEmitter({ ringSize: 5 });
      e.emit({
        kind: "approval.created",
        metadata: {
          calls: [{ command: `--token=${FAKE_TELEGRAM_TOKEN}` }, { command: "pnpm test" }],
        },
      });
      const stored = e._auditRingForTest()[0];
      const calls = stored?.metadata?.calls as Array<{ command: string }>;
      expect(calls[0]?.command).not.toContain(FAKE_TELEGRAM_TOKEN);
      expect(calls[0]?.command).toMatch(/REDACTED/);
      expect(calls[1]?.command).toBe("pnpm test");
    });

    it("redacts strings inside nested arrays", () => {
      const e = new AuditEmitter({ ringSize: 5 });
      e.emit({
        kind: "approval.created",
        metadata: {
          matrix: [
            [`tok=${FAKE_TELEGRAM_TOKEN}`, "clean"],
            ["also clean", FAKE_GITHUB_PAT],
          ],
        },
      });
      const stored = e._auditRingForTest()[0];
      const matrix = stored?.metadata?.matrix as string[][];
      expect(matrix[0]?.[0]).toMatch(/REDACTED/);
      expect(matrix[0]?.[1]).toBe("clean");
      expect(matrix[1]?.[0]).toBe("also clean");
      expect(matrix[1]?.[1]).not.toContain(FAKE_GITHUB_PAT);
    });
  });

  // ─── 5. Mixed-type metadata: only strings redacted ─────────────────
  describe("Non-string metadata values pass through unchanged", () => {
    it("preserves number, boolean, null, undefined, Date as-is", () => {
      const e = new AuditEmitter({ ringSize: 5 });
      const fixedDate = new Date("2026-05-01T00:00:00Z");
      e.emit({
        kind: "approval.created",
        metadata: {
          count: 42,
          ratio: 3.14,
          flag: true,
          falseFlag: false,
          empty: null,
          missing: undefined,
          when: fixedDate,
        },
      });
      const stored = e._auditRingForTest()[0];
      expect(stored?.metadata?.count).toBe(42);
      expect(stored?.metadata?.ratio).toBe(3.14);
      expect(stored?.metadata?.flag).toBe(true);
      expect(stored?.metadata?.falseFlag).toBe(false);
      expect(stored?.metadata?.empty).toBeNull();
      // Date preserved as-is (or as a same-time copy — both acceptable)
      expect(stored?.metadata?.when).toBeInstanceOf(Date);
      expect((stored?.metadata?.when as Date).getTime()).toBe(fixedDate.getTime());
      // Codex T5 review P2-6: the test name claims "preserves undefined"
      // but T5.1 didn't actually pin the property semantics. Pin them
      // here. Plain-object walk preserves the `missing: undefined` entry
      // verbatim (Object.entries iterates explicitly-undefined values).
      const md = stored?.metadata as Record<string, unknown>;
      expect("missing" in md).toBe(true);
      expect(md.missing).toBeUndefined();
    });
  });

  // ─── 6. Object keys are NOT redacted ───────────────────────────────
  describe("Object keys are NOT redacted (only values)", () => {
    it("preserves keys verbatim even when keys would match a redact pattern", () => {
      // A key that COULD match the env-var rule shape (`API_KEY=`) should
      // still survive verbatim — only the VALUE is fed to redact().
      const e = new AuditEmitter({ ringSize: 5 });
      e.emit({
        kind: "approval.created",
        metadata: {
          API_KEY: "short", // value too short to redact
          // A key containing path-shaped chars MUST survive verbatim — only the value
          // is fed to redact(); keys are property names, not data.
          "/Users/secret/path": "ignored",
        } as Record<string, unknown>,
      });
      const stored = e._auditRingForTest()[0];
      const md = stored?.metadata as Record<string, unknown>;
      expect(Object.keys(md)).toContain("API_KEY");
      expect(md.API_KEY).toBe("short");
    });
  });

  // ─── 7. Empty / absent metadata: no error ──────────────────────────
  describe("Empty / absent metadata", () => {
    it("emit() with no metadata field doesn't throw", () => {
      const e = new AuditEmitter({ ringSize: 5 });
      expect(() => e.emit({ kind: "approval.created" })).not.toThrow();
      const stored = e._auditRingForTest()[0];
      expect(stored?.kind).toBe("approval.created");
    });

    it("emit() with empty metadata object stores empty metadata", () => {
      const e = new AuditEmitter({ ringSize: 5 });
      e.emit({ kind: "approval.created", metadata: {} });
      const stored = e._auditRingForTest()[0];
      expect(stored?.metadata).toEqual({});
    });
  });

  // ─── 8. Idempotency ────────────────────────────────────────────────
  describe("Idempotency at audit boundary", () => {
    it("emitting an already-redacted metadata produces fixed-point ring entry", () => {
      const e = new AuditEmitter({ ringSize: 5 });
      // First emit: raw metadata
      e.emit({
        kind: "approval.created",
        metadata: { command: `--token=${FAKE_TELEGRAM_TOKEN}` },
      });
      const first = e._auditRingForTest()[0];
      const firstCommand = first?.metadata?.command as string;
      // Now emit again with the ALREADY-REDACTED command from the first ring entry
      e.emit({
        kind: "approval.created",
        metadata: { command: firstCommand },
      });
      const second = e._auditRingForTest()[1];
      const secondCommand = second?.metadata?.command as string;
      // Re-redacting the redacted form must produce the SAME redacted form
      expect(secondCommand).toBe(firstCommand);
    });
  });

  // ─── 9. Caller's input object is NOT mutated (defensive copy) ──────
  describe("Caller's input object not mutated", () => {
    it("input.metadata.command remains the raw value after emit()", () => {
      const e = new AuditEmitter({ ringSize: 5 });
      const rawCommand = `--token=${FAKE_TELEGRAM_TOKEN}`;
      const input: AuditEventInput = {
        kind: "approval.created",
        metadata: { command: rawCommand },
      };
      e.emit(input);
      // Caller's input untouched (no in-place mutation of the original metadata)
      expect(input.metadata?.command).toBe(rawCommand);
      expect(input.metadata?.command).toContain(FAKE_TELEGRAM_TOKEN);
      // But the ring DOES have the redacted form
      const stored = e._auditRingForTest()[0];
      expect(stored?.metadata?.command).not.toContain(FAKE_TELEGRAM_TOKEN);
    });

    it("input.metadata nested object is not mutated", () => {
      const e = new AuditEmitter({ ringSize: 5 });
      const nested = { secret: FAKE_GITHUB_PAT };
      const input: AuditEventInput = {
        kind: "approval.created",
        metadata: { request: nested },
      };
      e.emit(input);
      expect(nested.secret).toBe(FAKE_GITHUB_PAT);
    });

    it("input.metadata array is not mutated", () => {
      const e = new AuditEmitter({ ringSize: 5 });
      const items = [`tok=${FAKE_TELEGRAM_TOKEN}`, "clean"];
      const input: AuditEventInput = {
        kind: "approval.created",
        metadata: { items },
      };
      e.emit(input);
      expect(items[0]).toBe(`tok=${FAKE_TELEGRAM_TOKEN}`);
      expect(items[1]).toBe("clean");
    });
  });

  // ─── Root string field redaction (Codex T5 review P2-3) ───────────
  // Plan §5 T5.3 says "deep-walk metadata (and any string field at the
  // event root)". Implementation walks the WHOLE input (root + nested);
  // pin the root-string-field redaction so the contract doesn't drift.
  // Broker-controlled fields like `approvalId` (= `approval-${id}`) and
  // `appServerRequestId` will normally never carry secret-shaped values,
  // but if a misbehaving caller puts a token there, the walk still
  // catches it.
  describe("Root string field redaction (Codex T5 review P2-3)", () => {
    it("redacts a token-shaped value passed as approvalId (defensive)", () => {
      const e = new AuditEmitter({ ringSize: 5 });
      // approvalId is normally `approval-${id}`. If a caller misuses it
      // by stuffing a token, the walk must still redact.
      const synthetic = `approval-prefix-${FAKE_TELEGRAM_TOKEN}`;
      e.emit({ kind: "approval.created", approvalId: synthetic });
      const stored = e._auditRingForTest()[0];
      expect(stored?.approvalId).not.toContain(FAKE_TELEGRAM_TOKEN);
      expect(stored?.approvalId).toMatch(/REDACTED/);
    });

    it("redacts a token-shaped value passed as appServerRequestId (string form)", () => {
      const e = new AuditEmitter({ ringSize: 5 });
      e.emit({
        kind: "approval.created",
        appServerRequestId: `req-${FAKE_GITHUB_PAT}`,
      });
      const stored = e._auditRingForTest()[0];
      expect(stored?.appServerRequestId).not.toContain(FAKE_GITHUB_PAT);
      expect(String(stored?.appServerRequestId)).toMatch(/REDACTED/);
    });

    it("preserves numeric appServerRequestId (numbers aren't redacted)", () => {
      const e = new AuditEmitter({ ringSize: 5 });
      e.emit({ kind: "approval.created", appServerRequestId: 42 });
      const stored = e._auditRingForTest()[0];
      expect(stored?.appServerRequestId).toBe(42);
    });

    it("kind discriminator is structurally not redactable (passes through unchanged)", () => {
      // `kind` is one of the 12 enumerated AuditEventKind strings; none
      // of them match any T4 redact regex, so redact() is a no-op on
      // them. Pin this so a future widening of T4's patterns doesn't
      // accidentally clobber the discriminator.
      const e = new AuditEmitter({ ringSize: 5 });
      e.emit({ kind: "approval.unsupported_decision" });
      const stored = e._auditRingForTest()[0];
      expect(stored?.kind).toBe("approval.unsupported_decision");
    });
  });

  // ─── Actor redaction (Codex T5 review P2-4) ───────────────────────
  // The walk recurses into `actor` because it's a plain-object root
  // field. Pin that actor.userId / actor.platform / actor.chatId etc.
  // get redacted when they happen to carry secret-shaped strings.
  describe("Actor field redaction (Codex T5 review P2-4)", () => {
    it("redacts a token-shaped value in actor.userId", () => {
      const e = new AuditEmitter({ ringSize: 5 });
      e.emit({
        kind: "approval.resolved",
        actor: {
          kind: "im",
          platform: "telegram",
          // Synthetic: real Telegram user ids are integer strings, but
          // a misbehaving caller could put a token here.
          userId: `tg-${FAKE_TELEGRAM_TOKEN}`,
        },
      });
      const stored = e._auditRingForTest()[0];
      const actor = stored?.actor as { kind: string; userId: string } | undefined;
      expect(actor).toBeDefined();
      expect(actor?.userId).not.toContain(FAKE_TELEGRAM_TOKEN);
      expect(actor?.userId).toMatch(/REDACTED/);
    });

    it("redacts a token-shaped value in actor.chatId", () => {
      const e = new AuditEmitter({ ringSize: 5 });
      e.emit({
        kind: "approval.resolved",
        actor: {
          kind: "im",
          platform: "telegram",
          userId: "tg-12345",
          chatId: `chat-${FAKE_GITHUB_PAT}`,
        },
      });
      const stored = e._auditRingForTest()[0];
      const actor = stored?.actor as { kind: string; chatId?: string } | undefined;
      expect(actor?.chatId).not.toContain(FAKE_GITHUB_PAT);
      expect(actor?.chatId).toMatch(/REDACTED/);
    });

    it("preserves benign actor field values (non-secret userId)", () => {
      const e = new AuditEmitter({ ringSize: 5 });
      e.emit({
        kind: "approval.resolved",
        actor: { kind: "im", platform: "telegram", userId: "tg-12345" },
      });
      const stored = e._auditRingForTest()[0];
      const actor = stored?.actor as { kind: string; platform: string; userId: string };
      expect(actor.kind).toBe("im");
      expect(actor.platform).toBe("telegram");
      expect(actor.userId).toBe("tg-12345");
    });

    it("preserves system actor (no IM userId to redact)", () => {
      const e = new AuditEmitter({ ringSize: 5 });
      e.emit({
        kind: "approval.transport_lost",
        actor: { kind: "system", reason: "transport_lost" },
      });
      const stored = e._auditRingForTest()[0];
      const actor = stored?.actor as { kind: string; reason: string };
      expect(actor.kind).toBe("system");
      expect(actor.reason).toBe("transport_lost");
    });
  });

  // ─── 10. Redact-pass output stability (T3 + T5 round-trip) ─────────
  describe("redact() output stability across the audit boundary", () => {
    it("the redact placeholder text from T4 is what appears in the ring", () => {
      // Consistency check: whatever T4's redact() produces for a given
      // input is exactly what emit() stores. If T4's placeholder format
      // changes, T5 sees it transparently — no separate placeholder
      // language inside emit().
      const e = new AuditEmitter({ ringSize: 5 });
      const raw = `command --token=${FAKE_TELEGRAM_TOKEN} --cwd=${FAKE_SECRET_PATH}`;
      const expected = redact(raw);
      e.emit({ kind: "approval.created", metadata: { command: raw } });
      const stored = e._auditRingForTest()[0];
      expect(stored?.metadata?.command).toBe(expected);
    });
  });
});
