# Launch Scope

Status: launch-scope snapshot for `codex/live-im-acceptance`.

This product is a private local Codex App Server remote-control bridge. It lets
authorized IM users start Codex development tasks, observe progress, approve
risky actions, and receive results/artifacts through IM. It is not a generic
chatbot, not an OpenClaw plugin, not a Codex CLI/TUI parser, and not a remote
desktop product.

## Supported Platform Tiers

| Tier | Platform | Launch position |
|---|---|---|
| Primary personal entry | Telegram | Best personal/operator path for direct remote Codex use. |
| Primary team entry | Feishu/Lark or Slack | Choose based on the team's real collaboration system. |
| Compatibility entry | DingTalk | Supported and live-accepted, but avoid adding platform-only product features unless a real team depends on it. |
| Frozen for this launch | Satori/Koishi, Discord, Teams, enterprise WeChat, other adapters | Do not add platform count during this launch cycle. |

Platform-specific polish must not leak into Core. New behavior should first be
expressed through the common `ChannelAdapter` capability surface; no Slack-only,
Lark-only, or DingTalk-only Core shortcuts.

## Command Matrix

These commands are aligned with the current router in
`packages/core/src/command-router.ts` plus the explicit Computer Use aliases in
`packages/core/src/computer-use-command.ts`.

| User action | Launch behavior |
|---|---|
| Plain text | Enters the current bound Codex thread/turn. |
| `/start`, `/help` | Basic onboarding/help only. |
| `/projects`, `/use <project>` | List/select configured Codex projects. |
| `/new`, `/threads`, `/switch <n>`, `/alias <name>`, `/fork`, `/stop` | Native project/thread/turn control. |
| `/status`, `/whoami` | Redacted daemon, binding, identity, and pending-approval status. |
| `/model`, `/compact`, `/usage`, `/diagnostics` | Codex-native model, context, usage, and diagnostic surfaces. |
| `/tools`, `/skills`, `/plugins`, `/apps` | Codex capability discovery, redacted and summary-only. |
| `/mcp`, `/mcp login <server>`, `/mcp reload` | MCP status and App Server MCP login/reload wrappers. |
| `/approvals`, `/approve <id> <action>` | Text fallback for already-bound pending approvals only. |
| `/cu status` | Computer Use policy/provider/readiness only; no desktop action. |
| `/cu <task>` or `/computer-use <task>` | Explicit scoped Computer Use turn. Normal prompts cannot trigger CU. |

Minimal user help should show only project binding, plain prompts, status, stop,
approval behavior, attachments, and bounded `/cu` scope on the first screen.
Internal protocol details belong in docs, not first-use IM help.

## First-Use Setup

Use `docs/setup/getting-started.md` plus `pnpm setup:im` for first-time local
onboarding. The setup flow is intentionally local and CLI-based:

- the user creates one IM bot/app in the IM platform console;
- the wizard writes `~/.codex-im-bridge/config.toml`;
- the wizard writes IM secrets to macOS Keychain;
- `pnpm im:doctor` checks readiness and prints repair hints.

Do not build or rely on a cloud credential store, web configuration backend, or
auto-provisioning of IM platform apps for this launch.

## Attachments

- Outbound artifacts may be sent as files/images when the adapter supports
  `sendFile`.
- Inbound images are passed to Codex as native local image input where the App
  Server supports it.
- Inbound generic files become explicit local-path prompt context because there
  is no generic `UserInput.file` App Server shape in the current protocol.
- Inbound attachment directories must be `0700`; materialized files must be
  `0600`.
- The daemon enforces a configurable inbound size cap:
  `daemon.max_inbound_attachment_bytes` (default 25 MiB).
- Oversized inbound attachments fail closed with a short user-visible message
  and do not start a Codex turn.

## Computer Use Scope

Accepted launch claim:

- Computer Use requires explicit `/cu`.
- `/cu status` can report provider readiness and policy state without action.
- The accepted provider evidence is bounded local macOS Chrome:
  local file/localhost navigation plus observe/click/type through existing
  session, policy, audit, allowed-tool, and provider gates.
- Dynamic-tool summaries may report app, step/action, policy decision, blocked
  reason, approval-required state, and screenshot/artifact attachments when
  present.

Not accepted:

- Arbitrary desktop automation.
- Secret entry, token/password handling, payment, external website control, or
  unattended sensitive actions.
- Raw screen-streaming or raw DOM dump as a product surface.

## Approval Fallback

Buttons/cards remain the primary path. `/approve <id> <action>` is only a
fallback for a pending approval that already has server-side bound callback
token state and a bound approval-card `messageRef`. IM text never accepts raw
callback tokens, raw message refs, or arbitrary approval payloads.

## Launch Stop Conditions

Stop and rollback or disable the bridge if any of these happen:

- token-shaped material appears in repo docs, logs, SQLite, plist, Linear, or
  review packets;
- a live IM/Codex/Computer Use action starts without an explicit gate;
- approval resolution bypasses `ApprovalBroker`, `SecurityPolicy`,
  callback-token state, or `messageRef` validation;
- a public listener is introduced;
- normal prompt text can trigger Computer Use;
- Computer Use performs secret entry, external website control, payment,
  deletion, posting, settings changes, or other sensitive action without the
  explicit scoped gate and approval model.

## Post-Launch Backlog

Good follow-ups:

- richer `/status` with last event time, last failure, app-server health, and
  active turn age;
- task presets such as read-only check, fix failing test, review diff, run
  tests, and continue previous;
- `/artifacts` or recent attachment listing for logs, patches, and screenshots;
- per-chat noise level: normal, verbose, quiet;
- read-only local web console for status/threads/pending approvals/audit;
- simple operator/approver/viewer role model;
- safer Computer Use observation summaries.

Do not spend this launch cycle on new platforms, generic chatbot persona,
remote desktop UX, complex RBAC/workflow DSL, marketplace concepts, or copying
the full Codex App UI into IM.
