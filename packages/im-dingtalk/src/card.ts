import type { ChannelAdapter } from "@codex-im/channel-core";
import { isDingTalkActionWirePayload } from "./callback-codec.js";

export const DINGTALK_CARD_CALLBACK_TYPE = "STREAM";
export const DINGTALK_CARD_MAX_CONTENT_BYTES = 30 * 1024;

type ApprovalCardInput = Parameters<ChannelAdapter["sendCard"]>[1];
type ApprovalActionInput = ApprovalCardInput["actions"][number];

export interface DingTalkApprovalCardJson {
  readonly schema: "codex-im.dingtalk.approval-card.v1";
  readonly callbackType: typeof DINGTALK_CARD_CALLBACK_TYPE;
  readonly title: string;
  readonly body: readonly DingTalkApprovalCardBlock[];
  readonly actions: readonly DingTalkApprovalCardButton[];
}

export interface DingTalkApprovalCardBlock {
  readonly type: "markdown";
  readonly text: string;
}

export interface DingTalkApprovalCardButton {
  readonly text: string;
  readonly type: "default" | "primary" | "danger";
  readonly value: string;
}

export function renderDingTalkApprovalCard(card: ApprovalCardInput): DingTalkApprovalCardJson {
  const rendered: DingTalkApprovalCardJson = {
    schema: "codex-im.dingtalk.approval-card.v1",
    callbackType: DINGTALK_CARD_CALLBACK_TYPE,
    title: "Codex approval",
    body: [
      {
        type: "markdown",
        text: [
          `**Summary:** ${card.summary}`,
          `**Risk:** ${card.target.riskLevel}`,
          `**Status:** ${card.status}`,
        ].join("\n"),
      },
    ],
    actions: card.actions.map(buttonForAction),
  };
  assertDingTalkApprovalCardWithinLimits(rendered);
  return rendered;
}

export function assertDingTalkApprovalCardWithinLimits(card: DingTalkApprovalCardJson): void {
  const byteLength = new TextEncoder().encode(JSON.stringify(card)).byteLength;
  if (byteLength > DINGTALK_CARD_MAX_CONTENT_BYTES) {
    throw new Error(`DingTalk approval card exceeds ${DINGTALK_CARD_MAX_CONTENT_BYTES} byte limit`);
  }
}

function buttonForAction(action: ApprovalActionInput): DingTalkApprovalCardButton {
  const wirePayload = action.wirePayload;
  if (wirePayload === undefined) {
    throw new Error("DingTalkChannelAdapter.sendCard requires action.wirePayload");
  }
  if (!isDingTalkActionWirePayload(wirePayload)) {
    throw new Error("DingTalkChannelAdapter.sendCard requires v1 opaque wirePayload");
  }
  return {
    text: labelForAction(action.kind),
    type: typeForAction(action.kind),
    value: wirePayload,
  };
}

function labelForAction(kind: ApprovalActionInput["kind"]): string {
  switch (kind) {
    case "allow_once":
      return "Allow once";
    case "allow_session":
      return "Allow session";
    case "decline":
      return "Decline";
    case "abort":
      return "Abort";
  }
}

function typeForAction(kind: ApprovalActionInput["kind"]): DingTalkApprovalCardButton["type"] {
  switch (kind) {
    case "allow_once":
    case "allow_session":
      return "primary";
    case "decline":
      return "default";
    case "abort":
      return "danger";
  }
}
