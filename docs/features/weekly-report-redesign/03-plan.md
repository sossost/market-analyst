# Plan: 주간 리포트 전면 재설계

GitHub Issue: #69

## Phase 1: 도구 확장 (병렬 가능)

| # | 작업 | 파일 | 완료 기준 |
|---|------|------|-----------|
| 1-A | `getIndexReturns` 주간 모드 | `src/agent/tools/getIndexReturns.ts` | `mode: "weekly"` 시 5일 누적 수익률 + closePosition 반환. 기존 daily 불변 |
| 1-B | `getMarketBreadth` 주간 추이 | `src/agent/tools/getMarketBreadth.ts` | `mode: "weekly"` 시 5일 Phase 2 비율 배열 + phase1to2Transitions 반환 |
| 1-C | `getLeadingSectors` 전주 비교 | `src/agent/tools/getLeadingSectors.ts` | `mode: "weekly"` 시 rankChange + newEntrants/exits 반환 |
| 1-D | `readRecommendationPerformance` 주간 집계 | `src/agent/tools/readRecommendationPerformance.ts` | `period: "this_week"` 시 weekWinRate/weekAvgPnl/phaseExits 반환 |

1-A, 1-B, 1-C, 1-D는 의존성 없음 → **4개 병렬 실행**.

## Phase 2: 프롬프트 재설계 (Phase 1 완료 후)

| # | 작업 | 파일 | 완료 기준 |
|---|------|------|-----------|
| 2-A | 주간 워크플로우 재작성 | `src/agent/systemPrompt.ts` | 1~3단계에 mode: "weekly" 명시, 로테이션 해석 지시, 구조적/일회성 구분 규칙 |
| 2-B | 리포트 포맷 변경 | `src/agent/systemPrompt.ts` | 메시지1 주간 누적, 메시지4 성과 집계 + 사후 검증 |
| 2-C | 주도주 선정 기준 강화 | `src/agent/systemPrompt.ts` | S/A우선, 섹터 편중 경고, 펀더멘탈 악화 필터 |
| 2-D | thesis 충돌 대응 로직 | `src/agent/systemPrompt.ts` | 충돌 시 비중 조절/조건부 추천/thesis 재검토 지시 |

2-A~D는 동일 파일 → **순차 실행** (하나의 작업으로 통합 가능).

## Phase 3: 테스트 (Phase 2 완료 후)

| # | 작업 | 파일 | 완료 기준 |
|---|------|------|-----------|
| 3-A | getIndexReturns weekly 테스트 | `tests/agent/tools/getIndexReturns.test.ts` | weekly 모드 반환값 검증, daily fallback 검증 |
| 3-B | getMarketBreadth weekly 테스트 | `tests/agent/tools/getMarketBreadth.test.ts` | 5일 추이 배열, phase1to2 집계 검증 |
| 3-C | getLeadingSectors weekly 테스트 | `tests/agent/tools/getLeadingSectors.test.ts` | rankChange 계산, newEntrants/exits 검증 |
| 3-D | readRecommendationPerformance 테스트 | `tests/agent/tools/readRecommendationPerformance.test.ts` | 주간 집계 정확성, 오판 케이스 검증 |
| 3-E | 기존 daily 회귀 테스트 | 기존 테스트 파일 | mode 미지정 시 기존 동작 불변 확인 |

3-A~D 병렬, 3-E는 전체 완료 후.

## Phase 4: 스모크 테스트

| # | 작업 | 완료 기준 |
|---|------|-----------|
| 4-A | `npm run agent:weekly` 실행 | 에러 없이 주간 누적 데이터 포함 리포트 생성 확인 |

## 의존성

```
Phase 1 (도구 확장, 병렬)
    |
    v
Phase 2 (프롬프트 재설계, 순차)
    |
    v
Phase 3 (테스트, 병렬)
    |
    v
Phase 4 (스모크 테스트)
```

## 리스크 대응

| 리스크 | 대응 |
|--------|------|
| Yahoo Finance 휴장일로 5일 미달 | close 배열 길이 < 2이면 daily fallback |
| sector_rs_daily 7일 전 부재 | 가장 가까운 이전 주 날짜로 대체 쿼리 |
| 프롬프트 토큰 증가 | weekly 반환값에서 불필요 필드 제거, 배열 최대 5개 제한 |
| 기존 일간 동작 파괴 | 모든 파라미터 기본값 "daily"/"all" 설정 + 회귀 테스트 |
