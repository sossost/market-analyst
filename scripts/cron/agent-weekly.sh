#!/bin/bash
#
# 주간 에이전트 + CEO 리포트 — GitHub Actions agent-weekly.yml 대체
#
# Usage:
#   ./scripts/cron/agent-weekly.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$LOG_DIR/agent-weekly-$(date +%Y-%m-%d).log"

mkdir -p "$LOG_DIR"

# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

cd "$PROJECT_DIR"
load_env "$PROJECT_DIR/.env"

# 브랜치 가드 — issue-processor 잔류 방어
ensure_main_branch

log "=== 주간 에이전트 시작 ==="

# 1. 주간 에이전트
log "▶ Run Weekly Agent"
if npx tsx src/agent/run-weekly-agent.ts >> "$LOG_FILE" 2>&1; then
  log "✓ 주간 에이전트 완료"
else
  log "✗ 주간 에이전트 실패"
  send_error "run-weekly-agent.ts 실패" "주간"
  exit 1
fi

# 2. CEO 주간 리포트 (실패해도 종료하지 않음)
log "▶ Generate CEO Report"
if npx tsx src/etl/jobs/generate-ceo-report.ts >> "$LOG_FILE" 2>&1; then
  log "✓ CEO 리포트 완료"
else
  log "✗ CEO 리포트 실패"
  send_error "generate-ceo-report.ts 실패" "주간"
fi

# 3. 주간 리포트 품질 검증 (비블로킹 — 실패해도 종료하지 않음)
log "▶ 주간 리포트 품질 검증"
if "$SCRIPT_DIR/validate-weekly-report.sh" >> "$LOG_FILE" 2>&1; then
  log "✓ 주간 리포트 검증 완료"
else
  log "✗ 주간 리포트 검증 실패 (파이프라인 계속 진행)"
fi

# 4. 펀더멘탈 리포트 검증 (비블로킹)
log "▶ 펀더멘탈 리포트 품질 검증"
if "$SCRIPT_DIR/validate-fundamental-report.sh" >> "$LOG_FILE" 2>&1; then
  log "✓ 펀더멘탈 리포트 검증 완료"
else
  log "✗ 펀더멘탈 리포트 검증 실패 (비블로킹 — 계속 진행)"
fi

log "=== 주간 에이전트 완료 ==="
