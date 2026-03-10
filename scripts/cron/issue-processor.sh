#!/bin/bash
#
# 자율 이슈 처리 시스템 — 평일 09:00~18:00 KST 매 1시간 실행
#
# 열린 이슈를 자율 점검하여:
# - 자율 처리 가능 → Claude Code CLI로 구현 → PR 생성
# - CEO 판단 필요 → 이슈 코멘트로 에스컬레이션
#
# Usage:
#   ./scripts/cron/issue-processor.sh
#
# 필수 환경변수:
#   ANTHROPIC_API_KEY — LLM 트리아지
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

log "=== 자율 이슈 처리 시작 ==="

# git 최신화 — 다른 프로세스가 만든 브랜치/변경사항 반영
log "▶ git pull"
git pull --rebase >> "$LOG_FILE" 2>&1 || log "git pull 실패 (계속 진행)"

# 메인 스크립트 실행
if npx tsx src/issue-processor/index.ts >> "$LOG_FILE" 2>&1; then
  log "=== 자율 이슈 처리 완료 ==="
else
  log "✗ 자율 이슈 처리 실패"
  send_error "issue-processor 실패" "이슈 처리"
  exit 1
fi
