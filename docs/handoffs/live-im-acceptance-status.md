# Live IM Acceptance Status

> Single source of truth for real Telegram/Lark/DingTalk/Codex App live
> acceptance after `production-readiness-2026-05-03-r2`.
> **Last updated:** 2026-05-03 - live acceptance opened; release baseline,
> fake IM smokes, and launchd dry-run are green; no real IM credential is
> currently present in the local environment.

---

## 1. Current State

- **Mode:** Live IM acceptance.
- **Branch:** `codex/live-im-acceptance`.
- **Base release candidate:** `production-readiness-2026-05-03-r2`.
- **Release candidate status:** non-live gates, fake smokes, contract tests,
  outside-voice review, and GitHub Actions CI are green.
- **Live acceptance status:** baseline green; real platform smokes pending.
- **Credential status:** no Telegram/Lark/DingTalk live credential env vars were
  present when this file was created; no `codex-im-bridge` Keychain item was
  present.

## 2. Correct Acceptance Language

Use this wording until live smokes pass:

```text
Release candidate complete; live IM acceptance pending.
```

Do not claim that the product is actually live-validated or production accepted
until the matrix below is complete with real credentials and redacted evidence.

## 3. Live Acceptance Matrix

| Area | Required check | Status | Evidence target |
|---|---|---|---|
| Baseline | `pnpm release:check` | pass | 2026-05-03 local run, exit 0 |
| Telegram fake | `pnpm smoke:telegram-fake` | pass | covered by `pnpm release:check`, exit 0 |
| Telegram live adapter | `TELEGRAM_LIVE=1 IM_TELEGRAM_BOT_TOKEN=... pnpm smoke:telegram-live` | pending | redacted status, no token output |
| Telegram + real Codex | `TELEGRAM_LIVE=1 CODEX_REAL_SMOKE=1 IM_TELEGRAM_BOT_TOKEN=... pnpm smoke:telegram-real` | pending | harmless real turn completes |
| Lark fake | `pnpm smoke:lark-fake` | pass | covered by `pnpm release:check`, exit 0 |
| Lark live dry-run | `LARK_LIVE=1 LARK_LIVE_DRY_RUN=1 ... pnpm smoke:lark-live` | pending | `ready_dry_run`, redacted |
| Lark live send | `LARK_LIVE=1 ... pnpm smoke:lark-live` | pending | message/card sent to test chat |
| DingTalk fake | `pnpm smoke:dingtalk-fake` | pass | covered by `pnpm release:check`, exit 0 |
| DingTalk live dry-run | `DINGTALK_LIVE=1 DINGTALK_LIVE_DRY_RUN=1 ... pnpm smoke:dingtalk-live` | pending | `ready_dry_run`, redacted |
| DingTalk live Stream | `DINGTALK_LIVE=1 ... pnpm smoke:dingtalk-live` | pending | bounded Stream connection completes |
| launchd dry-run | `pnpm launchd:install --dry-run && bash bin/load-and-run.sh --dry-run` | pass | covered by `pnpm release:check`, exit 0 |
| Keychain | `security find-generic-password -s codex-im-bridge -a "$USER"` | pending | presence only, never token bytes |
| launchd live start | `pnpm launchd:install` + `launchctl print ...` | pending | daemon starts under user LaunchAgent |
| Redaction | plist/log grep for token-shaped output | pending | no token-shaped material |

Computer Use remains dry-run readiness only in the current release candidate;
real desktop execution is not part of live IM acceptance until a reviewed real
provider is implemented.

## 4. Passing Criteria

Live IM acceptance is complete only when:

- every enabled real platform smoke completes with real test credentials;
- the Telegram real smoke completes one harmless real Codex turn;
- live output is redacted and does not contain bot tokens, app secrets, access
  tokens, cookies, private chat IDs, or private user IDs;
- launchd/Keychain start path works without token bytes in plist/logs;
- rollback/dry-run commands are known-good;
- Linear/repo handoff records only redacted evidence.

## 5. Stop Conditions

Stop and treat as a blocker if:

- any live command prints token-shaped material;
- a live command runs without its explicit `*_LIVE=1` gate;
- Telegram real smoke cannot complete a harmless Codex turn;
- Lark/DingTalk reports live auth success but cannot perform the documented
  dry-run or live path;
- launchd writes a token into plist/logs;
- daemon exposes a public listener;
- approval/callback decisions bypass broker, policy, callback token, or
  messageRef validation.

## 6. Evidence Log

- 2026-05-03: `pnpm release:check` passed on
  `codex/live-im-acceptance` at base `production-readiness-2026-05-03-r2`.
  Covered typecheck, test, CLI smoke, lint, protocol check, fixture verify,
  launchd install dry-run, load-and-run dry-run, db backup proof,
  Telegram/Lark/DingTalk fake smokes, live default gates, and Computer Use
  default skip.
