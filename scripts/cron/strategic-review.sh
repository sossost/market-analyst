#!/bin/bash
#
# 전략 참모 자동 리뷰 — KST 06:00 매일 실행
#
# 6개 리뷰어가 코드/DB를 분석하여 전략 인사이트를 생성하고 GitHub 이슈로 자동 발행.
# Debate Daily(07:00)보다 1시간 먼저 실행하여 당일 이슈가 issue-processor(10:00~)에서 처리 가능하도록.
#
# Usage:
#   ./scripts/cron/strategic-review.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$LOG_DIR/strategic-review-$(date +%Y-%m-%d).log"

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

log "=== 전략 참모 자동 리뷰 시작 ==="

# git 최신화
log "▶ git pull"
git pull --rebase origin main >> "$LOG_FILE" 2>&1 || log "git pull 실패 (계속 진행)"

# 메인 스크립트 실행
if npx tsx src/strategic-review/index.ts >> "$LOG_FILE" 2>&1; then
  log "=== 전략 참모 자동 리뷰 완료 ==="
else
  log "✗ 전략 참모 자동 리뷰 실패"
  send_error "strategic-review 실패" "전략 리뷰"
  exit 1
fi
