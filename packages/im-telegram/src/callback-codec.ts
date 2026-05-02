const CALLBACK_PREFIX = "v1:";
const RAW_TOKEN_RE = /^[A-Z2-7]{16}$/;

export function encodeCallbackData(rawToken: string): string {
  if (!RAW_TOKEN_RE.test(rawToken)) {
    throw new Error("Telegram callback_data requires a 16-char opaque token");
  }
  return `${CALLBACK_PREFIX}${rawToken}`;
}

export function decodeCallbackData(callbackData: string): string | undefined {
  if (!callbackData.startsWith(CALLBACK_PREFIX)) {
    return undefined;
  }
  const rawToken = callbackData.slice(CALLBACK_PREFIX.length);
  return RAW_TOKEN_RE.test(rawToken) ? rawToken : undefined;
}
