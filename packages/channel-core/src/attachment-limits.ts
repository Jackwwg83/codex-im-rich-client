export const DEFAULT_MAX_INBOUND_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export class InboundAttachmentTooLargeError extends Error {
  readonly name = "InboundAttachmentTooLargeError";
  readonly reason = "too_large";

  constructor(
    readonly sizeBytes: number,
    readonly maxBytes: number,
  ) {
    super(inboundAttachmentTooLargeMessage(maxBytes));
  }
}

export function normalizeMaxInboundAttachmentBytes(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) || value <= 0
    ? DEFAULT_MAX_INBOUND_ATTACHMENT_BYTES
    : Math.floor(value);
}

export function isInboundAttachmentTooLarge(
  sizeBytes: number | undefined,
  maxBytes: number,
): boolean {
  return sizeBytes !== undefined && Number.isFinite(sizeBytes) && sizeBytes > maxBytes;
}

export function inboundAttachmentTooLargeMessage(maxBytes: number): string {
  return `Attachment too large. Maximum supported inbound attachment size is ${maxBytes} bytes.`;
}

export function assertInboundAttachmentWithinLimit(
  sizeBytes: number | undefined,
  maxBytes: number,
): void {
  if (sizeBytes !== undefined && isInboundAttachmentTooLarge(sizeBytes, maxBytes)) {
    throw new InboundAttachmentTooLargeError(sizeBytes, maxBytes);
  }
}

export function isInboundAttachmentTooLargeError(
  error: unknown,
): error is InboundAttachmentTooLargeError {
  return (
    error instanceof InboundAttachmentTooLargeError ||
    (typeof error === "object" &&
      error !== null &&
      (error as { readonly reason?: unknown }).reason === "too_large")
  );
}
