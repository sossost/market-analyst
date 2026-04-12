#!/bin/bash
#
# 자동 PR 리뷰어 — 매 정시 :30분 실행 (KST 09:30~02:30)
#
# 이슈 프로세서(:00)가 생성한 PR을 자동으로 검토하고
# Strategic + Code 리뷰 결과를 GitHub PR 코멘트로 게시한다.
#
# Usage:
#   ./scripts/cron/pr-reviewer.sh
#
# 필수 환경변수:
#   GITHUB_TOKEN 또는 gh auth 상태 — PR 목록 조회 및 코멘트 작성

set -euo pipefail

# PATH 설정 (launchd 환경에서 homebrew 바이너리 접근)
export PATH="/opt/homebrew/bin:/opt/homebrew/opt/node@20/bin:$PATH"

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
LOG_FILE="$LOG_DIR/pr-reviewer-$(date +%Y-%m-%d).log"
TIMEOUT_SEC=3600  # 60분 (PR당 최대 30분 × 2건)

mkdir -p "$LOG_DIR"

# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

cd "$PROJECT_DIR"
load_env "$PROJECT_DIR/.env"

# 브랜치 가드 — 피처 브랜치 잔류 방어
ensure_main_branch

# 동시 실행 방지
LOCK_FILE="/tmp/market-analyst-pr-reviewer.lock"
if [ -f "$LOCK_FILE" ] && kill -0 "$(cat "$LOCK_FILE")" 2>/dev/null; then
  log "이미 실행 중 (PID: $(cat "$LOCK_FILE")). 종료."
  exit 0
fi
echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

log "=== 자동 PR 리뷰어 시작 ==="

# git 최신화
log "▶ git pull"
git pull --rebase origin main >> "$LOG_FILE" 2>&1 || log "git pull 실패 (계속 진행)"

# PR 리뷰 실행
log "▶ PR 리뷰 실행 (타임아웃: ${TIMEOUT_SEC}초)"

if $TIMEOUT_CMD "$TIMEOUT_SEC" npx tsx "$PROJECT_DIR/src/pr-reviewer/index.ts" >> "$LOG_FILE" 2>&1; then
  log "✓ PR 리뷰 완료"
else
  EXIT_CODE=$?
  if [ "$EXIT_CODE" -eq 124 ]; then
    log "✗ 타임아웃 (${TIMEOUT_SEC}초 초과)"
    send_error "PR 리뷰 타임아웃 (${TIMEOUT_SEC}초)" "PR 리뷰어"
  else
    log "✗ PR 리뷰 실패 (exit: $EXIT_CODE)"
    send_error "PR 리뷰 실패 (exit: $EXIT_CODE)" "PR 리뷰어"
  fi
  exit 1
fi

log "=== 자동 PR 리뷰어 완료 ==="
