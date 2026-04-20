#!/bin/bash
#
# 컴포넌트 주간 자가 점검 — 매주 일 KST 06:00 실행
#
# Usage:
#   ./scripts/cron/component-review.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$LOG_DIR/component-review-$(date +%Y-%m-%d).log"

mkdir -p "$LOG_DIR"

# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

cd "$PROJECT_DIR"
load_env "$PROJECT_DIR/.env"
ensure_main_branch

log "=== 컴포넌트 리뷰 시작 ==="

if npx tsx src/scripts/run-component-review.ts >> "$LOG_FILE" 2>&1; then
  log "=== 컴포넌트 리뷰 완료 ==="
else
  log "✗ 컴포넌트 리뷰 실패"
  send_error "run-component-review.ts 실패" "ComponentReview"
  exit 1
fi
