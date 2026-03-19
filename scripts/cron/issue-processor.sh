#!/bin/bash
#
# 자율 이슈 처리 시스템 v2 — KST 09:00~02:00 매 정시 실행 (18회/일)
#
# Step 1: 미처리 이슈 처리 → Claude Code CLI → PR 생성 → Discord 스레드 자동 생성
# Step 2: 열린 PR 피드백/승인 스캔 → Claude Code CLI 피드백 반영 또는 squash merge
# Step 3: 완료된 PR (MERGED/CLOSED) 매핑 정리
#
# CEO는 Discord PR 채널에서:
#   - 자유 텍스트 → 다음 루프에서 PR에 자동 반영
#   - "승인" 작성 → 자동 squash merge
#
# Usage:
#   ./scripts/cron/issue-processor.sh
#
# 필수 환경변수:
#   GITHUB_TOKEN 또는 gh auth 상태 — 이슈/PR 조작
#   DISCORD_BOT_TOKEN — Discord Bot Token (양방향 소통)
#   DISCORD_PR_CHANNEL_ID — PR 전용 채널 ID
#   ALLOWED_DISCORD_USER_IDS — 허용된 Discord 사용자 ID 목록 (콤마 구분)

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
trap 'rm -f "$LOCK_FILE"; git checkout main >> "$LOG_FILE" 2>&1 || git checkout --force main >> "$LOG_FILE" 2>&1 || true' EXIT

log "=== 자율 이슈 처리 시작 ==="

# main 브랜치 확인 — 이전 실행이 피처 브랜치에 잔류했을 경우 복귀
ensure_main_branch

# git 최신화 — 다른 프로세스가 만든 브랜치/변경사항 반영
log "▶ git pull"
git pull --rebase origin main >> "$LOG_FILE" 2>&1 || log "git pull 실패 (계속 진행)"

# 메인 스크립트 실행 (loopOrchestrator — Step 1~3)
if npx tsx src/issue-processor/loopOrchestrator.ts >> "$LOG_FILE" 2>&1; then
  log "=== 자율 이슈 처리 완료 ==="
  log "▶ main 브랜치 복귀"
  git checkout main >> "$LOG_FILE" 2>&1 || log "[WARN] main 복귀 실패 — trap에서 재시도"
else
  log "✗ 자율 이슈 처리 실패"
  send_error "issue-processor 실패" "이슈 처리"
  exit 1
fi
