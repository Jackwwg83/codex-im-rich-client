import type { ChannelAdapter } from "@codex-im/channel-core";
import { isSlackActionWirePayload } from "./callback-codec.js";

type ApprovalCardInput = Parameters<ChannelAdapter["sendCard"]>[1];
type ApprovalActionInput = ApprovalCardInput["actions"][number];

export interface SlackApprovalCardMessage {
  readonly text: "Codex approval";
  readonly blocks: readonly SlackApprovalCardBlock[];
}

export interface RenderSlackApprovalCardOptions {
  readonly blockIdSuffix?: string;
}

export type SlackApprovalCardBlock = SlackSectionBlock | SlackActionsBlock;

export interface SlackSectionBlock {
  readonly type: "section";
  readonly text: {
    readonly type: "mrkdwn";
    readonly text: string;
  };
}

export interface SlackActionsBlock {
  readonly type: "actions";
  readonly block_id: string;
  readonly elements: readonly SlackApprovalCardButton[];
}

export interface SlackApprovalCardButton {
  readonly type: "button";
  readonly text: {
    readonly type: "plain_text";
    readonly text: string;
  };
  readonly action_id: `codex_im_approval_${number}`;
  readonly value: string;
  readonly style?: "primary" | "danger";
}

export function renderSlackApprovalCard(
  card: ApprovalCardInput,
  options: RenderSlackApprovalCardOptions = {},
): SlackApprovalCardMessage {
  const blocks: SlackApprovalCardBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          `*Summary:* ${card.summary}`,
          `*Risk:* ${card.target.riskLevel}`,
          `*Status:* ${card.status}`,
        ].join("\n"),
      },
    },
  ];

  if (card.actions.length > 0) {
    blocks.push({
      type: "actions",
      block_id: slackApprovalActionsBlockId(options.blockIdSuffix),
      elements: card.actions.map(buttonForAction),
    });
  }

  return { text: "Codex approval", blocks };
}

function slackApprovalActionsBlockId(suffix: string | undefined): string {
  return suffix === undefined ? "codex_im_approval_actions" : `codex_im_approval_actions:${suffix}`;
}

function buttonForAction(action: ApprovalActionInput, index: number): SlackApprovalCardButton {
  const wirePayload = action.wirePayload;
  if (wirePayload === undefined) {
    throw new Error("SlackChannelAdapter.sendCard requires action.wirePayload");
  }
  if (!isSlackActionWirePayload(wirePayload)) {
    throw new Error("SlackChannelAdapter.sendCard requires v1 opaque wirePayload");
  }
  return {
    type: "button",
    text: { type: "plain_text", text: labelForAction(action.kind) },
    action_id: `codex_im_approval_${index}`,
    value: wirePayload,
    ...buttonStyle(action.kind),
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

function buttonStyle(kind: ApprovalActionInput["kind"]): Pick<SlackApprovalCardButton, "style"> {
  switch (kind) {
    case "allow_once":
    case "allow_session":
      return { style: "primary" };
    case "abort":
      return { style: "danger" };
    case "decline":
      return {};
  }
}
