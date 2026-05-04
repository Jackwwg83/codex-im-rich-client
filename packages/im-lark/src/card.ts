import type { ChannelAdapter } from "@codex-im/channel-core";
import { isLarkActionWirePayload } from "./callback-codec.js";

export const LARK_CARD_MAX_CONTENT_BYTES = 30 * 1024;
export const LARK_CARD_UPDATE_MAX_QPS_PER_MESSAGE = 5;

type ApprovalCardInput = Parameters<ChannelAdapter["sendCard"]>[1];
type ApprovalActionInput = ApprovalCardInput["actions"][number];

export interface LarkApprovalCardJson {
  readonly schema: "2.0";
  readonly config: {
    readonly update_multi: boolean;
  };
  readonly header: {
    readonly title: { readonly tag: "plain_text"; readonly content: string };
    readonly template: "blue" | "green" | "orange" | "red";
  };
  readonly body: {
    readonly elements: readonly LarkApprovalCardElement[];
  };
}

export type LarkApprovalCardElement =
  | {
      readonly tag: "markdown";
      readonly content: string;
    }
  | {
      readonly tag: "column_set";
      readonly horizontal_spacing: "8px";
      readonly columns: readonly LarkApprovalCardColumn[];
    };

export interface LarkApprovalCardColumn {
  readonly tag: "column";
  readonly width: "auto";
  readonly elements: readonly LarkApprovalCardButton[];
}

export interface LarkApprovalCardButton {
  readonly tag: "button";
  readonly text: { readonly tag: "plain_text"; readonly content: string };
  readonly type: "default" | "primary" | "danger";
  readonly behaviors: readonly [
    {
      readonly type: "callback";
      readonly value: string;
    },
  ];
}

export function renderLarkApprovalCard(card: ApprovalCardInput): LarkApprovalCardJson {
  const rendered: LarkApprovalCardJson = {
    schema: "2.0",
    config: { update_multi: true },
    header: {
      title: { tag: "plain_text", content: "Codex approval" },
      template: templateForRisk(card.target.riskLevel),
    },
    body: {
      elements: [
        {
          tag: "markdown",
          content: [
            `**Summary:** ${card.summary}`,
            `**Risk:** ${card.target.riskLevel}`,
            `**Status:** ${card.status}`,
          ].join("\n"),
        },
        {
          tag: "column_set",
          horizontal_spacing: "8px",
          columns: card.actions.map((action) => ({
            tag: "column",
            width: "auto",
            elements: [buttonForAction(action)],
          })),
        },
      ],
    },
  };
  assertLarkApprovalCardWithinLimits(rendered);
  return rendered;
}

function buttonForAction(action: ApprovalActionInput): LarkApprovalCardButton {
  const wirePayload = action.wirePayload;
  if (wirePayload === undefined) {
    throw new Error("LarkChannelAdapter.sendCard requires action.wirePayload");
  }
  if (!isLarkActionWirePayload(wirePayload)) {
    throw new Error("LarkChannelAdapter.sendCard requires v1 opaque wirePayload");
  }
  return {
    tag: "button",
    text: { tag: "plain_text", content: labelForAction(action.kind) },
    type: typeForAction(action.kind),
    behaviors: [{ type: "callback", value: wirePayload }],
  };
}

export function assertLarkApprovalCardWithinLimits(card: LarkApprovalCardJson): void {
  const byteLength = new TextEncoder().encode(JSON.stringify(card)).byteLength;
  if (byteLength > LARK_CARD_MAX_CONTENT_BYTES) {
    throw new Error(`Lark approval card exceeds ${LARK_CARD_MAX_CONTENT_BYTES} byte content limit`);
  }
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

function typeForAction(kind: ApprovalActionInput["kind"]): LarkApprovalCardButton["type"] {
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

function templateForRisk(
  risk: ApprovalCardInput["target"]["riskLevel"],
): LarkApprovalCardJson["header"]["template"] {
  switch (risk) {
    case "low":
      return "green";
    case "moderate":
      return "blue";
    case "high":
      return "orange";
    case "critical":
      return "red";
  }
}
