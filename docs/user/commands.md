# IM Commands

Plain text enters the current Codex conversation. If there is no current
conversation, Codex-IM starts a new Codex default conversation through App
Server native `thread/start({})`. Slash commands control optional project
selection, native Codex conversations, status, approval, and bounded Computer
Use behavior.

## First Commands

```text
/projects
/use 1
Reply exactly: OK
```

`/projects` lists the Codex projects available to this IM chat. Choose by
number when possible so you do not need to remember project names. If the
project and your IM user/chat are allowlisted, Codex should reply through the
same IM conversation.

You can also create a new thread and start the first turn in one message:

```text
/new 1 Reply exactly: OK
```

If you have not selected a project, `/new Reply exactly: OK` creates a Codex
default conversation. The daemon stores the App Server returned cwd internally,
but normal IM output still shows `project: Codex default` rather than a local
path.

Raw paths such as `/Users/me/repo` or `~/repo` are rejected from IM. Add or
change projects locally through setup/config, then select them from `/projects`.

Default IM output is normal mode: ordinary prompts show the assistant answer,
not token usage, thread lifecycle notices, internal skill-loading commands, or
automatic command-log attachments. Use `/status`, `/diagnostics`, or local
admin logs when you need technical detail.

## Project And Conversation Control

| Command | Use |
|---|---|
| `/projects` | List Codex projects available to this IM chat. |
| `/cwds` | Technical alias for `/projects`; output does not show local paths. |
| `/use <number-or-name>` | Select a project for the current IM target. |
| `/new` | Start an empty Codex conversation in the current project, or Codex default when no project is selected. |
| `/new <task>` | Start a new Codex conversation and immediately send `<task>` as the first prompt. |
| `/new <number-or-name> <task>` | Select a configured project by number/name, start a new conversation there, and immediately send `<task>`. |
| `/new --title <title>` | Start an empty conversation with an IM-local title; does not start a Codex turn. |
| `/threads` | List visible native Codex App Server conversations, including conversations created from Codex App or CLI. Visibility depends on `native_thread_visibility`. |
| `/threads --refresh` | Import visible native Codex App Server conversations into the local IM thread index without promoting their cwd to configured projects. |
| `/thread <number-or-thread-prefix>` | Show redacted details and recent content for a visible native Codex conversation before switching. |
| `/switch <number-or-thread-prefix>` | Resume and bind this IM chat to a visible native Codex conversation. |
| `/alias <name>` | Give the current conversation a local title (IM only; never sent to Codex). |
| `/rename <title>` | Rename the current thread. Synced to Codex App Server when supported; otherwise updates the local alias and tells you Codex was not changed. |
| `/archive` | Archive the current thread. Synced to Codex when supported; otherwise marks the thread archived locally. |
| `/unarchive` | Reopen an archived thread. Synced to Codex when supported; otherwise marks the thread open locally. |
| `/fork [thread]` | Fork the current or selected Codex conversation. |
| `/stop` | Interrupt the active turn. |

## Status And Diagnostics

Local lifecycle commands:

```bash
pnpm codex-im:status
pnpm codex-im:upgrade --check
pnpm codex-im:upgrade --plan
pnpm codex-im:upgrade --apply --dry-run
pnpm codex-im:upgrade --apply
```

`codex-im:status` is local-only by default. `upgrade --check` may contact the
git remote and refresh `~/.codex-im-bridge/update-check.json`; the cache is
advisory and never contains IM secrets.

In this alpha release, source-checkout upgrade apply is wired up:

- `pnpm codex-im:upgrade --apply --dry-run` previews the upgrade plan but does
  not actually upgrade.
- `pnpm codex-im:upgrade --apply` activates the current checkout, rebuilds and
  installs the daemon bundle, restarts launchd, and runs local status/doctor
  checks. It requires a clean worktree.
- `pnpm codex-im:rollback` is rejected with an explanatory error. To roll back
  today, check out the previous tag and run `pnpm codex-im:upgrade --apply`.

| Command | Use |
|---|---|
| `/status` | Redacted daemon, binding, and pending-approval status. |
| `/whoami` | Show the IM identity and allowlist target seen by Codex-IM. |
| `/model` | Show or control the Codex model surface when available. |
| `/compact` | Ask Codex to compact the current thread context. |
| `/usage` | Show usage/status information when available. |
| `/diagnostics` | Show redacted local diagnostics. |

Sample output (paths and ids are redacted before they reach IM):

```text
Status:
target: telegram:<REDACTED_CHAT_ID>
binding: bound
project: my-project
thread: <REDACTED_THREAD_ID>
title: API refactor
active turn: none
pending approvals: 0
Codex remote control: disabled
```

```text
Diagnostics:
target: telegram:<REDACTED_CHAT_ID>
binding: bound
runtime: available
pending approvals: 0
computer use: disabled
cwd: <project alias only, never the absolute path>
cwd alias: my-project
thread: <REDACTED_THREAD_ID>
active turn: none
capabilities: <model-provider summary>
mcp servers: 0
```

## Codex Capabilities

| Command | Use |
|---|---|
| `/tools` | List available tool surfaces. |
| `/skills` | List available Codex skills. |
| `/plugins` | List available plugins. |
| `/apps` | List available apps/connectors. |
| `/mcp` | Show MCP server status. |
| `/mcp login <server>` | Start MCP login when Codex App Server supports it. |
| `/mcp reload` | Reload MCP server configuration. |

Outputs are summaries. Raw tool arguments, secrets, cookies, tokens, and private
payloads are redacted or suppressed.

## Output Detail

Customer installs default to:

```toml
[im]
native_thread_visibility = "project_limited"

[im.output]
mode = "normal"
```

`native_thread_visibility = "project_limited"` means native Codex conversations
are visible only when their cwd belongs to a configured project available to the
IM actor. `personal` is an explicit opt-in for a private single-user bot; it
allows allowlisted IM actors to view and switch all local Codex App
conversations on this Mac.

Normal mode keeps ordinary chat clean:

- assistant answer text is shown;
- local absolute paths are redacted, for example `/Users/alice/projects/web`
  becomes `<project:web>`;
- Codex status, token usage, internal command items, and automatic command-log
  attachments stay hidden.

Maintainers can opt into `"verbose"` or `"debug"` in local config while
diagnosing a bridge issue. Do not ask customers to run in debug mode unless you
need a targeted diagnostic capture.

## Approvals

Approval cards/buttons are the primary approval path.

Use a button such as `Allow once`, `Allow session`, or `Decline` when the IM
platform supports it.

| Command | Use |
|---|---|
| `/approvals` | List currently pending approvals visible to this IM chat. |
| `/approve <id> <action>` | Text fallback for an already-visible pending approval (`allow_once`, `allow_session`, `decline`, `abort`). |

`/approve` is not a raw callback-token interface and cannot approve arbitrary
work; it only resolves approvals already bound to this IM chat.

## Files And Images

Supported IM platforms can send and receive files or images.

- Outbound Codex artifacts may appear as IM files or images.
- Inbound images are passed to Codex as local image input where the App Server
  supports it.
- Inbound generic files are represented as explicit local file context because
  current Codex App Server input has no generic `UserInput.file` shape.
- Oversized attachments fail closed before a Codex turn starts.

## Computer Use

Computer Use is explicit.

```text
/cu status
/cu inspect the local browser page
```

Current accepted scope:

- macOS only;
- Google Chrome only;
- bounded local file or localhost page behavior;
- policy, audit, active-session, and allowed-tool gates;
- screenshots/artifacts can be summarized or attached when present.

Not supported as a launch claim:

- arbitrary desktop automation;
- entering secrets, tokens, passwords, payment, or recovery codes;
- controlling external websites without a reviewed gate;
- triggering Computer Use from a normal prompt without `/cu`.
