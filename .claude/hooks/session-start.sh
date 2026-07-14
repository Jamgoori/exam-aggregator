#!/bin/bash
set -euo pipefail

# Only on Claude Code web/remote sessions — not local dev machines.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Install/refresh the caveman plugin (idempotent — installer skips if already
# installed, no-op unless --force). Never fail session start on install issues.
curl -fsSL https://raw.githubusercontent.com/JuliusBrussee/caveman/main/install.sh | bash -s -- --non-interactive || true
