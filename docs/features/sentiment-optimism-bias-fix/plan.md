# Plan: Sentiment 에이전트 체계적 낙관 편향 교정

## 문제 정의

sentiment 에이전트 적중률 41.2% (7/17) — 4명 중 최하위, 동전 던지기 이하.
핵심 원인: **정상화(mean-reversion) 내러티브 과신**. 극단값(VIX 스파이크, F&G 극공포)이 지속되는 시나리오를 체계적으로 과소평가.

INVALIDATED 패턴:
- VIX 하락 예측 반복 실패 (high confidence, 3/4 consensus → INVALIDATED)
- F&G 회복 과다 예측
- Energy RS 조정 예측 실패
- 공통: 시장 공포 상태 유지 중 빠른 회복 예측

## 골 정렬

**ALIGNED** — Phase 2 변곡점 포착이 프로젝트 골. sentiment 적중률 41.2%는 토론 전체의 시장 전환 포착력을 직접 약화시킨다. 교정은 골에 직결.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| sentiment 프롬프트 | VIX 규칙만 존재, 다른 지표 극단값 지속성 미고려 | 전 지표 극단값 지속성 프레임워크 + mean-reversion 편향 명시 경고 |
| 모더레이터 교차 정보 | agent 단위 적중률 + category 단위 적중률 (분리) | agent×category 교차 적중률 매트릭스 추가 |

## 변경 사항

### 1. Sentiment 프롬프트 강화 (`.claude/agents/sentiment-analyst.md`)

기존 규칙 7(VIX 고변동성)을 **전 지표 극단값 지속성 원칙**으로 확장:
- 극단값은 모멘텀 특성: VIX, F&G, breadth 모두 극단에서 더 극단으로 갈 수 있다
- "회복 예측" 금지 가드레일: 확인 신호(최소 2주 연속 방향 전환 데이터) 없이 회복 예측 금지
- mean-reversion 편향 명시 경고: "정상화될 것"은 당신의 체계적 실패 패턴

기존 규칙 구조는 유지하면서 규칙 7을 확장하고, 신규 분석 규칙 하나를 추가한다.

### 2. agent×category 교차 적중률 모더레이터 컨텍스트 (`src/debate/confidenceCalibrator.ts`)

새 함수: `buildModeratorCrossCalibrationContext()`
- 모든 에이전트의 카테고리별 적중률을 교차 매트릭스로 조회
- 특정 agent×category 조합이 50% 미만이면 해당 조합에 가중치 할인 지시
- 기존 `buildModeratorPerformanceContext` 인터페이스 변경 없음 (추가 함수)

`src/agent/run-debate-agent.ts`에서 새 함수를 호출하여 `agentPerformanceContext`에 합류.

### 3. 테스트

- `formatModeratorCrossCalibrationContext` 순수 함수 테스트
- 빈 데이터, 정상 데이터, 저적중 조합 경고 케이스

## 작업 계획

1. sentiment-analyst.md 프롬프트 수정
2. confidenceCalibrator.ts에 교차 적중률 함수 추가
3. run-debate-agent.ts에서 새 함수 호출 통합
4. 테스트 작성 및 실행
5. 코드 리뷰

## 리스크

- **과잉 교정**: 낙관 편향 → 비관 편향 전환 방지. 프롬프트에 "양방향 균형" 명시.
- **레짐 의존성**: 프롬프트 수정은 레짐 불변적으로 설계. "공포 시 비관하라"가 아니라 "극단값의 지속 가능성을 존중하라".
- **backward compatibility**: 새 함수 추가만, 기존 인터페이스 변경 없음.

## 무효 판정

**해당 없음** — 구현 가치 명확. 적중률 41.2%는 역신호 수준이며 교정은 필수.
