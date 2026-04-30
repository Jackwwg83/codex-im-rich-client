// T3 (Phase 1, Codex B2): split-capture unit tests.
//
// Runs in the default `pnpm test` unit gate (vitest with TS support handles
// .mts files via vite-node).

import { describe, expect, it } from "vitest";
import { splitCapture } from "./split-capture.mts";

const frame = (obj: Record<string, unknown>) => JSON.stringify(obj);

describe("splitCapture", () => {
  it("returns empty arrays for empty input", () => {
    expect(splitCapture("")).toEqual({
      notifications: [],
      requests: [],
      counts: { notifications: 0, requests: 0, responses: 0, unknown: 0 },
    });
  });

  it("classifies a notification (method, no id)", () => {
    const r = splitCapture(frame({ method: "turn/started", params: {} }));
    expect(r.counts.notifications).toBe(1);
    expect(r.counts.requests).toBe(0);
    expect(r.notifications.length).toBe(1);
  });

  it("classifies a server-initiated request (method + id)", () => {
    const r = splitCapture(
      frame({ id: 42, method: "item/commandExecution/requestApproval", params: {} }),
    );
    expect(r.counts.requests).toBe(1);
    expect(r.counts.notifications).toBe(0);
    expect(r.requests.length).toBe(1);
  });

  it("skips a response (id with result, no method)", () => {
    const r = splitCapture(frame({ id: 1, result: { thread: { id: "t1" } } }));
    expect(r.counts.responses).toBe(1);
    expect(r.counts.notifications).toBe(0);
    expect(r.counts.requests).toBe(0);
    expect(r.notifications).toEqual([]);
    expect(r.requests).toEqual([]);
  });

  it("skips an error response (id with error, no method)", () => {
    const r = splitCapture(frame({ id: 1, error: { code: -32600, message: "x" } }));
    expect(r.counts.responses).toBe(1);
  });

  it("preserves order within each output stream", () => {
    const lines = [
      frame({ method: "turn/started", params: { n: 1 } }),
      frame({ id: 1, result: {} }), // response, skipped
      frame({ id: 2, method: "item/commandExecution/requestApproval", params: { x: 1 } }),
      frame({ method: "item/agentMessage/delta", params: { delta: "a" } }),
      frame({ id: 3, method: "item/fileChange/requestApproval", params: { y: 2 } }),
      frame({ method: "turn/completed", params: {} }),
    ].join("\n");

    const r = splitCapture(lines);

    expect(r.counts).toEqual({ notifications: 3, requests: 2, responses: 1, unknown: 0 });
    expect(r.notifications.map((l) => JSON.parse(l).method)).toEqual([
      "turn/started",
      "item/agentMessage/delta",
      "turn/completed",
    ]);
    expect(r.requests.map((l) => JSON.parse(l).method)).toEqual([
      "item/commandExecution/requestApproval",
      "item/fileChange/requestApproval",
    ]);
  });

  it("does not get fooled by nested fields named method/id (Codex B2 reason this exists)", () => {
    // A notification whose params include an inner object with a "method"
    // key. grep would have matched the inner one and miscategorized.
    const line = frame({
      method: "item/agentMessage/delta",
      params: { delta: 'pretend method: "fake/method" id: 99' },
    });
    const r = splitCapture(line);
    expect(r.counts.notifications).toBe(1);
    expect(r.counts.requests).toBe(0);
  });

  it("skips blank lines without affecting counts", () => {
    const lines = `\n\n${frame({ method: "x" })}\n\n`;
    const r = splitCapture(lines);
    expect(r.counts.notifications).toBe(1);
  });

  it("throws on non-JSON line (operator visibility)", () => {
    // T4 wants a clean capture before splitting; noisy stderr leaks
    // surface as an error, not as silent data loss.
    expect(() => splitCapture(`not json\n${frame({ method: "x" })}`)).toThrow(/not valid JSON/);
  });

  it("counts arrays/primitives at top level as unknown shapes", () => {
    const r = splitCapture(frame({ /* method missing */ params: { x: 1 } }));
    expect(r.counts.unknown).toBe(1);
  });
});
