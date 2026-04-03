# Plan: Early Detection 도구 교집합 필터

## 문제 정의

3개 조기포착 도구(`getPhase1LateStocks`, `getRisingRS`, `getFundamentalAcceleration`)가 독립 리스트만 생성하며,
symbol 기준 교집합 계산이 없음. 복수 신호 수렴(Phase 2 초입의 핵심 판별 기준)을 LLM 텍스트 매칭에 의존하여
일관성·재현성이 없는 상태.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| 교집합 계산 | LLM 텍스트 매칭 의존 | symbol 기준 프로그래밍적 교집합 |
| 신호 강도 | 구분 없음 (1도구 = 3도구) | overlap_count(1/2/3) + source 태깅 |
| 토론 컨텍스트 | 3개 독립 섹션 | + 고확신 후보(2+도구) 별도 섹션 |
| 하위 호환 | — | 기존 3개 섹션 그대로 유지 |

## 변경 사항

### 1. `src/debate/earlyDetectionLoader.ts` — 교집합 계산 로직 추가

- `computeOverlapStocks(data: EarlyDetectionData)` 순수 함수 추출
  - 3개 리스트의 symbol을 키로 Map 구축
  - 각 symbol에 `overlapCount`(1/2/3), `sources` 배열 태깅
  - `overlapCount >= 2`인 종목을 "고확신 후보"로 필터
- `EarlyDetectionData` 인터페이스에 `highConviction` 필드 추가
- `formatEarlyDetectionContext()`에 고확신 후보 섹션 추가 (기존 3개 섹션 앞에 배치)

### 2. 테스트 확장

- `computeOverlapStocks` 순수 함수 단위 테스트
  - 0개 결과, 1개 도구만 결과, 2개 교집합, 3개 교집합
- `formatEarlyDetectionContext` 고확신 섹션 포맷 테스트

## 작업 계획

1. `computeOverlapStocks` 순수 함수 구현 + export
2. `OverlapStock`, `EarlyDetectionData` 타입 확장
3. `loadEarlyDetectionData`에서 교집합 계산 호출
4. `formatEarlyDetectionContext`에 고확신 섹션 추가
5. 기존 테스트 통과 확인 + 새 테스트 작성
6. 로그에 고확신 후보 수 포함

## Scope 제한

- **포함**: 교집합 필터 + overlap_count 태깅 + 고확신 섹션
- **제외**: EPS 가속 판정 로직 통일 (별도 이슈로 분리 — 이슈에서도 별도 언급)

## 리스크

| 리스크 | 영향 | 대응 |
|--------|------|------|
| symbol 키 불일치 | 교집합 누락 | 3개 도구 모두 `symbol` 필드 사용 확인 완료 |
| 교집합 0건 | 섹션 미표시 | 빈 배열이면 섹션 skip (기존 패턴 동일) |
| 토큰 미세 증가 | 비용 | 고확신 후보는 보통 0~5건 — 무시 가능 |

## 골 정렬

- **판정: ALIGNED**
- 프로젝트 골 "Phase 2 주도섹터/주도주 초입 포착"에 직접 기여
- 복수 신호 수렴 종목을 프로그래밍적으로 식별하여 포착 정확도 향상

## 무효 판정

- **해당 없음** — DB 데이터 기반 교집합 계산, LLM 의존도 감소 방향
