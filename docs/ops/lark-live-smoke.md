# Lark Live Smoke

The live Lark smoke is explicit and opt-in. Default test and CI paths do not
call Lark.

Run the deterministic fake smoke:

```bash
pnpm smoke:lark-fake
```

Check live-smoke readiness without network:

```bash
LARK_LIVE=1 \
LARK_LIVE_DRY_RUN=1 \
LARK_APP_ID=cli_xxx \
LARK_APP_SECRET_ENV=LARK_APP_SECRET \
LARK_APP_SECRET=secret-value \
LARK_TARGET_CHAT_ID=oc_xxx \
pnpm smoke:lark-live
```

Run the live send only with explicit env:

```bash
LARK_LIVE=1 \
LARK_APP_ID=cli_xxx \
LARK_APP_SECRET_ENV=LARK_APP_SECRET \
LARK_APP_SECRET=secret-value \
LARK_TARGET_CHAT_ID=oc_xxx \
pnpm smoke:lark-live
```

The command prints only redacted presence/status fields. It must not print app
secrets, tenant/access tokens, verification tokens, encrypt keys, cookies, app
ids, chat ids, or message ids.
