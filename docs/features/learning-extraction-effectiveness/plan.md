# Plan: 학습 루프 추출 로직 실효성 검증 — 28건 판정 대비 2건 추출

**이슈:** #437
**유형:** Lite (단순 수정)
**골 정렬:** SUPPORT — 학습 루프는 에이전트 판단 정확도 향상의 핵심. 추출율 8%는 사실상 학습 불능 상태.
**무효 판정:** 해당 없음 (LLM 백테스트 아님, 실제 통계적 임계값 버그 수정)

## 문제 정의

28건 thesis 판정(CONFIRMED 16 + INVALIDATED 12) 대비 활성 학습 2건(추출율 8%).
#432에서 absorbNewTheses 추가로 기존 학습의 성장은 해결했으나, **신규 학습 생성이 구조적으로 차단**되는 문제 미해결.

### 근본 원인: Cold Start Dead Zone

| 단계 | 조건 | minHits | minTotal | binomial | 문제 |
|------|------|---------|----------|----------|------|
| Bootstrap | 0-1건 | 1 | 1 | 면제 | OK — 첫 학습 진입 가능 |
| **Cold Start** | **2-4건** | **2** | **3** | **필수** | **Dead Zone** |
| Growth | 5-14건 | 5 | 8 | 필수 | 도달 불가 |

Cold Start의 3중 차단:
1. **minTotal=3 > minHits=2**: 2건 confirmed + 0건 invalidated인 그룹은 total=2 < 3으로 탈락
2. **Binomial test**: P(X≥2|n=2,p=0.5) = 0.25. 소표본에서 p<0.05 불가. 최소 5/5 필요
3. **그룹 파편화**: 4개 persona × N개 metric = 그룹당 평균 1-2건. 어떤 threshold도 통과 불가

결과: Bootstrap에서 2건 생성 후, Cold Start로 진입하면 영구적으로 신규 학습 생성 불가.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| Cold Start binomial | 필수 (소표본에서 통과 불가) | 면제 (hitRate로 품질 제어) |
| Cold Start minTotal | 3 (minHits=2와 불일치) | 2 (minHits와 일치) |
| Growth minHits | 5 (그룹당 5건 적중 필요) | 3 (달성 가능) |
| Growth minTotal | 8 (그룹당 8건 필요) | 5 (달성 가능) |
| Normal minHits | 10 | 5 |
| Normal minTotal | 10 | 8 |

### 졸업 곡선 (수정 후)

| 단계 | 조건 | minHits | minHitRate | minTotal | binomial |
|------|------|---------|------------|----------|----------|
| Bootstrap | 0-1건 | 1 | 55% | 1 | 면제 |
| Cold Start | 2-4건 | 2 | 55% | 2 | **면제** |
| Growth | 5-14건 | 3 | 60% | 5 | 필수 |
| Normal | 15+건 | 5 | 65% | 8 | 필수 |

## 변경 사항

### 1. `src/etl/jobs/promote-learnings.ts`
- `getPromotionThresholds()`: Cold start에 skipBinomialTest=true, minTotal=2, minHitRate=0.55
- Growth: minHits=3, minTotal=5, minHitRate=0.60
- Normal: minHits=5, minTotal=8, minHitRate=0.65

### 2. `src/etl/jobs/__tests__/promote-learnings.test.ts`
- 기존 threshold 테스트 expected값 업데이트
- cold start binomial test 면제 테스트 추가

## 리스크

- **품질 저하 우려**: Cold start에서 binomial 면제 → hitRate 55%로 품질 제어. Growth 진입(5건+) 후 binomial 적용으로 통계적 엄격성 회복.
- **과잉 학습 우려**: 현재 2건 → 50건 상한 대비 여유 충분. 성숙도 게이트(MIN_MATURATION_HITS=3)가 저품질 학습 자동 강등.
