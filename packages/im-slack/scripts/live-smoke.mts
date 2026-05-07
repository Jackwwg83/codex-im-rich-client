#!/usr/bin/env -S pnpm exec tsx

import { runSlackLiveSmokeCore } from "../src/live-smoke.js";

const result = await runSlackLiveSmokeCore();
if (result.status === "blocked") {
  process.exitCode = 2;
}
