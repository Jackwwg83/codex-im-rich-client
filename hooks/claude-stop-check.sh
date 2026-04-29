#!/usr/bin/env bash
set -euo pipefail

if git diff --quiet && git diff --cached --quiet; then
  echo "No working tree changes."
  exit 0
fi

cat <<'MSG'
Working tree changed. Before ending the session, Claude should report:
- changed files
- tests run and results
- smoke test status, if relevant
- docs updated or why not
- unresolved risks
- next step
MSG
