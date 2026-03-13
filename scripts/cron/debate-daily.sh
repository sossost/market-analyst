#!/bin/bash
#
# 일간 토론 에이전트 — GitHub Actions debate-daily.yml 대체
#
# Usage:
#   ./scripts/cron/debate-daily.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$LOG_DIR/debate-daily-$(date +%Y-%m-%d).log"

mkdir -p "$LOG_DIR"

# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

cd "$PROJECT_DIR"
load_env "$PROJECT_DIR/.env"

log "=== 토론 에이전트 시작 ==="

if npx tsx src/agent/run-debate-agent.ts >> "$LOG_FILE" 2>&1; then
  log "=== 토론 에이전트 완료 ==="
  log "▶ 투자 브리핑 사후 검증 시작"
  "$SCRIPT_DIR/validate-debate-report.sh" || log "✗ 사후 검증 실패 (토론 결과에 영향 없음)"
else
  log "✗ 토론 에이전트 실패"
  send_error "run-debate-agent.ts 실패" "토론"
  exit 1
fi
