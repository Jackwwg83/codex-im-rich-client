# IM Commands

Plain text enters the current bound Codex thread or starts a Codex turn after
you have selected a known local cwd. Slash commands control cwd selection,
native Codex threads, status, approval, and bounded Computer Use behavior.

## First Commands

```text
/cwds
/use 1
Reply exactly: OK
```

`/cwds` lists the known local cwd entries from your daemon config. Choose by
number when possible so you do not need to remember aliases. If the cwd entry
and your IM user/chat are allowlisted, Codex should reply through the same IM
conversation.

You can also create a new thread and start the first turn in one message:

```text
/new 1 Reply exactly: OK
```

Raw paths such as `/Users/me/repo` or `~/repo` are rejected from IM. Add or
change cwd entries locally through setup/config, then select them from `/cwds`.

## Cwd And Thread Control

| Command | Use |
|---|---|
| `/cwds` | List known local cwd entries available to this IM chat. |
| `/projects` | Compatibility alias for `/cwds`. |
| `/use <number-or-alias>` | Select a known cwd for the current IM target. |
| `/new [number-or-alias] [task]` | Start a new Codex thread in the selected or specified known cwd; optional task starts the first turn. |
| `/threads` | List recent native Codex App Server threads, including threads created from Codex App or CLI. |
| `/switch <number-or-thread-prefix>` | Resume and bind this IM chat to a listed native Codex thread. |
| `/alias <name>` | Give the current thread a local alias. |
| `/fork` | Fork the current thread when supported by Codex App Server. |
| `/stop` | Interrupt the active turn. |

## Status And Diagnostics

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
