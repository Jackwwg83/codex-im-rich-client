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

## Project And Conversation Control

| Command | Use |
|---|---|
| `/projects` | List Codex projects available to this IM chat. |
| `/cwds` | Technical alias for `/projects`; output does not show local paths. |
| `/use <number-or-name>` | Select a project for the current IM target. |
| `/new [number-or-name] [task]` | Start a new Codex conversation in the selected/specified project, or in Codex default when no project is selected; optional task starts the first turn. |
| `/threads` | List recent native Codex App Server conversations, including conversations created from Codex App or CLI. |
| `/switch <number-or-thread-prefix>` | Resume and bind this IM chat to a listed native Codex conversation. |
| `/alias <name>` | Give the current conversation a local title. |
| `/fork` | Fork the current conversation when supported by Codex App Server. |
| `/stop` | Interrupt the active turn. |

## Status And Diagnostics

Local lifecycle commands:

```bash
pnpm codex-im:status
pnpm codex-im:upgrade --check
pnpm codex-im:upgrade --plan
pnpm codex-im:upgrade --apply --dry-run
```

`codex-im:status` is local-only by default. `upgrade --check` may contact the
git remote and refresh `~/.codex-im-bridge/update-check.json`; the cache is
advisory and never contains IM secrets.

| Command | Use |
|---|---|
| `/status` | Redacted daemon, binding, and pending-approval status. |
| `/whoami` | Show the IM identity and allowlist target seen by Codex-IM. |
| `/model` | Show or control the Codex model surface when available. |
| `/compact` | Ask Codex to compact the current thread context. |
| `/usage` | Show usage/status information when available. |
| `/diagnostics` | Show redacted local diagnostics. |

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

## Approvals

Approval cards/buttons are the primary approval path.

Use a button such as `Allow once`, `Allow session`, or `Decline` when the IM
platform supports it.

Fallback command:

```text
/approve <id> <action>
```

Use `/approve` only for an already-visible pending approval. It is not a raw
callback-token interface and cannot approve arbitrary work.

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
