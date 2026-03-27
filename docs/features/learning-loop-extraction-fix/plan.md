# Plan: learning-loop-extraction-fix

**이슈**: #451 — 학습 루프 사실상 정지 (68건 thesis 대비 2건 추출, 3%)
**트랙**: Lite (버그픽스/개선)
**골 정렬**: ALIGNED — 학습 루프는 Phase 2 주도섹터/주도주 초입 포착 정확도의 지속적 개선 메커니즘. 3% 추출률은 학습 불능 상태.
**무효 판정**: 해당 없음 — LLM 백테스트가 아닌 파이프라인 로직 개선

## 문제 정의

90일간 68건 thesis 생성 (17 CONFIRMED, 12 INVALIDATED, 3 EXPIRED, 36 ACTIVE) → 활성 학습 2건 (3%).

### 원인 분석

1. **메트릭 분산 → 그룹 미달**: `buildPromotionCandidates`가 `persona::normalizedMetric`으로 그룹핑하지만, LLM이 생성하는 verificationMetric이 매우 다양. 17건 CONFIRMED가 각기 다른 metric으로 분산되면 cold-start minHits=2를 충족하는 그룹이 형성되지 않음.
2. **INVALIDATED 미활용**: 12건 INVALIDATED thesis에서 반복 실패 패턴을 학습하지 않음. `failure_patterns`는 Phase 2 signal_log 기반이라 thesis-level 실패와 별개.
3. **자기참조 루프 모니터링 부재**: quantitative vs LLM 검증 비율을 추적하지 않아, LLM이 자기 thesis를 자기가 검증하는 비율이 불투명.

### hit_count < 2 활성화 이슈 (ID 8)
현재 2건 학습 → cold-start 미만 → maturation gate 미작동. 이는 bootstrap 설계 의도. 카테고리 폴백으로 신규 학습이 생성되면 자연히 cold-start 진입 → maturation gate 발동 → hit_count < 3인 학습 자동 강등.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| 그룹핑 | persona::metric only | persona::metric → 실패 시 persona::category 폴백 |
| INVALIDATED 활용 | 미사용 (misses로만 계산) | 반복 실패 패턴 → caution 학습 (anti-principle) |
| 자기참조 모니터링 | 없음 | quantitative 비율 로그 + 경고 |
| 예상 추출률 | 3% (2/68) | 15-25% (카테고리 폴백 + anti-pattern) |

## 변경 사항

### 1. 카테고리 폴백 그룹핑 (`buildPromotionCandidates`)
- 현재: persona::metric 그룹만 시도
- 변경: metric 그룹이 threshold 미달 시, 미달 thesis를 persona::category로 재그룹핑
- 원칙: metric 그룹 우선 (세밀한 학습), category는 폴백 (학습 루프 시동용)

### 2. INVALIDATED 반복 패턴 → anti-principle (`buildAntiPatternCandidates`)
- INVALIDATED thesis를 persona::normalizedMetric으로 그룹핑
- 같은 그룹에서 반복 실패 (missCount >= threshold) → caution 학습 생성
- principle 형태: `[경계-thesis] {persona} {metric} 관련 전망이 {N}회 실패 (실패율 {X}%, {total}회 관측)`
- 기존 failure_patterns caution과 구분: sourceThesisIds에 `{ source: "thesis_anti_pattern", ... }` 저장

### 3. 검증 비율 모니터링 (`checkLearningLoopHealth`)
- CONFIRMED/INVALIDATED thesis의 verificationMethod 분포 로그
- quantitative 비율 < 30%이면 경고 (자기참조 루프 위험)

## 작업 계획

1. `buildPromotionCandidates` 수정 — 카테고리 폴백 추가
2. `buildAntiPatternCandidates` 신규 함수 — INVALIDATED anti-pattern 추출
3. `main()` 수정 — anti-pattern 승격 단계 추가
4. `checkLearningLoopHealth` 수정 — 검증 비율 모니터링
5. 테스트 추가/수정

## 리스크

- **카테고리 그룹이 너무 넓을 수 있음**: 같은 카테고리에 상반된 thesis가 묶이면 hitRate 희석 → minHitRate 55%로 품질 제어
- **anti-principle 과다 생성**: threshold를 confirmed와 동일하게 적용하여 통계적 근거 확보
