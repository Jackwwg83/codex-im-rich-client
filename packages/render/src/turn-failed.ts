// Phase 3 T19d — renderer extension for daemon-synthesized turn failures.
//
// This is intentionally structural instead of importing CodexRichEvent from
// @codex-im/codex-runtime. The render package stays below runtime/daemon and
// only needs the public shape required to render the terminal message.

export type TurnFailedRenderEvent = {
  readonly type: "turn_failed";
  readonly threadId: string;
  readonly turnId: string;
  readonly cause?: "transport_lost";
};

export function formatTurnFailed(event: TurnFailedRenderEvent): string {
  const reason =
    event.cause === "transport_lost"
      ? "Codex transport was lost before this turn completed."
      : "Codex reported this turn as failed.";

  return ["Turn failed", "", reason, `Thread: ${event.threadId}`, `Turn: ${event.turnId}`].join(
    "\n",
  );
}
