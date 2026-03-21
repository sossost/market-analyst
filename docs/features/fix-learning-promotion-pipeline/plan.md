# Plan: fix-learning-promotion-pipeline

> Closes #360 — agent_learnings 테이블 비어 있음, 학습 승격 파이프라인 미작동

## 문제 정의

`agent_learnings` 테이블에 active 레코드 0건. 90일간 thesis 50건 생성, 11건 confirmed, 7건 invalidated 되었으나 학습으로 승격된 건이 없음.

### 근본 원인

`promote-learnings.ts`의 `main()` 함수에서 **EXPIRED theses를 부정 신호로 취급**하는 것이 핵심 원인:

```typescript
const allNegativeTheses = [...invalidatedTheses, ...expiredTheses]; // line 156
```

- EXPIRED = "검증 시한 초과" (ambiguous) ≠ "예측 실패" (negative)
- Bootstrap 단계(활성 학습 0건)에서 EXPIRED가 부정으로 계산되면 hitRate가 희석됨
- 예: persona=sentiment, metric=VIX → 1 confirmed + 2 expired = hitRate 33% < 55% → 승격 불가
- 모든 persona::metric 그룹에서 이런 dilution이 발생하면 bootstrap이 영구적으로 불가능

#356에서 minHits=1, minTotal=1로 완화했으나, minHitRate=55%는 유지. EXPIRED가 hitRate를 55% 미만으로 끌어내리면 여전히 승격 불가.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| Bootstrap 부정 신호 | INVALIDATED + EXPIRED | INVALIDATED만 |
| 1 confirmed + 2 expired | hitRate=33% → 탈락 | hitRate=100% → 승격 |
| 1 confirmed + 1 invalidated | hitRate=50% → 탈락 | hitRate=50% → 탈락 (정상) |
| 학습 루프 bootstrap | 영구 정지 | 첫 학습 진입 가능 |

## 변경 사항

### 1. `src/etl/jobs/promote-learnings.ts` — `main()` 함수

- Bootstrap/cold start 단계에서 `buildPromotionCandidates`에 전달하는 부정 신호에서 EXPIRED 제외
- EXPIRED 제외 범위: `activeLearningCount < COLD_START_THRESHOLD` (0~4건)
  - Bootstrap(0~1건): EXPIRED 제외 — 학습 루프 시동에 필수
  - Cold start(2~4건): EXPIRED 제외 — 초기 학습 안정화에 필요
  - Growth(5건+): EXPIRED 포함 유지 — 충분한 데이터에서는 EXPIRED도 부정 신호로 의미 있음
- 진단 로그 추가: EXPIRED 제외 여부와 제외된 건수

### 2. `__tests__/etl/promote-learnings.test.ts` — 테스트 추가

- Bootstrap에서 EXPIRED가 hitRate를 희석하는 시나리오 테스트
- EXPIRED 제외 시 승격 가능 확인
- Growth 단계에서는 EXPIRED 포함 유지 확인

## 작업 계획

1. `promote-learnings.ts` 수정 — EXPIRED 제외 로직
2. 테스트 추가 — 핵심 시나리오 커버
3. 기존 테스트 통과 확인
4. 셀프 리뷰

## 골 정렬

- **판정: ALIGNED**
- 학습 루프는 시스템의 자기 교정 메커니즘. Phase 2 주도섹터/주도주 초입 포착 정확도 개선의 전제 조건.
- 학습이 축적되지 않으면 같은 실수를 반복하며 포착 정확도가 시간이 지나도 개선되지 않음.

## 무효 판정

- **판정: 해당 없음**
- LLM 백테스트, 자기확증편향 등 무효 패턴에 해당하지 않음
- EXPIRED 제외는 bootstrap/cold start 단계에만 적용, growth 이상에서는 기존 동작 유지

## 리스크

- **낮음**: Bootstrap에서 EXPIRED 제외 시 false positive 학습 승격 가능성
  - 완화: minHitRate=55% 유지, 진짜 INVALIDATED는 여전히 반영
  - 학습이 6개월 후 만료되므로 잘못된 학습도 자동 정리됨
- **낮음**: Cold start 범위 확대로 초기 학습 품질 저하 가능성
  - 완화: Cold start는 minHits=2, minTotal=3, binomial test 유지
