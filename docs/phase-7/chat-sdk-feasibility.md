# Vercel Chat SDK Feasibility Spike

Generated: 2026-05-03  
Linear issue: JAC-103  
Branch: `codex/phase-7-planning`  
Verdict from JAC-104: `spike-only`

This is a docs/static-analysis spike. It does not install Chat SDK packages,
instantiate SDK adapters, create webhook handlers, probe environment variables,
or change runtime behavior.

## Verdict

Vercel Chat SDK is useful as a reference for broad platform capability and
future adapter-layer research, but it is not safe to adopt as a Phase 7 runtime
dependency or bridge.

Recommended next state:

- Keep JAC-103 complete as `spike-only`.
- Do not create `packages/im-chat-sdk` or `adapter-chat-sdk` in the autonomous
  Phase 7 loop.
- Allow JAC-105 fallback renderer to proceed independently as a native
  render/channel-core feature, because Chat SDK does not block generic
  non-actionable fallback.
- If Chat SDK is reconsidered later, require a new plan-gated issue that proves
  it can be wrapped outside `ChannelAdapter` without replacing Codex App Server
  thread/turn/item semantics, without auto-started webhooks, and without
  credential auto-detection.

## Evidence From Official Docs

- Chat SDK is presented as a TypeScript SDK for building chat bots across Slack,
  Teams, Discord, Linear, Telegram, WhatsApp, and related platforms from one
  codebase.
- Its core concepts are `Chat`, platform adapters, and pluggable state.
- Platform adapters handle webhook verification, platform payload parsing, and
  outgoing API calls.
- The adapter feature matrix varies widely across messaging, rich content,
  conversations, and message history. Native streaming exists only on some
  platforms; others use post-and-edit style fallbacks.
- The docs state adapter factories auto-detect credentials from environment
  variables and expose webhook handlers through `bot.webhooks.<name>`.
- Production guidance expects webhook routes, Redis/Postgres-like state, and
  platform credentials as environment variables.

Sources:

- https://chat-sdk.dev/docs/adapters
- https://vercel.com/kb/guide/the-complete-guide-to-chat-sdk

## Boundary Analysis

| Chat SDK concept | Fit for this project | Risk |
|---|---|---|
| `Chat` main entry point | Poor fit as product core. Codex IM already has `Core -> CodexRuntime -> AppServerClient` as the source of thread/turn/item truth. | Would create a second chat runtime and risk replacing rich App Server semantics with generic bot state. |
| Platform adapters | Potential reference for future platform support, but not directly usable as `ChannelAdapter` without a wrapper. | Adapters parse webhooks and issue API calls through their own lifecycle; may bypass project SecurityPolicy/SessionRouter if used directly. |
| State adapters | Not a fit for Codex thread/turn/session authority. | Redis/Postgres Chat SDK state is for subscriptions/locks, not Codex App Server state. |
| Webhook handlers | Not allowed in Phase 7 default path. | Public listener/webhook exposure conflicts with the no-public-listener redline unless a later operator-gated plan approves exact binding/auth. |
| Credential auto-detection | Not allowed in Phase 7 spikes. | Environment probing can pull real tokens into runtime unexpectedly and conflicts with explicit secret indirection/redaction rules. |
| Cards/actions | Useful for capability comparison. | Action handlers use SDK callback ids and event shapes; they do not prove daemon `v1:` token + actor + target + messageRef validation. |
| Streaming | Useful as design reference. | Native vs post-edit fallbacks vary by platform; Codex render scheduling must remain native to this project. |

## Platform Gap Notes

| Platform family | Chat SDK capability signal | Project compatibility note |
|---|---|---|
| Slack | Strong rich UI, native streaming, ephemeral/modals in Chat SDK docs. | Future native Slack adapter may be valuable, but should be planned directly against `ChannelAdapter` and Slack auth/webhook constraints. |
| Teams | Adaptive cards and mentions. | Potential native adapter candidate, but webhook/Bot Framework auth requires separate plan. |
| Google Chat | Google Chat cards and spaces/threads. | Potential native adapter candidate; Workspace event topology must be reviewed. |
| Discord | Embeds, slash commands, threads. | Potential native adapter candidate; approval buttons/messageRef need raw fixture proof. |
| Telegram | Chat SDK lists Telegram support, but project already ships native Telegram with stronger callback/messageRef validation. | No reason to replace native adapter. |
| GitHub | Issue/PR comment threads. | Could be a future non-IM workflow surface, but not a rich IM replacement. |
| Linear | Issue comment threads and app-actor sessions. | Useful for project-management automation, not a Codex App Server rich-client adapter by default. |
| WhatsApp | Channel-scoped conversations and templates. | Potential future adapter, but template and webhook constraints need platform-specific plan. |

## Mapping To ChannelAdapter

| ChannelAdapter surface | Chat SDK fit | Required future guardrail |
|---|---|---|
| `start()` / `stop()` | No direct fit without owning Chat SDK adapter lifecycle and webhooks. | Future wrapper must not auto-start webhooks/listeners or auto-detect credentials. |
| `onMessage()` | Possible through Chat SDK handlers, but handler events are shaped by Chat SDK thread/message abstractions. | Must map to `InboundMessage` without substituting Chat SDK thread state for Codex SessionRouter state. |
| `onAction()` | Possible in platforms with cards/actions. | Must prove opaque `v1:` payload, actor, target, callback handle, and messageRef before any `broker.resolve`. |
| `sendCard()` / `updateCard()` | Cards exist, but platform feature support varies. | Native project renderer must remain source of approval card shape; Chat SDK cards cannot become approval protocol. |
| `editText()` | Some platforms support edit or post-and-edit streaming. | Capability must be platform-specific and fixture-proven. |
| `answerAction()` | No universal fit across SDK adapters. | Missing ack must never imply approval success. |
| `sendFile()` | File upload support varies. | Default unsupported unless platform-specific evidence exists. |

## Recommendation

Do not implement Chat SDK runtime integration in Phase 7. Use it only as:

- a capability reference for future native adapter prioritization;
- a source of platform feature vocabulary;
- a reminder that broad adapter frameworks still need project-specific
  approval, messageRef, SecurityPolicy, SessionRouter, and render contracts.

JAC-105 fallback renderer may proceed next because both JAC-102 and JAC-103
confirm lower-capability platforms need safe non-actionable fallback, not
Chat-SDK-driven approval commands.

Any future Chat SDK implementation proposal must start from:

- adapter-layer only, never Codex core;
- explicit config object, no env auto-detection;
- no default webhook/public listener;
- no Chat SDK state as Codex session authority;
- no approval resolve without daemon token lookup, messageRef validation, actor
  policy, and `ApprovalBroker.resolve`;
- no Computer Use trigger except daemon explicit `/cu`.
