# Plan: 학습 루프 최소 관측 횟수 미설정 — hit_count=1 항목 축적 방지

**이슈**: #394
**트랙**: Lite
**날짜**: 2026-03-23

## 문제 정의

`agent_learnings` 테이블의 활성 학습 7건이 전부 `hit_count=1`.
Bootstrap 단계(활성 0~1건)에서 `minHits=1`로 승격된 학습이, 시스템이 성장 단계로 진입한 후에도 활성 상태로 유지되어 통계적으로 무의미한 "100% 적중률" 학습이 프롬프트에 주입됨.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| 성숙도 검증 | 없음 — 한번 승격되면 만료(6개월)까지 영구 활성 | 매 사이클 성숙도 게이트 적용: 시스템이 bootstrap 탈출 후 hit_count < 3인 학습 자동 강등 |
| 프롬프트 주입 | "적극 활용하세요" (관측 횟수 무관) | 근거 강도 구분: 약한(1-2회)/중간(3-4회)/강한(5회+) |

## 변경 사항

### 1. `src/etl/jobs/promote-learnings.ts` — 성숙도 게이트 추가

- 상수 `MIN_MATURATION_HITS = 3` 추가 (export)
- `demoteImmatureLearnings()` 함수 추가:
  - 조건: `activeLearningCount >= COLD_START_THRESHOLD(5)` AND `hit_count < MIN_MATURATION_HITS` AND `category = 'confirmed'`
  - 동작: `is_active = false` 설정
  - 시점: `updateLearningStats()` 이후, 신규 승격 이전 (main 함수 step 4~5 사이)
- 기존 bootstrap 승격 로직(`minHits=1`)은 유지 — 학습 루프 초기 진입은 허용하되, 성숙 후 재검증

### 2. `src/debate/memoryLoader.ts` — 근거 강도 레이블 추가

- `getEvidenceStrength(hitCount)` 헬퍼 함수:
  - 1-2회: `"⚠️ 약한 근거"`
  - 3-4회: `"중간 근거"`
  - 5회+: `"강한 근거"`
- confirmed 카테고리 프롬프트에 근거 강도 표시
- "적극 활용하세요" → "근거 강도에 따라 가중치를 조절하세요"로 지시문 변경

### 3. 테스트

- `demoteImmatureLearnings` 단위 테스트 (bootstrap에서는 강등 안함, cold start 이후에는 강등)
- `getEvidenceStrength` 단위 테스트
- 기존 `getPromotionThresholds`, `buildPromotionCandidates` 테스트 — 변경 없음 (회귀 확인)

## 골 정렬

- **판정: ALIGNED**
- Phase 2 주도섹터/주도주 초입 포착 시스템의 판단 품질에 직접 영향.
- 근거 불충분한 학습이 프롬프트에 주입되면 단일 우연을 일반 원칙으로 오인 → 편향된 분석.

## 무효 판정

- **해당 없음** — LLM 백테스트가 아닌, 학습 관리 로직의 threshold 조정.
- 실제 가격 변동 기반 검증(quantitative) 경로는 기존 시스템에서 이미 사용 중.

## 리스크

| 리스크 | 대응 |
|--------|------|
| 활성 학습이 0건으로 떨어질 수 있음 | `COLD_START_THRESHOLD(5)` 미만일 때는 성숙도 게이트 미적용. Bootstrap 진입 경로 유지. |
| 강등 후 재승격 불가 | 강등 학습의 sourceThesisIds는 `existingSourceIds`에 포함되지만, 추후 같은 패턴의 새 thesis가 축적되면 새 learning으로 승격 가능 |
