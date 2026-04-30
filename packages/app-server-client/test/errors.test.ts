import { describe, expect, it } from "vitest";
import {
  JsonRpcResponseError,
  RequestTimeoutError,
  TransportClosedError,
  TransportProtocolError,
} from "../src/errors.js";

describe("typed error hierarchy", () => {
  it("JsonRpcResponseError carries code, message, optional data", () => {
    const err = new JsonRpcResponseError({
      code: -32600,
      message: "Invalid request",
      data: { extra: 1 },
    });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(JsonRpcResponseError);
    expect(err.name).toBe("JsonRpcResponseError");
    expect(err.code).toBe(-32600);
    expect(err.data).toEqual({ extra: 1 });
    expect(err.message).toContain("-32600");
    expect(err.message).toContain("Invalid request");
  });

  it("JsonRpcResponseError handles missing data field (codex 0.125.0 absence)", () => {
    const err = new JsonRpcResponseError({ code: -32600, message: "bad" });
    expect(err.data).toBeUndefined();
  });

  it("TransportClosedError carries exit code (or null)", () => {
    const e1 = new TransportClosedError(137);
    expect(e1).toBeInstanceOf(Error);
    expect(e1.exitCode).toBe(137);
    expect(e1.message).toContain("137");

    const e2 = new TransportClosedError(null);
    expect(e2.exitCode).toBeNull();
    expect(e2.message).toContain("null");
  });

  it("TransportProtocolError carries optional offending line", () => {
    const e1 = new TransportProtocolError("bad framing");
    expect(e1.line).toBeUndefined();
    expect(e1.message).toBe("bad framing");

    const e2 = new TransportProtocolError("bad framing", "garbage line");
    expect(e2.line).toBe("garbage line");
  });

  it("RequestTimeoutError carries method + timeoutMs", () => {
    const err = new RequestTimeoutError("turn/start", 30_000);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("RequestTimeoutError");
    expect(err.method).toBe("turn/start");
    expect(err.timeoutMs).toBe(30_000);
    expect(err.message).toContain("turn/start");
    expect(err.message).toContain("30000");
  });
});
