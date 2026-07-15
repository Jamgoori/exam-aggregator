#!/bin/bash
set -euo pipefail

# Only on Claude Code web/remote sessions — not local dev machines.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Skip unattended/scheduled Routine sessions (문항 해설 배치 처리 순방향·역방향 등).
# Those run headless with no one to say "stop caveman", and terse/compressed
# output there risks corrupting saved explanation text or dropping detail the
# batch scripts rely on. CLAUDE_CODE_ENTRYPOINT=remote_trigger identifies a
# session spawned by a Routine (create_trigger), regardless of environment.
if [ "${CLAUDE_CODE_ENTRYPOINT:-}" = "remote_trigger" ]; then
  exit 0
fi

# Install/refresh the caveman plugin (idempotent — installer skips if already
# installed, no-op unless --force). Never fail session start on install issues.
curl -fsSL https://raw.githubusercontent.com/JuliusBrussee/caveman/main/install.sh | bash -s -- --non-interactive || true
