#!/bin/bash
#
# 일간 ETL 파이프라인 — GitHub Actions etl-daily.yml 대체
#
# 실행 순서 (의존 관계 반영):
#   Phase 1: load-daily-prices
#   Phase 2: build-daily-ma, build-rs, calculate-daily-ratios (병렬)
#   Phase 3: build-breakout-signals, build-noise-signals, build-stock-phases (병렬)
#   Phase 3.5: build-sector-rs, build-industry-rs, record-signals, update-signal-returns
#   Phase 4: validate-data → run-daily-agent
#
# Usage:
#   ./scripts/cron/etl-daily.sh
#   ETL_SKIP_AGENT=1 ./scripts/cron/etl-daily.sh  # 에이전트 실행 건너뛰기

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$LOG_DIR/etl-daily-$(date +%Y-%m-%d).log"

mkdir -p "$LOG_DIR"

# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

cd "$PROJECT_DIR"
load_env "$PROJECT_DIR/.env"

log "=== 일간 ETL 파이프라인 시작 ==="

# Phase 1
run_step "Load Daily Prices" "src/etl/jobs/load-daily-prices.ts"

# Phase 2 (병렬)
run_parallel \
  "Build Daily MA" "src/etl/jobs/build-daily-ma.ts" \
  "Build RS" "src/etl/jobs/build-rs.ts" \
  "Calculate Ratios" "src/etl/jobs/calculate-daily-ratios.ts"

# Phase 3 (병렬 — MA + RS 완료 후)
run_parallel \
  "Build Breakout Signals" "src/etl/jobs/build-breakout-signals.ts" \
  "Build Noise Signals" "src/etl/jobs/build-noise-signals.ts" \
  "Build Stock Phases" "src/etl/jobs/build-stock-phases.ts"

# Phase 3.5 (stock_phases 완료 후)
run_parallel \
  "Build Sector RS" "src/etl/jobs/build-sector-rs.ts" \
  "Build Industry RS" "src/etl/jobs/build-industry-rs.ts" \
  "Record Signals" "src/etl/jobs/record-new-signals.ts" \
  "Update Signal Returns" "src/etl/jobs/update-signal-returns.ts"

# Phase 4
run_step "Validate Data" "src/etl/jobs/validate-data.ts"

if [ "${ETL_SKIP_AGENT:-}" != "1" ]; then
  run_step "Run Daily Agent" "src/agent/run-daily-agent.ts"
fi

log "=== ETL 파이프라인 완료 ==="
