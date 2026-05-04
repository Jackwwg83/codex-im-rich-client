const LARK_ACTION_WIRE_RE = /^v1:[A-Z2-7]{16}$/;

export interface LarkActionCallbackValue {
  readonly token: string;
}

export function isLarkActionWirePayload(value: string): boolean {
  return LARK_ACTION_WIRE_RE.test(value);
}

export function createLarkActionCallbackValue(wirePayload: string): LarkActionCallbackValue {
  if (!isLarkActionWirePayload(wirePayload)) {
    throw new Error("Lark action callback value requires v1 opaque wirePayload");
  }
  return { token: wirePayload };
}

export function extractLarkActionWirePayload(value: unknown): string | undefined {
  if (typeof value === "string") {
    return isLarkActionWirePayload(value) ? value : undefined;
  }
  if (!isExactCallbackValue(value)) {
    return undefined;
  }
  return isLarkActionWirePayload(value.token) ? value.token : undefined;
}

export function redactLarkActionPayloadForLog(value: unknown): string {
  return extractLarkActionWirePayload(value) === undefined
    ? "[invalid-lark-action-payload]"
    : "v1:[redacted]";
}

function isExactCallbackValue(value: unknown): value is LarkActionCallbackValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  return keys.length === 1 && keys[0] === "token" && typeof record.token === "string";
}
