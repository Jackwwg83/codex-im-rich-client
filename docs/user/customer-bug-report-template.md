# Customer Bug Report Template

Copy this into a new GitHub Issue when reporting an alpha bug. Fields with
`(required)` should be filled in; the rest help if relevant.

> **Do not paste real tokens, app secrets, callback payloads, or full
> daemon logs.** Replace any secret-shaped value with `<REDACTED>` before
> submitting. For security vulnerabilities use the email channel in
> [SECURITY.md](../../SECURITY.md) instead of a public issue.

---

**Alpha version (required):** e.g. `v0.1.0-alpha.6`

**IM platform (required):** Telegram / Feishu / Lark / DingTalk / Slack

**Codex CLI version (required):** output of `codex --version`

**macOS version:** output of `sw_vers -productVersion`

**Node.js version:** output of `node --version`

**pnpm version:** output of `pnpm --version`

**`pnpm codex-im:status` output (required):** paste the redacted output.
Verify no token-shaped value is present before pasting.

```
<paste here>
```

**What I did (required):** the exact commands you ran or IM messages you
sent, in order.

**What I expected:** what the docs / commands.md said should happen.

**What actually happened (required):** the IM reply you received, the
local error output, or the silent-failure description.

**Relevant `daemon.log` lines (optional):** from
`~/.codex-im-bridge/logs/daemon.log`, last 20–40 lines around the failure.
Run them through your own redaction first; tokens, callback tokens,
absolute paths outside the project cwd, and any payload that looks like a
secret should be replaced with `<REDACTED>`.

```
<paste here>
```

**Workaround you tried (optional):** anything you already did that
helped, partially worked, or made things worse.

---

After submitting, please do not re-open closed issues to add more
information — open a new issue and link to the old one. The maintainer is
one person; small focused issues land faster than long re-opened threads.
