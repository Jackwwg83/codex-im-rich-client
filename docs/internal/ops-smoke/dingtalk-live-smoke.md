# DingTalk Live Smoke

The live DingTalk smoke is explicit and opt-in. Default test and CI paths do
not call DingTalk or require DingTalk credentials.

Run the deterministic fake smoke:

```bash
pnpm smoke:dingtalk-fake
```

Check installed direct-use readiness without network or secret output:

```bash
pnpm dingtalk:readiness
```

Exit `0` means installed config has a DingTalk adapter, a non-placeholder
client id, a secret source, a card template id, and DingTalk allowlist entries.
Exit `2` means it is locally blocked; the output names only missing presence
checks, never credential values.

Check live-smoke readiness without network:

```bash
DINGTALK_LIVE=1 \
DINGTALK_LIVE_DRY_RUN=1 \
DINGTALK_CLIENT_ID=ding_xxx \
DINGTALK_CLIENT_SECRET_ENV=DINGTALK_CLIENT_SECRET \
DINGTALK_CLIENT_SECRET=replace_me \
pnpm smoke:dingtalk-live
```

Run the bounded live Stream connection only with explicit env:

```bash
DINGTALK_LIVE=1 \
DINGTALK_CLIENT_ID=ding_xxx \
DINGTALK_CLIENT_SECRET_ENV=DINGTALK_CLIENT_SECRET \
DINGTALK_CLIENT_SECRET=replace_me \
DINGTALK_LIVE_DURATION_MS=5000 \
pnpm smoke:dingtalk-live
```

The command starts `DingTalkChannelAdapter` with the production `DWClient`
wrapper, registers robot-message and card-callback Stream handlers, and
acknowledges received events as platform receipts only. It does not accept
approval decisions; daemon approval settlement remains in the normal callback
token path.

Run the bounded live OpenAPI card send/update only with explicit env:

```bash
DINGTALK_LIVE=1 \
DINGTALK_LIVE_CARD=1 \
DINGTALK_CLIENT_ID=ding_xxx \
DINGTALK_CLIENT_SECRET_ENV=DINGTALK_CLIENT_SECRET \
DINGTALK_CLIENT_SECRET=replace_me \
DINGTALK_CARD_TEMPLATE_ID=replace_me \
DINGTALK_TARGET_CHAT_ID=replace_me \
pnpm smoke:dingtalk-live
```

`DINGTALK_ROBOT_CODE` is optional. If it is omitted, the smoke and production
daemon derive the robot code from `DINGTALK_CLIENT_ID` / `client_id`, matching
the common DingTalk AppKey-as-robotCode setup. Set `DINGTALK_ROBOT_CODE`
explicitly only if the DingTalk app uses a different robot code.

The DingTalk app must have `Card.Instance.Write` open before this can pass.
Without that permission DingTalk returns HTTP 403 at `createAndDeliver`, before
any valid acceptance evidence can be recorded.

For direct-use acceptance, the installed bridge config must also include
DingTalk-specific global and project allowlist entries captured from a real
inbound robot message. Do not guess staff ids or conversation ids.

If the private staff id or group conversation id is not known, capture it from a
real inbound robot message instead:

```bash
DINGTALK_LIVE=1 \
DINGTALK_LIVE_CARD=1 \
DINGTALK_LIVE_CAPTURE_TARGET=1 \
DINGTALK_CLIENT_ID=ding_xxx \
DINGTALK_CLIENT_SECRET_ENV=DINGTALK_CLIENT_SECRET \
DINGTALK_CLIENT_SECRET=replace_me \
DINGTALK_CARD_TEMPLATE_ID=replace_me \
DINGTALK_LIVE_DURATION_MS=30000 \
pnpm smoke:dingtalk-live
```

During that bounded window, send one harmless message to the DingTalk bot from
the real test client. The smoke records only whether the target was captured,
then sends and updates the approval card against that same target.

If the test app has enough contact-read permission, the smoke can discover a
single enterprise `userid` without printing it:

```bash
DINGTALK_LIVE=1 \
DINGTALK_LIVE_CARD=1 \
DINGTALK_LIVE_DISCOVER_USER=1 \
DINGTALK_CLIENT_ID=ding_xxx \
DINGTALK_CLIENT_SECRET_ENV=DINGTALK_CLIENT_SECRET \
DINGTALK_CLIENT_SECRET=replace_me \
DINGTALK_CARD_TEMPLATE_ID=replace_me \
pnpm smoke:dingtalk-live
```

This discovery path is for smoke validation only. Installed direct-use
configuration should still use explicit DingTalk allowlist entries captured
from the real operator/client path before claiming daily-use readiness.

Rollback is process-local: interrupt the command with Ctrl-C or wait for the
bounded duration to finish. The harness reads credentials from environment
variables only, does not write plist/Keychain/SQLite state, and prints only
redacted presence/status fields. It must not print client secrets, access
tokens, session webhooks, cookies, client ids, user ids, chat ids, message ids,
or callback payloads.
