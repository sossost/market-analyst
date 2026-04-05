# Plan: Sentiment 에이전트 적중률 개선 (#620)

## 문제 정의

Sentiment 에이전트의 90일 thesis 적중률이 **43.8%** (7/16)로 전체 에이전트 중 최저.
주요 실패 패턴: **방향성 + 타이밍 + 수치 조합 예측** (VIX 목표치, F&G 회복 전망, RS 수준 예측).

기존 조치(프롬프트 규칙 8·9, 카테고리 차단, 1단계 confidence 하향)가 있으나 적중률 44%에는 부족.
프롬프트 제약이 LLM에 의해 무시된 전적이 있으므로 **코드 레벨 가드레일 강화**가 핵심.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| Confidence 하향 | 1단계 (high→medium, medium→low) | **2단계** (high→low, medium→low) |
| 수치 예측 차단 | 프롬프트 규칙만 | 프롬프트 + **코드 레벨 패턴 검출 → 드롭** |
| 모더레이터 가중치 | "50% 미만 단독 의견 반영 금지" (정성적) | **0.5배 가중치 명시 + 보강 없이 합의 반영 금지** (정량적) |
| 프롬프트 | 규칙 나열 | **금지/허용 예시 대조표** 추가 |

## 변경 사항

### 1. sentiment-analyst.md 프롬프트 강화
- 규칙 8·9 통합 재구성: 금지 패턴 vs 허용 패턴 대조표
- 과거 실패 사례를 구체적으로 명시
- "너의 가치는 예측이 아니라 구조 분석"을 더 강조

### 2. round3-synthesis.ts — 2단계 confidence 하향
- `CONFIDENCE_DOWNGRADE` 맵 변경: `high→low`, `medium→low` (기존: high→medium, medium→low)
- 44% 적중률은 low confidence 수준이므로, sentiment의 모든 thesis는 실질적으로 low로 수렴

### 3. round3-synthesis.ts — 수치 예측 패턴 검출기
- sentiment thesis에 특정 지표+수치 예측 패턴(VIX \d+, F&G \d+, RS \d+, 목표치, ~내, ~까지 등)이 포함되면 thesis를 드롭
- 정규식 기반 패턴 매칭 — 현재값 인용(데이터 관찰)은 허용, 목표/전망 표현 결합은 차단
- `normalizeThesisFields` 후, `isValidThesis` 전에 필터링 단계 추가

### 4. confidenceCalibrator.ts — 모더레이터 가중치 정량화
- `formatModeratorPerformanceContext`에 50% 미만 에이전트 전용 가중치 지시 추가
- "sentiment의 의견은 **0.5배 가중치**로 취급. 다른 분석가의 근거로 보강되지 않으면 합의에서 완전 제외"

### 5. 테스트 업데이트
- 기존 confidence 하향 테스트: high→low로 기대값 변경
- 수치 예측 패턴 검출기 테스트 추가 (드롭/허용 케이스)
- 모더레이터 가중치 포맷 테스트 추가

## 작업 계획

| Phase | 작업 | 파일 |
|-------|------|------|
| 1 | 프롬프트 강화 | `.claude/agents/sentiment-analyst.md` |
| 2 | 2단계 confidence 하향 | `src/debate/round3-synthesis.ts` |
| 3 | 수치 예측 패턴 검출기 | `src/debate/round3-synthesis.ts` |
| 4 | 모더레이터 가중치 정량화 | `src/debate/confidenceCalibrator.ts` |
| 5 | 테스트 업데이트/추가 | `src/debate/__tests__/thesis-category-filter.test.ts` |

## 리스크

1. **2단계 하향의 영향** — sentiment thesis가 모두 low가 되면 합의에서 영향력이 극도로 줄어듦. 이는 의도된 동작(44% 적중률이면 low가 적정). 적중률이 개선되면 다시 1단계로 완화 가능.
2. **패턴 검출 false positive** — 현재값 인용("현재 VIX 31")을 예측으로 오탐할 위험. 예측 표현(전망, 도달, 회복, 하회 등)과 결합된 패턴만 매칭하여 완화.
3. **모더레이터 가중치 변경의 전체 영향** — sentiment 가중치 감소 시 macro/tech/geopolitics의 상대적 영향력 증가. 현재 이들의 적중률(64-86%)이 양호하므로 부작용 제한적.

## 골 정렬

- **ALIGNED** — thesis 적중률 개선은 리포트 품질과 직결. 시스템 신뢰도의 핵심 지표.
- **무효 판정**: 해당 없음 (개선 이슈, 무효 조건 없음)
