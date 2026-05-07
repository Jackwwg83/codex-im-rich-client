const SLACK_ACTION_WIRE_RE = /^v1:[A-Z2-7]{16}$/;

export function isSlackActionWirePayload(value: string): boolean {
  return SLACK_ACTION_WIRE_RE.test(value);
}

export function extractSlackActionWirePayload(value: unknown): string | undefined {
  return typeof value === "string" && isSlackActionWirePayload(value) ? value : undefined;
}

export function redactSlackActionPayloadForLog(value: unknown): string {
  return extractSlackActionWirePayload(value) === undefined
    ? "[invalid-slack-action-payload]"
    : "v1:[redacted]";
}
