import { describe, expect, it } from "vitest";
import {
  isJsonRpcErrorResponse,
  isJsonRpcNotification,
  isJsonRpcResponse,
  isJsonRpcServerRequest,
} from "../src/jsonrpc.js";

describe("JSON-RPC lite type guards", () => {
  it("classifies success response (id + result, no method)", () => {
    expect(isJsonRpcResponse({ id: 1, result: { x: 1 } })).toBe(true);
    expect(isJsonRpcErrorResponse({ id: 1, result: { x: 1 } })).toBe(false);
  });

  it("classifies error response (id + error, no method)", () => {
    const m = { id: 1, error: { code: -32600, message: "bad" } };
    expect(isJsonRpcResponse(m)).toBe(true);
    expect(isJsonRpcErrorResponse(m)).toBe(true);
  });

  it("accepts string id (codex 0.125.0 wire spike confirmed both)", () => {
    expect(isJsonRpcResponse({ id: "abc", result: {} })).toBe(true);
    expect(isJsonRpcServerRequest({ id: "abc", method: "approval/x" })).toBe(true);
  });

  it("classifies server-initiated request (id + method, no result/error)", () => {
    expect(isJsonRpcServerRequest({ id: 42, method: "approval/whatever" })).toBe(true);
    expect(isJsonRpcResponse({ id: 42, method: "approval/whatever" })).toBe(false);
  });

  it("classifies notification (method, no id)", () => {
    expect(isJsonRpcNotification({ method: "turn/started", params: {} })).toBe(true);
    expect(isJsonRpcNotification({ method: "turn/started" })).toBe(true);
  });

  it("rejects ambiguous shapes (method + result on same envelope)", () => {
    expect(isJsonRpcResponse({ id: 1, result: {}, method: "x" })).toBe(false);
    expect(isJsonRpcServerRequest({ id: 1, result: {}, method: "x" })).toBe(false);
  });

  it("rejects bare empty object", () => {
    expect(isJsonRpcResponse({})).toBe(false);
    expect(isJsonRpcNotification({})).toBe(false);
    expect(isJsonRpcServerRequest({})).toBe(false);
  });

  it("rejects null and arrays", () => {
    expect(isJsonRpcResponse(null)).toBe(false);
    expect(isJsonRpcResponse([])).toBe(false);
    expect(isJsonRpcNotification(null)).toBe(false);
    expect(isJsonRpcServerRequest("string")).toBe(false);
  });

  it("error response with id null (per JSON-RPC spec, e.g. parse-error case)", () => {
    const m = { id: null, error: { code: -32700, message: "parse error" } };
    expect(isJsonRpcResponse(m)).toBe(true);
    expect(isJsonRpcErrorResponse(m)).toBe(true);
  });
});
