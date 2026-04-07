# Plan: Phase1Late·RisingRS SEPA 게이트 완화

## 문제 정의

조기포착 도구 2개(`getPhase1LateStocks`, `getRisingRS`)의 SQL WHERE절이 SEPA S/A 등급만 허용하여,
기저 형성 초기(B/C 등급) 종목이 구조적으로 누락됨.

Phase 1 종목의 핵심 특성은 실적이 아직 가속되지 않았거나 초기 가속 단계(대부분 B/C 등급).
결과적으로 "남들보다 먼저 포착"이라는 골에 역행하는 구조적 결함.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| `findRisingRsStocks` SEPA 필터 | `IN ('S', 'A')` | `IN ('S', 'A', 'B')` |
| `findPhase1LateStocks` SEPA 필터 | `IN ('S', 'A')` | `IN ('S', 'A', 'B')` |
| `getFundamentalAcceleration` SEPA 필터 | F 제외 (변경 없음) | F 제외 (변경 없음) |
| `MAX_PER_CATEGORY` | 10 | 15 |

## 변경 사항

### 1. `src/db/repositories/stockPhaseRepository.ts`
- **line 325**: `fs.grade IN ('S', 'A')` → `fs.grade IN ('S', 'A', 'B')`
- **line 378**: `fs.grade IN ('S', 'A')` → `fs.grade IN ('S', 'A', 'B')`

### 2. `src/debate/earlyDetectionLoader.ts`
- **line 14**: `MAX_PER_CATEGORY = 10` → `MAX_PER_CATEGORY = 15`

### 3. 테스트 업데이트
- `__tests__/agent/tools/getRisingRS.test.ts`: SEPA B등급 종목 포함 시나리오 추가
- `__tests__/agent/tools/getPhase1LateStocks.test.ts`: SEPA B등급 종목 포함 시나리오 추가

## 골 정렬

**ALIGNED** — "남들보다 먼저 포착"이라는 핵심 골에 직접 기여.
B등급까지 포함하면 EPS 초기 가속 + RS 상승 중인 Phase 2 초입 후보를 2-tool overlap으로 포착 가능.

## 무효 판정

**유효** — C/F 등급은 계속 제외하여 노이즈 방지. B등급은 실적 초기 가속 단계로, 조기포착 목적에 부합.
overlap 2건 이상만 high conviction으로 표시하는 기존 로직이 노이즈 필터 역할을 유지.

## 리스크

- B등급 유입으로 풀이 넓어져 노이즈 가능성 → overlap 필터가 방어
- MAX_PER_CATEGORY 확대(10→15)로 전체 반환 건수 증가(최대 30→45) → 토큰 소비 소폭 증가
- 인덱스 영향 미미 — IN 절 값 1개 추가로 쿼리 플랜 변경 없음

## 작업 계획

1. `stockPhaseRepository.ts` SEPA 필터 완화 (2곳)
2. `earlyDetectionLoader.ts` MAX_PER_CATEGORY 확대
3. 테스트 업데이트 + 실행
4. 셀프 리뷰
5. 커밋 + PR
