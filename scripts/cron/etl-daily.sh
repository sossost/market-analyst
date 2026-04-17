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
run_step_optional "Collect Credit Indicators" "src/etl/jobs/collect-credit-indicators.ts"

# [휴일 감지] Phase 1 완료 후 거래일 여부 확인
log "▶ 거래일 확인"
set +e
npx tsx src/etl/jobs/check-trading-day.ts >> "$LOG_FILE" 2>&1
TRADING_DAY_EXIT=$?
set -e

if [ $TRADING_DAY_EXIT -eq 0 ]; then
  log "✓ 거래일 확인 — 정상 진행"
elif [ $TRADING_DAY_EXIT -eq 2 ]; then
  log "○ 미장 휴일 감지 — Phase 2 이후 스킵"
  log "=== ETL 파이프라인 완료 (휴일 스킵) ==="
  exit 0
else
  log "✗ 거래일 확인 실패 (exit $TRADING_DAY_EXIT)"
  send_error "check-trading-day.ts 실패" "ETL"
  exit 1
fi

# Phase 2 (병렬)
run_parallel \
  "Build Daily MA" "src/etl/jobs/build-daily-ma.ts" \
  "Build RS" "src/etl/jobs/build-rs.ts" \
  "Calculate Ratios" "src/etl/jobs/calculate-daily-ratios.ts"

# Phase 3 (순차 — 각 쿼리가 무거워 병렬 시 커넥션 풀 경쟁으로 타임아웃 발생)
run_step "Build Breakout Signals" "src/etl/jobs/build-breakout-signals.ts"
run_step "Build Noise Signals" "src/etl/jobs/build-noise-signals.ts"
run_step "Build Stock Phases" "src/etl/jobs/build-stock-phases.ts"
run_step "Build Market Breadth" "src/etl/jobs/build-market-breadth.ts"

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

# Phase 3.8 — tracked_stocks 통합 ETL (#773)
# update-recommendation-status, update-watchlist-tracking → update-tracked-stocks로 통합
# scan-thesis-aligned-candidates: thesis 수혜주 Phase 2 진입 시 자동 등록
run_step "Update Tracked Stocks" "src/etl/jobs/update-tracked-stocks.ts"
run_step "Scan Recommendation Candidates" "src/etl/jobs/scan-recommendation-candidates.ts"
run_step_optional "Sync Narrative Beneficiaries" "src/etl/jobs/sync-narrative-beneficiaries.ts"
run_step_optional "Scan Thesis Aligned Candidates" "src/etl/jobs/scan-thesis-aligned-candidates.ts"

# Phase 3.9 (종목 촉매 데이터 — stock_phases 완료 후 실행하여 오늘의 Phase 2 기준 일치)
# 순차 실행: 3개 잡이 동시에 FMP API를 호출하면 rate limit(429)에 걸림
run_step_optional "Load Earning Calendar" "src/etl/jobs/load-earning-calendar.ts"
run_step_optional "Load Stock News" "src/etl/jobs/load-stock-news.ts"
run_step_optional "Load Earnings Surprises FMP" "src/etl/jobs/load-earnings-surprises-fmp.ts"

# Phase 4
run_step "Validate Data" "src/etl/jobs/validate-data.ts"

if [ "${ETL_SKIP_AGENT:-}" != "1" ]; then
  # Phase 5: 토론 (재시도 포함 — 일시적 인증 실패 대응)
  DEBATE_MAX_RETRIES=2
  DEBATE_RETRY_DELAY=180
  TOTAL_ATTEMPTS=$((DEBATE_MAX_RETRIES + 1))
  debate_success=0

  for attempt in $(seq 1 $TOTAL_ATTEMPTS); do
    log "▶ 토론 에이전트 시도 ${attempt}/$TOTAL_ATTEMPTS"
    if npx tsx src/agent/run-debate-agent.ts >> "$LOG_FILE" 2>&1; then
      log "✓ 토론 에이전트 완료"
      debate_success=1
      break
    else
      log "✗ 토론 에이전트 실패 (시도 ${attempt}/$TOTAL_ATTEMPTS)"
      if [ "$attempt" -lt $TOTAL_ATTEMPTS ]; then
        log "⏳ ${DEBATE_RETRY_DELAY}초 후 재시도..."
        sleep "$DEBATE_RETRY_DELAY"
      fi
    fi
  done

  if [ "$debate_success" -eq 1 ]; then
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
    log "✗ 토론 에이전트 ${TOTAL_ATTEMPTS}회 시도 모두 실패 — 일간보고서 스킵"
    send_error "토론 에이전트 ${TOTAL_ATTEMPTS}회 시도 실패 — 수동 재실행 필요" "토론"
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
