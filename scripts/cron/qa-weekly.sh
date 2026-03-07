#!/bin/bash
#
# 주간 QA 점검 — 매주 토 실행
#
# Usage:
#   ./scripts/cron/qa-weekly.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$LOG_DIR/qa-weekly-$(date +%Y-%m-%d).log"

mkdir -p "$LOG_DIR"

# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

cd "$PROJECT_DIR"
load_env "$PROJECT_DIR/.env"

log "=== 주간 QA 점검 시작 ==="

if npx tsx src/agent/run-weekly-qa.ts >> "$LOG_FILE" 2>&1; then
  log "=== 주간 QA 점검 완료 ==="
else
  log "✗ 주간 QA 점검 실패"
  send_error "run-weekly-qa.ts 실패" "QA"
  exit 1
fi
