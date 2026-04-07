# Plan: 센티먼트 에이전트 반대 의견 억제 완화 — 변곡점 포착력 복원

## 문제 정의

센티먼트 에이전트가 토론 시스템 내 반대론자(contrarian) 역할임에도, 3중 억제 메커니즘에 의해 의견이 체계적으로 억제되어 **레짐 전환기(변곡점)에서 반대 시각이 과소평가**되는 구조적 문제.

### 억제 메커니즘 (현행)

1. **confidence 2단계 하향** — `round3-synthesis.ts`: high→low, medium→low 강제
2. **단독 의견 합의 배제** — `confidenceCalibrator.ts`: 모더레이터 프롬프트에서 단독 의견 완전 제외 지시
3. **0.5x 가중치** — `confidenceCalibrator.ts`: 적중률 50% 미만 에이전트에 0.5배 가중 지시

### 핵심 문제

- 카테고리 제한(structural_narrative, sector_rotation만 허용)으로 **방향성 타이밍 예측은 이미 차단됨**
- 추가 신뢰도 하향은 **구조적 포지셔닝 관찰**(예: "Tech 포지셔닝 과밀", "자금 흐름 defensive 이동")까지 억제
- EARLY_BEAR↔EARLY_BULL 전환기에 반대론자 의견이 리포트에 반영되지 않아 전환 신호 과소평가

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| sentiment confidence (structural_narrative) | 무조건 low 강제 | **원본 유지** |
| sentiment confidence (sector_rotation) | 무조건 low 강제 | 무조건 low 강제 (유지) |
| 모더레이터 가중치 (전환기: EARLY_BEAR/EARLY_BULL) | 0.5x + 단독 배제 | **1.0x + 단독 배제 해제** |
| 모더레이터 가중치 (안정기) | 0.5x + 단독 배제 | 0.5x + 단독 배제 (유지) |
| 방향성 수치 예측 차단 | 차단 | 차단 (유지) |
| short_term_outlook 카테고리 차단 | 차단 | 차단 (유지) |

## 변경 사항

### 1. `src/debate/round3-synthesis.ts` — 카테고리별 조건부 confidence 하향

**현행**: `CONFIDENCE_DOWNGRADE_PERSONAS`에 sentiment 등록 → 전 카테고리 2단계 하향
**변경**: structural_narrative 카테고리는 confidence 원본 유지, sector_rotation만 기존 하향 유지

```
confidence 하향 로직:
  if (persona === sentiment) {
    if (category === structural_narrative) → confidence 원본 유지
    if (category === sector_rotation) → 기존 2단계 하향 (high→low, medium→low)
  }
```

### 2. `src/debate/confidenceCalibrator.ts` — 레짐 조건부 가중치 규칙

**현행**: 적중률 50% 미만 에이전트에 무조건 0.5x + 단독 배제
**변경**: 현재 레짐을 받아, EARLY_BEAR/EARLY_BULL 전환기에는 sentiment 가중치 1.0x + 단독 배제 해제

- `formatModeratorPerformanceContext`에 선택적 `currentRegime` 파라미터 추가
- 전환기 레짐일 때 저신뢰 규칙에 "단, 전환기에는 1.0x / 단독 의견도 고려" 조건 추가
- `buildModeratorPerformanceContext`에도 regime 전달 경로 추가

### 3. `src/agent/run-debate-agent.ts` — 레짐 정보 전달

`buildModeratorPerformanceContext` 호출 시 현재 확정 레짐을 전달.

### 4. `.claude/agents/sentiment-analyst.md` — 프롬프트 동기화

line 90의 "2단계 하향" 설명을 카테고리 조건부로 업데이트.

### 5. EXPIRED 캘리브레이션 bin 포함 — **보류**

기존 제외 근거가 합리적 (EXPIRED는 검증 판정을 받지 못한 상태). 적중률 계산에는 이미 EXPIRED 포함됨. 변경 불요.

## 작업 계획

1. `round3-synthesis.ts` — `normalizeThesisFields` 내 confidence 하향 로직에 카테고리 조건 추가
2. `confidenceCalibrator.ts` — `formatModeratorPerformanceContext`에 regime 파라미터 추가, 전환기 분기
3. `confidenceCalibrator.ts` — `buildModeratorPerformanceContext`에 regime 전달
4. `run-debate-agent.ts` — `buildModeratorPerformanceContext` 호출 시 confirmedRegime 전달
5. `sentiment-analyst.md` — line 90 문구 동기화
6. 테스트 업데이트: `confidenceCalibrator.test.ts`, `round3-synthesis.test.ts`

## 리스크

| 리스크 | 완화 |
|--------|------|
| structural_narrative confidence 복원으로 sentiment 과신 | sector_rotation은 여전히 low 강제. 수치 예측 필터/카테고리 제한은 유지. |
| 전환기 가중치 복원으로 저적중 의견 과반영 | 전환기(EARLY_BEAR/EARLY_BULL)에만 한정. 안정기에는 기존 억제 유지. |
| 코드 변경으로 기존 테스트 깨짐 | 기존 테스트 업데이트 + 새 케이스 추가 |

## 골 정렬

**ALIGNED** — Phase 2 초입 포착 시스템의 핵심 리스크인 변곡점 미포착을 직접 해결. 반대론자의 구조적 관찰이 리포트에 반영되어 레짐 전환 시 조기 경보 역할.

## 무효 판정

**해당 없음** — 기존 가드레일(수치 예측 필터, short_term_outlook 차단, 카테고리 제한)은 모두 유지. 이 변경은 억제를 해제하는 것이 아니라 **조건부로 완화**하는 것.
