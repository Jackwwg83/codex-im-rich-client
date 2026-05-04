# DingTalk Live Smoke

The live DingTalk smoke is explicit and opt-in. Default test and CI paths do
not call DingTalk or require DingTalk credentials.

Run the deterministic fake smoke:

```bash
pnpm smoke:dingtalk-fake
```

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

Rollback is process-local: interrupt the command with Ctrl-C or wait for the
bounded duration to finish. The harness reads credentials from environment
variables only, does not write plist/Keychain/SQLite state, and prints only
redacted presence/status fields. It must not print client secrets, access
tokens, session webhooks, cookies, client ids, user ids, chat ids, message ids,
or callback payloads.
