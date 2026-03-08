#!/bin/bash
#
# 뉴스 수집 — 6시간 간격 실행
#
# KST 00:00, 06:00, 12:00, 18:00 (= UTC 15:00, 21:00, 03:00, 09:00)
#
# Usage:
#   ./scripts/cron/news-collect.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$LOG_DIR/news-collect-$(date +%Y-%m-%d).log"

mkdir -p "$LOG_DIR"

# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

cd "$PROJECT_DIR"
load_env "$PROJECT_DIR/.env"

log "=== 뉴스 수집 시작 ==="

run_step "Collect News" "src/etl/jobs/collect-news.ts"

log "=== 뉴스 수집 완료 ==="
