#!/bin/bash
#
# 일간 ETL 파이프라인 — GitHub Actions etl-daily.yml 대체
#
# 실행 순서 (의존 관계 반영):
#   Phase 1: load-daily-prices
#   Phase 2: build-daily-ma, build-rs, calculate-daily-ratios (병렬)
#   Phase 3: build-breakout-signals, build-noise-signals, build-stock-phases (순차 — 커넥션 풀 경쟁 방지)
#   Phase 3.5: build-sector-rs, build-industry-rs, record-signals, update-signal-returns
#   Phase 3.6: detect-sector-phase-events, update-sector-lag-patterns
#   Phase 4: validate-data
#   Phase 5: 토론 → promote-learnings → 투자 브리핑 QA (비블로킹)
#   Phase 6: 일간보고서 → 일간보고서 QA
#
# Usage:
#   ./scripts/cron/etl-daily.sh
#   ETL_SKIP_AGENT=1 ./scripts/cron/etl-daily.sh  # 에이전트 전체 스킵

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

# 브랜치 가드 — issue-processor 잔류 방어
ensure_main_branch

log "=== 일간 ETL 파이프라인 시작 ==="

# Phase 1
run_step "Load Daily Prices" "src/etl/jobs/load-daily-prices.ts"
run_step "Load Index Prices" "src/etl/jobs/load-index-prices.ts"

# Phase 2 (병렬)
run_parallel \
  "Build Daily MA" "src/etl/jobs/build-daily-ma.ts" \
  "Build RS" "src/etl/jobs/build-rs.ts" \
  "Calculate Ratios" "src/etl/jobs/calculate-daily-ratios.ts"

# Phase 3 (순차 — 각 쿼리가 무거워 병렬 시 커넥션 풀 경쟁으로 타임아웃 발생)
run_step "Build Breakout Signals" "src/etl/jobs/build-breakout-signals.ts"
run_step "Build Noise Signals" "src/etl/jobs/build-noise-signals.ts"
run_step "Build Stock Phases" "src/etl/jobs/build-stock-phases.ts"

# Phase 3.5 (stock_phases 완료 후)
run_parallel \
  "Build Sector RS" "src/etl/jobs/build-sector-rs.ts" \
  "Build Industry RS" "src/etl/jobs/build-industry-rs.ts" \
  "Record Signals" "src/etl/jobs/record-new-signals.ts" \
  "Update Signal Returns" "src/etl/jobs/update-signal-returns.ts"

# Phase 3.6 (sector-rs, industry-rs 완료 후 — 섹터 시차 패턴)
run_step "Detect Sector Phase Events" "src/etl/jobs/detect-sector-phase-events.ts"
run_step "Update Sector Lag Patterns" "src/etl/jobs/update-sector-lag-patterns.ts"

# Phase 3.7 (signal_log 업데이트 후 — 위양성 추적)
run_step "Track Phase Exits" "src/etl/jobs/track-phase-exits.ts"
run_step "Collect Failure Patterns" "src/etl/jobs/collect-failure-patterns.ts"

# Phase 3.8 (추천 종목 성과 갱신 + 관심종목 Phase 궤적 갱신)
run_step "Update Recommendation Status" "src/etl/jobs/update-recommendation-status.ts"
run_step "Update Watchlist Tracking" "src/etl/jobs/update-watchlist-tracking.ts"

# Phase 3.9 (종목 촉매 데이터 — stock_phases 완료 후 실행하여 오늘의 Phase 2 기준 일치)
# 순차 실행: 3개 잡이 동시에 FMP API를 호출하면 rate limit(429)에 걸림
run_step "Load Earning Calendar" "src/etl/jobs/load-earning-calendar.ts"
run_step "Load Stock News" "src/etl/jobs/load-stock-news.ts"
run_step "Load Earnings Surprises FMP" "src/etl/jobs/load-earnings-surprises-fmp.ts"

# Phase 4
run_step "Validate Data" "src/etl/jobs/validate-data.ts"

if [ "${ETL_SKIP_AGENT:-}" != "1" ]; then
  # Phase 5: 토론 (비블로킹 — 실패해도 일간보고서는 실행)
  log "▶ 토론 에이전트 시작"
  if npx tsx src/agent/run-debate-agent.ts >> "$LOG_FILE" 2>&1; then
    log "✓ 토론 에이전트 완료"

    # promote-learnings (비블로킹)
    log "▶ Promote learnings"
    if yarn etl:promote-learnings >> "$LOG_FILE" 2>&1; then
      log "✓ Learnings 승격 완료"
    else
      log "⚠ Learnings 승격 실패 (비블로킹)"
    fi

    # 투자 브리핑 QA (비블로킹)
    log "▶ 투자 브리핑 QA"
    if "$SCRIPT_DIR/validate-debate-report.sh" >> "$LOG_FILE" 2>&1; then
      log "✓ 투자 브리핑 QA 완료"
    else
      log "⚠ 투자 브리핑 QA 실패 (비블로킹)"
    fi
  else
    log "✗ 토론 에이전트 실패 — 일간보고서도 스킵 (토론 결과 종속)"
    send_error "run-debate-agent.ts 실패 — 일간보고서 스킵" "토론"
    log "=== ETL 파이프라인 완료 (토론 실패로 일간보고서 미실행) ==="
    exit 1
  fi

  # Phase 6: 일간보고서 (토론 성공 시에만 실행)
  run_step "Run Daily Agent" "src/agent/run-daily-agent.ts"

  # 일간보고서 QA (비블로킹)
  log "▶ Daily Report QA"
  if "$SCRIPT_DIR/validate-daily-report.sh" >> "$LOG_FILE" 2>&1; then
    log "✓ Daily Report QA 완료"
  else
    log "⚠ Daily Report QA 실패 (비블로킹)"
  fi
fi

log "=== ETL 파이프라인 완료 ==="
