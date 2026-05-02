const LARK_ACTION_WIRE_RE = /^v1:[A-Z2-7]{16}$/;

export function isLarkActionWirePayload(value: string): boolean {
  return LARK_ACTION_WIRE_RE.test(value);
}

export function extractLarkActionWirePayload(value: unknown): string | undefined {
  return typeof value === "string" && isLarkActionWirePayload(value) ? value : undefined;
}

export function redactLarkActionPayloadForLog(value: unknown): string {
  return extractLarkActionWirePayload(value) === undefined
    ? "[invalid-lark-action-payload]"
    : "v1:[redacted]";
}
