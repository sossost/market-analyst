#!/bin/bash
#
# 자율 이슈 처리 시스템 — 평일 10:00, 12:00, 14:00, 16:00 KST 하루 4회 실행
#
# 미처리 이슈를 자율 점검하여 Claude Code CLI로 구현 → PR 생성.
# CEO는 PR 리뷰 + 머지 결정만.
#
# Usage:
#   ./scripts/cron/issue-processor.sh
#
# 필수 환경변수:
#   GITHUB_TOKEN 또는 gh auth 상태 — 이슈/PR 조작

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$LOG_DIR/issue-processor-$(date +%Y-%m-%d).log"

mkdir -p "$LOG_DIR"

# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

cd "$PROJECT_DIR"
load_env "$PROJECT_DIR/.env"

# 동시 실행 방지 — 이전 사이클이 아직 실행 중이면 스킵
LOCK_FILE="/tmp/market-analyst-issue-processor.lock"
if [ -f "$LOCK_FILE" ] && kill -0 "$(cat "$LOCK_FILE")" 2>/dev/null; then
  log "이미 실행 중 (PID: $(cat "$LOCK_FILE")). 종료."
  exit 0
fi
echo $$ > "$LOCK_FILE"
# 락 파일 제거 + main 브랜치 복귀를 함께 보장
trap 'rm -f "$LOCK_FILE"; git checkout main >> "$LOG_FILE" 2>&1 || true' EXIT

log "=== 자율 이슈 처리 시작 ==="

# main 브랜치 확인 — 이전 실행이 피처 브랜치에 잔류했을 경우 복귀
ensure_main_branch

# git 최신화 — 다른 프로세스가 만든 브랜치/변경사항 반영
log "▶ git pull"
git pull --rebase origin main >> "$LOG_FILE" 2>&1 || log "git pull 실패 (계속 진행)"

# 메인 스크립트 실행
if npx tsx src/issue-processor/index.ts >> "$LOG_FILE" 2>&1; then
  log "=== 자율 이슈 처리 완료 ==="
  log "▶ main 브랜치 복귀"
  git checkout main >> "$LOG_FILE" 2>&1 || log "[WARN] main 복귀 실패 — trap에서 재시도"
else
  log "✗ 자율 이슈 처리 실패"
  send_error "issue-processor 실패" "이슈 처리"
  exit 1
fi
