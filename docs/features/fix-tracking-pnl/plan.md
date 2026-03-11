# fix-tracking-pnl

## 선행 맥락

없음. memory/ 검색 결과 트래킹 시스템 관련 선행 실패 기록 없음.

단, 스키마 주석에 이미 의도가 명시돼 있음:
> `recommendations` 테이블 — "현재 상태 (ETL이 매일 업데이트)"

즉, 설계 의도는 정확했으나 ETL 파이프라인에 연결이 누락된 것.

## 골 정렬

ALIGNED — 추천 성과 트래킹은 주도주 포착 알파 검증의 핵심 피드백 루프.
pnl_percent=0이 지속되면 성과 측정 자체가 불가능하여 시스템 신뢰도 훼손.

## 문제

`update-recommendation-status.ts`가 `etl-daily.sh` 파이프라인에 포함되지 않아
ACTIVE 추천 종목의 pnl_percent/max_pnl_percent/days_held가 초기값(0)에서 갱신되지 않는다.

## Before → After

**Before**
- `etl-daily.sh`에 `update-recommendation-status.ts` 스텝이 없음
- `package.json`에 `etl:update-recommendations` 스크립트는 존재하지만 아무도 호출하지 않음
- ACTIVE 추천 7건 전부 pnl_percent=0, days_held=0 (추천 생성 이후 고정)
- 홈 대시보드 성과 카드, 주간 리포트 성과 분석 모두 의미 없는 0% 표시

**After**
- `etl-daily.sh` Phase 3.5 또는 Phase 4 직전에 `update-recommendation-status.ts` 스텝 추가
- 매일 ETL 실행 시 ACTIVE 추천 종목의 현재 종가/Phase/RS 조회 → pnl/maxPnl/daysHeld 갱신
- Phase 2 이탈 시 자동 CLOSED_PHASE_EXIT 처리
- 과거 7건 데이터는 백필 실행으로 복구

## 변경 사항

### 1. `scripts/cron/etl-daily.sh` 수정
- Phase 3.5 블록 직후 (stock_phases/sector-rs 완료 이후) 추가:
  ```
  run_step "Update Recommendation Status" "src/etl/jobs/update-recommendation-status.ts"
  ```
- 위치 근거: `update-recommendation-status.ts`가 `daily_prices`와 `stock_phases`를 JOIN하므로
  두 테이블이 모두 최신화된 Phase 3.5 완료 후가 적절

### 2. 과거 데이터 백필
- 별도 백필 스크립트 없이 `etl:update-recommendations` 스크립트를 로컬에서 1회 수동 실행
- `update-recommendation-status.ts`는 `getLatestTradeDate()`를 기준으로 현재 상태만 갱신하므로
  백필은 "오늘 기준 현재가" 반영으로 충분 (과거 일별 이력 복구는 이슈 범위 밖)

## 작업 계획

### Step 1 — etl-daily.sh에 스텝 추가 (backend-engineer)
- `scripts/cron/etl-daily.sh`에서 Phase 3.6 스텝 직후, Phase 3.7 블록 직전에 삽입
- 정확한 삽입 위치:
  ```
  # Phase 3.6 완료 후
  run_step "Collect Failure Patterns" "src/etl/jobs/collect-failure-patterns.ts"

  # [추가] Phase 3.8: 추천 종목 성과 갱신
  run_step "Update Recommendation Status" "src/etl/jobs/update-recommendation-status.ts"
  ```
- 완료 기준: etl-daily.sh에 해당 라인 추가됨

### Step 2 — 과거 데이터 백필 (backend-engineer)
- 맥미니 서버에서 1회 수동 실행:
  ```
  ssh mini@100.77.162.69 "cd ~/market-analyst && yarn etl:update-recommendations"
  ```
- 완료 기준: ACTIVE 추천 7건의 pnl_percent, days_held가 0이 아닌 값으로 갱신됨

### Step 3 — 검증 (backend-engineer)
- DB 조회로 갱신 여부 확인:
  ```sql
  SELECT symbol, pnl_percent, max_pnl_percent, days_held, last_updated
  FROM recommendations
  WHERE status = 'ACTIVE'
  ORDER BY recommendation_date;
  ```
- 완료 기준: 전체 ACTIVE 종목에 pnl_percent != 0 또는 days_held > 0 확인

## 리스크

- **백필 시 entryPrice=0 종목 스킵**: `update-recommendation-status.ts` 코드에 `if (entryPrice === 0) continue` 가드가 있음. entryPrice가 null이거나 0으로 저장된 종목은 갱신 안 됨. 확인 필요.
- **daily_prices에 해당 심볼 없을 경우**: 상장폐지/OTC 종목은 가격 데이터가 없을 수 있음. 코드에 `if (data == null || data.price === 0) continue` 처리돼 있어 조용히 스킵됨.
- **Phase 판정 영향**: currentPhase != 2이면 자동으로 CLOSED_PHASE_EXIT 처리. 백필 실행 시 이미 Phase가 변한 종목은 자동 종료됨. 의도된 동작이나 사전 확인 권고.

## 의사결정 필요

없음 — 바로 구현 가능.
