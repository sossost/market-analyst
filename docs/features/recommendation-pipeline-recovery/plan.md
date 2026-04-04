# Plan: 추천 파이프라인 복구 — Bear Exception Gate 완화

**이슈**: #619
**유형**: Lite (단순 수정 — 상수 완화 + 테스트 업데이트)
**골 정렬**: ALIGNED — Phase 2 초입 포착 성과 측정의 전제 조건. 추천 데이터 0건이면 성과 피드백 루프 자체가 불가.

## 문제 정의

### 현상
- `recommendations` 테이블: 90일간 0건
- `recommendation_factors` 테이블: 전 기간 0건

### 근본 원인 (데이터 소실 아님)

`scan-recommendation-candidates` ETL job이 2026-04-01에 신규 배포됨. 첫 실행(04-02)에서 EARLY_BEAR 레짐의 Bear Exception Gate가 Phase 2 종목 1,441건 **전량 차단**.

Bear Exception 통과 조건이 3가지 AND 조건으로 사실상 달성 불가능:

| 조건 | 기준 | 실제 달성 가능성 |
|------|------|-----------------|
| 섹터 RS | 상위 5% (20개 섹터 중 1개) | 극히 낮음 |
| SEPA 등급 | S 등급 **only** | 극히 낮음 |
| Phase 2 지속 | 5일 이상 | 보통 |

3개 AND 조건이 동시에 충족될 확률은 사실상 0. 04-03~04-04는 미장 휴일로 ETL Phase 2+ 미실행.

**마이그레이션/데이터 소실은 원인이 아님** — `drizzle/migrations/` 최근 파일에 recommendations 관련 DDL 변경 없음.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| Bear 예외 SEPA 등급 | S only | S 또는 A |
| Bear 예외 섹터 RS | 상위 5% | 상위 15% |
| Bear 예외 Phase 2 지속 | 5일 | 3일 |
| EARLY_BEAR 추천 통과율 | 0/1441 (0%) | 예상 1~3% |

## 변경 사항

### 1. `src/tools/bearExceptionGate.ts` — 상수 완화

```
BEAR_EXCEPTION_SECTOR_RS_PERCENTILE: 5 → 15
BEAR_EXCEPTION_MIN_GRADE: "S" → "A" (S 또는 A 허용)
BEAR_EXCEPTION_PHASE2_PERSISTENCE_DAYS: 5 → 3
```

등급 판정 로직을 `=== "S"` 에서 점수 기반(`ALLOWED_GRADES` Set)으로 변경.

### 2. `src/tools/__tests__/bearExceptionGate.test.ts` — 테스트 업데이트

- 상수 검증 테스트 값 수정
- A등급 통과 테스트 추가
- B등급 차단 테스트 추가
- 경계값 테스트 수정 (5% → 15%)

### 3. `src/etl/jobs/__tests__/scan-recommendation-candidates.test.ts` — 상수 연동 확인

이 테스트는 bearExceptionGate를 mock하므로 직접 변경 불필요. 상수 import가 없어 영향 없음.

## 작업 계획

1. `bearExceptionGate.ts` 상수 및 판정 로직 수정
2. 테스트 업데이트 + 실행
3. 타입 체크 확인

## 리스크

| 리스크 | 완화 |
|--------|------|
| 완화 후 Bear 장에서 불량 종목 추천 | 나머지 7개 게이트(RS, 가격, 안정성, 지속성, 펀더멘탈)가 여전히 필터링. Bear 예외는 "진입 허용" 게이트일 뿐, 품질 게이트는 별도 |
| A등급 종목이 S등급보다 생존율 낮을 가능성 | 성과 데이터 축적 후 검증 가능. 현재는 데이터 자체가 없어 판단 불가 |
| 기존 리포트 로직 영향 | 변경 범위가 Bear Exception Gate 상수/판정 로직에 한정. 리포트 생성 경로 미접촉 |

## 무효 판정

해당 없음 — 추천 파이프라인은 성과 측정의 핵심 인프라. 0건 상태가 지속되면 학습 루프 전체가 무력화.
