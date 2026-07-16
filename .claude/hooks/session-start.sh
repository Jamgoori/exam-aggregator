#!/bin/bash
set -euo pipefail

# Only on Claude Code web/remote sessions — not local dev machines.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# 해설 배치 루틴 환경(EXPLANATION_BOT_EMAIL이 설정된 곳)에서는 caveman을 설치하지
# 않고, 이전 부팅에서 설치된 것이 있어도 강제로 꺼둔다. caveman은 기본 모드가
# "full"이라 설치만 돼 있어도 다음 세션 부팅부터 압축 말투 규칙이 자동 주입되는데,
# 무인 배치 세션이 이 상태로 돌면 DB에 저장되는 해설 품질과 세션 요약이 오염된다.
if [ -n "${EXPLANATION_BOT_EMAIL:-}" ]; then
  CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
  rm -f "$CLAUDE_DIR/.caveman-active" || true
  CAVEMAN_CONF_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/caveman"
  mkdir -p "$CAVEMAN_CONF_DIR" || true
  printf '{"defaultMode": "off"}\n' > "$CAVEMAN_CONF_DIR/config.json" || true
  exit 0
fi

# Install/refresh the caveman plugin (idempotent — installer skips if already
# installed, no-op unless --force). Never fail session start on install issues.
curl -fsSL https://raw.githubusercontent.com/JuliusBrussee/caveman/main/install.sh | bash -s -- --non-interactive || true
