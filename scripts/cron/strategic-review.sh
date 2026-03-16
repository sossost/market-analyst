#!/bin/bash
#
# 전략 참모 자동 리뷰 — 매일 KST 04:00 실행
#
# Claude Code CLI가 프로젝트를 자율적으로 분석하고,
# 전략적 인사이트를 GitHub 이슈로 생성한다.
#
# Usage:
#   ./scripts/cron/strategic-review.sh
#
# 필수 환경변수:
#   GITHUB_TOKEN 또는 gh auth 상태 — 이슈 조회/생성

set -euo pipefail

# macOS 호환: GNU timeout
if command -v timeout >/dev/null 2>&1; then
  TIMEOUT_CMD="timeout"
elif command -v gtimeout >/dev/null 2>&1; then
  TIMEOUT_CMD="gtimeout"
else
  echo "ERROR: timeout 또는 gtimeout 필요. brew install coreutils" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$LOG_DIR/strategic-review-$(date +%Y-%m-%d).log"
PROMPT_FILE="$PROJECT_DIR/scripts/strategic-review-prompt.md"
TIMEOUT_SEC=1800  # 30분

mkdir -p "$LOG_DIR"

# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

cd "$PROJECT_DIR"
load_env "$PROJECT_DIR/.env"

# 동시 실행 방지
LOCK_FILE="/tmp/market-analyst-strategic-review.lock"
if [ -f "$LOCK_FILE" ] && kill -0 "$(cat "$LOCK_FILE")" 2>/dev/null; then
  log "이미 실행 중 (PID: $(cat "$LOCK_FILE")). 종료."
  exit 0
fi
echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

log "=== 전략 참모 리뷰 시작 ==="

# git 최신화
log "▶ git pull"
git pull --rebase origin main >> "$LOG_FILE" 2>&1 || log "git pull 실패 (계속 진행)"

# 프롬프트 파일 확인
if [ ! -f "$PROMPT_FILE" ]; then
  log "✗ 프롬프트 파일 없음: $PROMPT_FILE"
  send_error "프롬프트 파일 없음" "전략 리뷰"
  exit 1
fi

# Claude Code CLI 실행 — stdin으로 프롬프트 전달
log "▶ Claude Code CLI 실행 (타임아웃: ${TIMEOUT_SEC}초)"

if $TIMEOUT_CMD "$TIMEOUT_SEC" cat "$PROMPT_FILE" | run_claude_p claude -p --dangerously-skip-permissions --output-format text >> "$LOG_FILE" 2>&1; then
  log "✓ 전략 리뷰 완료"
else
  EXIT_CODE=$?
  if [ "$EXIT_CODE" -eq 124 ]; then
    log "✗ 타임아웃 (${TIMEOUT_SEC}초 초과)"
    send_error "전략 리뷰 타임아웃 (${TIMEOUT_SEC}초)" "전략 리뷰"
  else
    log "✗ Claude CLI 실행 실패 (exit: $EXIT_CODE)"
    send_error "Claude CLI 실패 (exit: $EXIT_CODE)" "전략 리뷰"
  fi
  exit 1
fi

log "=== 전략 참모 리뷰 완료 ==="
