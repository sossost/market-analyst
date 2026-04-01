# Plan: Sentiment 에이전트 타이밍 예측 구조적 실패 개선

> Closes #537 | Lite 트랙 (버그픽스/튜닝)

## 문제 정의

sentiment 에이전트 적중률 40% (6 CONFIRMED / 9 INVALIDATED, 90일).
**근본 원인**: "극단값 → 평균 회귀" 서사에 과도하게 의존하여 반전 타이밍을 체계적으로 과대평가.

대표적 실패:
- Fear & Greed 예측: 100% 실패
- VIX 22-28 레인지 유지 예측 → 실제 31.05 돌파
- Energy RS 65선 하회 예측 → 실제 78.82 추가 상승

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| 프롬프트 | 평균 회귀 타이밍 예측 허용 | 타이밍/수치 도달 예측 명시적 금지 |
| confidence | 원본 유지 | sentiment thesis 자동 1단계 하향 |
| 교차검증 게이트 | 없음 | **미적용** (샘플 15건 — 30건 후 재평가) |

## 변경 사항

### 1. 프롬프트 범위 축소 (`.claude/agents/sentiment-analyst.md`)

분석 규칙에 추가:
- **반전 타이밍 예측 금지**: "N주 내 반전", "N일 내 X 도달" 형식 전면 금지
- **수치 도달 예측 금지**: VIX 목표치, Fear & Greed 수준, RS 특정 수치 예측 금지
- **허용 범위 명확화**: 자금 흐름 방향성, 포지셔닝 극단값의 구조적 의미, 레짐 상태 분석만 허용
- **모멘텀 존중 규칙**: 극단값이 더 극단으로 갈 수 있음을 명시적으로 인지

### 2. confidence 자동 하향 (`src/debate/round3-synthesis.ts`)

`normalizeThesisFields()` 함수에서:
- `agentPersona === 'sentiment'`인 경우 confidence를 1단계 하향
  - `high` → `medium`
  - `medium` → `low`
  - `low` → `low` (하한)
- 하향 시 로그 기록

### 3. 교차검증 게이트 — 미적용 (의도적 제외)

**제외 사유**:
- 샘플 15건으로 통계적 근거 불충분 (최소 30건 필요)
- sentiment의 핵심 가치인 "컨트래리안 역할"을 훼손
- `buildModeratorPerformanceContext()`가 이미 저적중 에이전트를 할인 중
- 30건 이상 누적 시 재평가

## 작업 계획

1. `sentiment-analyst.md` 프롬프트에 타이밍 예측 금지 규칙 추가
2. `normalizeThesisFields()`에 sentiment confidence 하향 로직 추가
3. 기존 `thesis-category-filter.test.ts`에 confidence 하향 테스트 추가
4. 기존 테스트 통과 확인

## 리스크

| 리스크 | 영향 | 대응 |
|--------|------|------|
| 과잉 제약으로 유효 인사이트 누락 | 중 | structural_narrative/sector_rotation은 허용 유지 |
| 샘플 15건에 과적합 | 중 | 30건 후 재평가 시점 기록 |
| 기존 ACTIVE thesis 소급 | 저 | 소급 미적용 — 신규 thesis부터 적용 |

## 변경 시점 기록

- 적용일: 2026-04-01
- 재평가 기준: sentiment resolved thesis 30건 이상 누적 시
