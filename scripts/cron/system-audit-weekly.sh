#!/bin/bash
#
# 주간 시스템 감사 — 토요일 KST 06:00 실행
#
# 데이터 무결성, 코드-DB 정합성, 파이프라인 연결성, 테스트/빌드를 점검하고
# 발견된 문제를 GitHub 이슈로 자동 생성한다.
#
# Usage:
#   ./scripts/cron/system-audit-weekly.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$LOG_DIR/system-audit-$(date +%Y-%m-%d).log"

mkdir -p "$LOG_DIR"

# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

cd "$PROJECT_DIR"
load_env "$PROJECT_DIR/.env"

# 브랜치 가드
ensure_main_branch

# git 최신화
log "▶ git pull"
git pull --rebase origin main >> "$LOG_FILE" 2>&1 || log "git pull 실패 (계속 진행)"

log "=== 주간 시스템 감사 시작 ==="

run_step "시스템 감사" "src/scripts/weekly-system-audit.ts" 0

log "=== 주간 시스템 감사 완료 ==="
