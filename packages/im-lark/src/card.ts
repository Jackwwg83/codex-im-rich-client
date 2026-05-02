import type { ChannelAdapter } from "@codex-im/channel-core";
import { isLarkActionWirePayload } from "./callback-codec.js";

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
  readonly elements: readonly LarkApprovalCardElement[];
}

export type LarkApprovalCardElement =
  | {
      readonly tag: "markdown";
      readonly content: string;
    }
  | {
      readonly tag: "action";
      readonly actions: readonly LarkApprovalCardButton[];
    };

export interface LarkApprovalCardButton {
  readonly tag: "button";
  readonly text: { readonly tag: "plain_text"; readonly content: string };
  readonly type: "default" | "primary" | "danger";
  readonly value: { readonly wirePayload: string };
}

export function renderLarkApprovalCard(card: ApprovalCardInput): LarkApprovalCardJson {
  return {
    schema: "2.0",
    config: { update_multi: true },
    header: {
      title: { tag: "plain_text", content: "Codex approval" },
      template: templateForRisk(card.target.riskLevel),
    },
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
        tag: "action",
        actions: card.actions.map(buttonForAction),
      },
    ],
  };
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
    value: { wirePayload },
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
