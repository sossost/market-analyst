#!/bin/bash
#
# 주간 ETL 파이프라인 — 분기 재무 데이터 (주 1회 갱신)
#
# 실행 내용:
#   1. load-quarterly-financials — 손익/현금흐름 (FMP income-statement + cash-flow)
#   2. load-ratios               — 분기 비율 지표 (ROE, PER, EV/EBITDA 등)
#
# 주: 분기 재무는 실적 발표 주기(3개월)이지만 수정·재발표를 반영하기 위해
#     주 1회 전체 갱신한다. 종목 수(~7천) × API 2콜 × PAUSE 150ms ≒ 약 60분 소요.
#
# Usage:
#   ./scripts/cron/etl-weekly.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$LOG_DIR/etl-weekly-$(date +%Y-%m-%d).log"

mkdir -p "$LOG_DIR"

# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

cd "$PROJECT_DIR"
load_env "$PROJECT_DIR/.env"

ensure_main_branch

log "=== 주간 ETL 파이프라인 시작 ==="

run_step "Load Quarterly Financials" "src/etl/jobs/load-quarterly-financials.ts"
run_step "Load Ratios"               "src/etl/jobs/load-ratios.ts"

log "=== 주간 ETL 파이프라인 완료 ==="
