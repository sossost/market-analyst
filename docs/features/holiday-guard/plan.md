# 미장 휴일 감지 — ETL 파이프라인 자동 스킵

## 선행 맥락

`memory/chief-of-staff.md`에서 관련 교훈 확인:
> "시장 데이터 관련 판단 시 해당일이 거래일인지 먼저 확인. 추론하기 전에 팩트부터."

기존 코드에서 활용 가능한 인프라:
- `src/etl/utils/date-helpers.ts` — `getLatestPriceDate()`: `daily_prices` 테이블에서 최신 날짜를 DB 조회로 반환. **이 함수를 활용하면 추가 FMP API 호출 없이 판단 가능.**
- `src/etl/jobs/load-daily-prices.ts` — Phase 1 가격 수집 잡. 성공 후 DB에 오늘 데이터가 있어야 함.
- `scripts/cron/common.sh` — `run_step`, `send_error` 패턴. exit code 기반 흐름 제어.

## 골 정렬

SUPPORT — 직접 알파 기여는 아니나, 무의미한 Claude API 소비·오염 리포트 방지는 파이프라인 건전성 유지에 필수.

## 문제

ETL 파이프라인(`scripts/cron/etl-daily.sh`)이 화~토 07:00에 무조건 실행된다.
미장 휴일(Thanksgiving, MLK Day 등)에도 Phase 5(토론 에이전트) + Phase 6(일간보고서)가 실행되어 Claude API 토큰을 낭비하고 CEO에게 의미 없는 리포트를 발송한다.

## Before → After

**Before**
```
etl-daily.sh 실행
→ Phase 1: load-daily-prices (휴일 → FMP가 전날 데이터 반환, DB에 전날 날짜 기록)
→ Phase 2~4: 모두 실행 (기존 데이터 재처리)
→ Phase 5: 토론 에이전트 실행 → Claude API 낭비
→ Phase 6: 일간보고서 발송 → 전날 데이터 기반 중복 리포트
```

**After**
```
etl-daily.sh 실행
→ Phase 1: load-daily-prices + load-index-prices 실행
→ [휴일 감지] check-trading-day.ts 실행
    - DB의 최신 가격 날짜 조회
    - "오늘 날짜(KST 기준 미국 전일)"와 비교
    - 일치하지 않으면 exit code 2 반환 (휴일 스킵 신호)
→ 휴일 판정 시: Discord 알림 + Phase 2 이후 전체 스킵
→ 거래일 판정 시: 기존 Phase 2~6 그대로 실행
```

## 핵심 설계 결정

### 왜 FMP 직접 호출이 아니라 DB 조회인가

FMP `/api/v3/historical-price-full/{symbol}?timeseries=5` 엔드포인트는 휴일에 **전날 데이터를 그대로 반환**한다. 즉, 휴일 당일 응답의 `historical[0].date`는 휴일이 아니라 직전 거래일 날짜다.

Phase 1(`load-daily-prices`)이 이미 이 데이터를 DB에 upsert했으므로, `daily_prices`의 `MAX(date)`를 보면 FMP 추가 호출 없이 동일한 정보를 얻을 수 있다.

### "오늘 날짜" 계산

ETL은 화~토 07:00 KST에 실행된다. 미국 시장 기준:
- 화~금 07:00 KST = 전날(월~목) 미국 시장이 닫힌 이후
- 토 07:00 KST = 금요일 미국 시장이 닫힌 이후

따라서 ETL 실행 시 **기대 거래일 = 한국 날짜 - 1일** (토요일은 -1이면 금요일).
단, 이 계산은 `check-trading-day.ts` 내부에서 처리하지 않는다. 대신:

**더 단순하고 견고한 방법**: Phase 1 실행 직후 DB의 `MAX(date)`를 "어제(UTC-5 기준)"와 비교한다.

구체적 로직:
```
미국 동부 시간 = KST - 14시간
ETL 실행 시점(KST 07:00) = 미국 전날 17:00 (장 마감 후)
기대 거래일 = 미국 동부 기준 어제 날짜
```

단, **주말 처리**: 토요일 KST 07:00이면 미국 동부 금요일 17:00 → 기대 거래일 = 금요일.
일요일은 etl-daily.sh가 실행되지 않으므로 고려 불필요.

**최종 판단 방식** (가장 안전한 접근):

"기대 날짜 계산" 없이, Phase 1 이전의 `MAX(date)`와 Phase 1 이후의 `MAX(date)`를 비교한다. **새 날짜가 추가되었으면 거래일, 그대로면 휴일.** 이것이 가장 신뢰도 높고 추론 오류가 없다.

그러나 이를 위해서는 Phase 1 이전에 DB를 조회해야 한다. 구현 복잡도가 증가한다.

**채택 방식**: 단순성 우선. Phase 1 완료 후 DB `MAX(date)`를 가져와서 **오늘로부터 N일 이내인지** 확인한다. 구체적으로:
- 현재 UTC 시각 기준 "미국 동부 시간의 오늘/어제"를 계산
- `MAX(date)`가 해당 날짜 범위 내 (최근 3 거래일 이내)인지가 아니라
- `MAX(date)`가 **현재 UTC 날짜 - 1일 이상 차이나면** 휴일로 판정

가장 단순하고 오판 가능성이 낮은 기준:
```
if (MAX(date) < today_utc - 1 day):
  휴일 → 스킵
```

단, ETL이 토요일 실행 시 금요일 데이터를 가져오므로:
```
today_utc - MAX(date) <= 1 거래일 허용 범위
```

**최종 채택 (확정)**: 날짜 계산 로직을 `check-trading-day.ts`에 캡슐화하여 단위 테스트 가능하게 만든다.

```typescript
// 판단 로직
const latestDate = await getLatestPriceDate(); // DB MAX(date)
const expectedDate = getExpectedTradingDate();  // 오늘 UTC 날짜 기준 계산

if (latestDate !== expectedDate) {
  // 휴일 → exit 2
}
```

`getExpectedTradingDate()`:
- UTC 현재 시각 → 미국 동부(ET) 날짜로 변환 (UTC-5 고정, DST 미적용 단순화)
- ET 기준 오늘이 토요일이면 금요일 반환, 일요일이면 금요일 반환
- ET 기준 월~금 평일이면 **오늘 날짜 반환** (ETL은 장 마감 후 실행되므로 오늘 데이터가 DB에 있어야 함)

**DST 처리**: 복잡도 대비 효과가 낮다. 미국 DST 전환일에 1시간 오차가 발생할 수 있지만, ETL이 KST 07:00에 실행되므로 ET 기준으로는 16:00~17:00 범위 → 시장 마감 후라서 실질적 문제 없음. UTC-5 고정으로 단순화.

## 변경 사항

### 신규 파일

**`src/etl/jobs/check-trading-day.ts`**
- 역할: Phase 1 완료 직후 실행. 오늘이 거래일인지 판단.
- DB `MAX(daily_prices.date)` 조회
- 기대 거래일 계산 (`getExpectedTradingDate()`)
- 일치하면 exit 0 (거래일)
- 불일치하면 Discord 알림 후 exit 2 (휴일 스킵)
- exit 1은 예외 상황 (DB 오류 등) — 기존 `run_step` 패턴과 호환

**`src/etl/jobs/__tests__/check-trading-day.test.ts`**
- `getExpectedTradingDate()` 단위 테스트
- 월~금, 토요일, 미국 공휴일 전날 시나리오

### 수정 파일

**`scripts/cron/etl-daily.sh`**
- Phase 1 완료 직후 `check-trading-day.ts` 실행 블록 추가
- exit code 2이면 Discord "미장 휴일 감지 — ETL 스킵" 알림 후 정상 종료 (exit 0)
- exit code 1이면 기존 `send_error` 후 exit 1 (파이프라인 실패)

## 작업 계획

### Step 1 — `check-trading-day.ts` 구현 (구현팀)

**파일**: `src/etl/jobs/check-trading-day.ts`

완료 기준:
- `getExpectedTradingDate(nowUtc: Date): string` 함수 export
- 거래일이면 exit 0, 휴일이면 Discord 알림 후 exit 2, DB 오류면 exit 1
- `pool.end()` 항상 호출 (메모리 리크 방지)
- exit 2와 exit 1이 명확히 구분됨

### Step 2 — `check-trading-day.test.ts` 작성 (구현팀)

**파일**: `src/etl/jobs/__tests__/check-trading-day.test.ts`

테스트 시나리오:
```
getExpectedTradingDate() 단위 테스트:
- 월~금(ET 기준) → 해당 날짜 반환 (장 마감 후 실행이므로 오늘 데이터)
- 토(ET 기준) → 금요일 날짜 반환
- 일(ET 기준) → 금요일 날짜 반환 (일요일은 실행 안 되지만 방어적으로)

통합 (DB mock):
- DB MAX(date)가 기대 날짜와 일치 → exit 0
- DB MAX(date)가 기대 날짜보다 하루 이전 → Discord 알림 후 exit 2
- DB에 데이터 없음 (null) → exit 1
```

완료 기준: 80% 이상 커버리지.

### Step 3 — `etl-daily.sh` 수정 (구현팀)

Phase 1과 Phase 2 사이에 다음 블록 삽입:

```bash
# [휴일 감지] Phase 1 완료 후 거래일 여부 확인
log "▶ 거래일 확인"
if npx tsx src/etl/jobs/check-trading-day.ts >> "$LOG_FILE" 2>&1; then
  log "✓ 거래일 확인 — 정상 진행"
else
  EXIT_CODE=$?
  if [ $EXIT_CODE -eq 2 ]; then
    log "○ 미장 휴일 감지 — Phase 2 이후 스킵"
    log "=== ETL 파이프라인 완료 (휴일 스킵) ==="
    exit 0
  else
    log "✗ 거래일 확인 실패 (exit $EXIT_CODE)"
    send_error "check-trading-day.ts 실패" "ETL"
    exit 1
  fi
fi
```

완료 기준:
- 거래일: 기존 흐름 그대로 실행
- 휴일: Phase 2 이후 전체 스킵, 정상 종료 (exit 0)
- DB 오류: send_error 후 exit 1

## 리스크

### DST 경계 오판 (낮음)
EDT/EST 전환일(3월 둘째 일요일, 11월 첫째 일요일)에 UTC-5 고정으로 1시간 오차. ETL이 KST 07:00(=UTC-5 기준 16:00~17:00)에 실행되므로 오판 가능성 낮음. 허용.

### FMP API 지연 (낮음)
Phase 1이 완료되었지만 일부 종목만 수집된 경우, `MAX(date)`가 오늘 날짜일 수도 있어 거래일로 판정. 이 경우는 Phase 2 이후가 실행되어도 문제없음 (정상 거래일 시나리오).

### `getLatestPriceDate()`의 TARGET_DATE 오버라이드 (주의)
`date-helpers.ts`의 `getLatestPriceDate()`는 `TARGET_DATE` env var을 우선한다. `check-trading-day.ts`는 이 함수를 **사용하지 않고** 직접 `MAX(date)` SQL을 실행한다. 백필 실행 시 오판 방지.

## 의사결정 필요

없음 — 바로 구현 가능.
