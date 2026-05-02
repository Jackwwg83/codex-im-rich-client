const LARK_ACTION_WIRE_RE = /^v1:[A-Z2-7]{16}$/;

export function isLarkActionWirePayload(value: string): boolean {
  return LARK_ACTION_WIRE_RE.test(value);
}

export function extractLarkActionWirePayload(value: unknown): string | undefined {
  if (typeof value === "string") {
    return isLarkActionWirePayload(value) ? value : undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== "wirePayload") {
    return undefined;
  }

  const wirePayload = value.wirePayload;
  return typeof wirePayload === "string" && isLarkActionWirePayload(wirePayload)
    ? wirePayload
    : undefined;
}

export function redactLarkActionPayloadForLog(value: unknown): string {
  return extractLarkActionWirePayload(value) === undefined
    ? "[invalid-lark-action-payload]"
    : "v1:[redacted]";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
