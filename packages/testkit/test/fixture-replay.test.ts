/**
 * Contract tests against committed codex-0.125.0 wire fixtures.
 *
 * Lives in vitest's `contract` project (see vitest.config.ts at repo root).
 * Run via `pnpm test:contract`. The unit project explicitly excludes this
 * file.
 *
 * Codex outside-voice finding #9: protect against silent drift between
 * codex versions. Each fixture is a verbatim wire frame from the Phase 0
 * wire spike. If a future codex version changes shape, regenerating the
 * fixtures will surface the diff in `git diff`, and these tests will fail
 * if the assumptions about each shape no longer hold.
 */

import { isJsonRpcErrorResponse, isJsonRpcResponse } from "@codex-im/app-server-client";
import { describe, expect, it } from "vitest";
import { loadFixture, loadFixtureMetadata, loadFixtureText } from "../src/fixture-replay.js";

const VERSION = "0.125.0";

describe(`fixture-replay codex-${VERSION} — metadata`, () => {
  it("metadata pins the version, captures the no-experimental decision", () => {
    const m = loadFixtureMetadata(VERSION);
    expect(m.codexVersion).toBe(VERSION);
    expect(m.experimentalFlag).toBe(false);
    expect(m.notes.length).toBeGreaterThan(0);
  });
});

describe(`fixture-replay codex-${VERSION} — initialize-response.jsonl`, () => {
  it("is a single successful response with no `jsonrpc` field", () => {
    const messages = loadFixture(VERSION, "initialize-response.jsonl");
    expect(messages).toHaveLength(1);
    const r = messages[0];
    expect(isJsonRpcResponse(r)).toBe(true);
    expect((r as { jsonrpc?: unknown }).jsonrpc).toBeUndefined();
    expect((r as { id: number }).id).toBe(1);
    const result = (r as { result: Record<string, unknown> }).result;
    // Real codex 0.125 split: platformFamily + platformOs (NOT a single platform field)
    expect(result.codexHome).toBeDefined();
    expect(result.userAgent).toBeDefined();
    expect(result.platformFamily).toBeDefined();
    expect(result.platformOs).toBeDefined();
    expect(result.platform).toBeUndefined();
  });
});

describe(`fixture-replay codex-${VERSION} — string-id-initialize-response.jsonl`, () => {
  it("server echoes string id verbatim (case 2 wire spike)", () => {
    const [r] = loadFixture(VERSION, "string-id-initialize-response.jsonl");
    expect(isJsonRpcResponse(r)).toBe(true);
    expect((r as { id: string }).id).toBe("str-1");
  });
});

describe(`fixture-replay codex-${VERSION} — unknown-method-error.jsonl`, () => {
  it("error.code is -32600 with no error.data", () => {
    const [r] = loadFixture(VERSION, "unknown-method-error.jsonl");
    expect(isJsonRpcErrorResponse(r)).toBe(true);
    const err = (r as { error: { code: number; data?: unknown; message: string } }).error;
    expect(err.code).toBe(-32600);
    expect(err.data).toBeUndefined();
    // Server enumerates the entire method registry in error.message.
    expect(err.message).toContain("unknown variant");
  });
});

describe(`fixture-replay codex-${VERSION} — invalid-params-error.jsonl`, () => {
  it("uses same -32600 code as unknown-method (overload — Phase 1 needs a categorizer)", () => {
    const [r] = loadFixture(VERSION, "invalid-params-error.jsonl");
    expect(isJsonRpcErrorResponse(r)).toBe(true);
    const err = (r as { error: { code: number; message: string } }).error;
    expect(err.code).toBe(-32600);
    expect(err.message).toContain("missing field");
  });
});

describe(`fixture-replay codex-${VERSION} — malformed-json.stderr.txt`, () => {
  it("is plaintext (NOT JSON), comes only from stderr, contains tracing line", () => {
    const text = loadFixtureText(VERSION, "malformed-json.stderr.txt");
    expect(text).toContain("Failed to deserialize JSONRPCMessage");
    // Confirms the stderr line carries ANSI color escapes.  is the ESC
    // character (0x1b); a literal control char in a regex trips biome's
    // noControlCharactersInRegex rule, so use indexOf instead.
    const ESC = "";
    expect(text.indexOf(`${ESC}[`)).toBeGreaterThanOrEqual(0);
    // And it's not parseable as JSON — that's the whole point.
    expect(() => JSON.parse(text)).toThrow();
  });
});

// ─── Phase 1 T4 captures ────────────────────────────────────────────────

describe(`fixture-replay codex-${VERSION} — phase1-richer-turn-event-stream.jsonl`, () => {
  const messages = loadFixture(VERSION, "phase1-richer-turn-event-stream.jsonl");

  it("contains ≥10 notification frames covering ≥3 distinct methods (T4 exit criteria)", () => {
    expect(messages.length).toBeGreaterThanOrEqual(10);
    const methods = new Set<string>();
    for (const m of messages) {
      const obj = m as { method?: unknown };
      if (typeof obj.method === "string") methods.add(obj.method);
    }
    expect(methods.size).toBeGreaterThanOrEqual(3);
  });

  it("contains the turn lifecycle terminators (T7b will map turn.status)", () => {
    const methods = messages.map((m) => (m as { method?: unknown }).method);
    expect(methods).toContain("turn/started");
    expect(methods).toContain("turn/completed");
  });

  it("turn/completed frame carries a turn.status discriminant (used by T7b mapping)", () => {
    const completed = messages.find(
      (m) => (m as { method?: unknown }).method === "turn/completed",
    ) as { params?: { turn?: { status?: unknown } } } | undefined;
    expect(completed).toBeDefined();
    expect(completed?.params?.turn?.status).toBeDefined();
  });

  it("every frame parses as a JSON-RPC notification (method, no id)", () => {
    for (const m of messages) {
      const obj = m as { method?: unknown; id?: unknown };
      expect(typeof obj.method).toBe("string");
      expect("id" in obj).toBe(false);
    }
  });

  it("contains no raw paths AND no raw model names (redaction sanity)", () => {
    const text = loadFixtureText(VERSION, "phase1-richer-turn-event-stream.jsonl");
    expect(text).not.toMatch(/\/Users\//);
    expect(text).not.toMatch(/\/home\//);
    expect(text).not.toMatch(/\/private\/var\/folders\//);
    expect(text).not.toMatch(/\/tmp\/codex-fixture-/);
    expect(text).not.toMatch(/\bgpt-[a-z0-9]/);
    expect(text).not.toMatch(/\bclaude-[a-z0-9]/);
  });
});

describe(`fixture-replay codex-${VERSION} — phase1-richer-turn-server-request.jsonl`, () => {
  const messages = loadFixture(VERSION, "phase1-richer-turn-server-request.jsonl");

  it("contains ≥1 server-initiated request frame (T4.5 acceptance gate)", () => {
    expect(messages.length).toBeGreaterThanOrEqual(1);
  });

  it("every frame is a server-initiated request (method + id, no result/error)", () => {
    for (const m of messages) {
      const obj = m as { method?: unknown; id?: unknown; result?: unknown; error?: unknown };
      expect(typeof obj.method).toBe("string");
      expect("id" in obj).toBe(true);
      expect("result" in obj).toBe(false);
      expect("error" in obj).toBe(false);
    }
  });

  it("contains ≥1 approval-capable method (T4.5 substantive gate)", () => {
    const approvalCapable = new Set([
      "item/commandExecution/requestApproval",
      "item/fileChange/requestApproval",
      "item/permissions/requestApproval",
      "item/tool/requestUserInput",
      "applyPatchApproval",
      "execCommandApproval",
    ]);
    const methods = messages.map((m) => (m as { method: string }).method);
    expect(methods.some((m) => approvalCapable.has(m))).toBe(true);
  });

  it("captured the file-change approval shape T9a will dispatch on", () => {
    const fileChange = messages.find(
      (m) => (m as { method?: unknown }).method === "item/fileChange/requestApproval",
    ) as { params?: { threadId?: unknown; turnId?: unknown; itemId?: unknown } } | undefined;
    expect(fileChange).toBeDefined();
    expect(typeof fileChange?.params?.threadId).toBe("string");
    expect(typeof fileChange?.params?.turnId).toBe("string");
    expect(typeof fileChange?.params?.itemId).toBe("string");
  });
});
