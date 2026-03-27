#!/bin/bash
#
# 이슈 사전 트리아지 배치 — KST 09:00 1회 실행
#
# 미처리 이슈 전체를 Claude CLI --print 모드로 분석하여
# PROCEED / SKIP / ESCALATE 판정 후 이슈에 코멘트 + 라벨을 남긴다.
# SKIP → auto:blocked, ESCALATE → auto:needs-ceo
# PROCEED → 라벨 없음 (이슈 프로세서 10:00~가 작업)
#
# Usage:
#   ./scripts/cron/triage-issues.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$LOG_DIR/triage-issues-$(date +%Y-%m-%d).log"

mkdir -p "$LOG_DIR"

# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

cd "$PROJECT_DIR"
load_env "$PROJECT_DIR/.env"

log "=== 이슈 사전 트리아지 배치 시작 ==="

if npx tsx src/issue-processor/triageBatch.ts >> "$LOG_FILE" 2>&1; then
  log "=== 이슈 사전 트리아지 배치 완료 ==="
else
  log "✗ 이슈 사전 트리아지 배치 실패"
  send_error "triage-issues 실패" "이슈 트리아지"
  exit 1
fi
