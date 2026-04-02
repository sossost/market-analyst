# Plan: short_term_outlook 학습 루프 노이즈 제거

## 문제 정의

90일간 `short_term_outlook` thesis가 전체의 51%(41/80)를 차지하면서 적중률 39.1%(EXPIRED 포함 시 28.1%)로 학습 루프에 노이즈를 주입하고 있다.

- #561에서 sentiment 에이전트의 short_term_outlook만 차단했으나, macro/geopolitics도 동일 패턴
- EXPIRED 9건이 적중률 계산에서 제외되어 실질 적중률이 과대 표시됨

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| 적중률 공식 | CONFIRMED / (CONFIRMED + INVALIDATED) | CONFIRMED / (CONFIRMED + INVALIDATED + EXPIRED) |
| short_term_outlook 차단 | sentiment만 | sentiment + macro + geopolitics (전 에이전트) |
| EXPIRED 처리 | 적중률 분모 제외 | 적중률 분모 포함 (실패로 간주) |
| short_term_outlook 적중률 | 39.1% (과대) | 28.1% (실질) |

## 변경 사항

### P0: EXPIRED 적중률 반영

**`src/lib/agent-performance.ts`**
- `calculateAgentPerformance()`: `resolved = confirmed + invalidated + expired`로 변경
- byConfidence 내부도 동일하게 expired 포함

**`src/debate/confidenceCalibrator.ts`**
- `PersonaHitRate`, `CategoryHitRate`, `PersonaCategoryHitRate` 인터페이스에 `expired: number` 추가
- `getPerAgentHitRates()`: WHERE절에 EXPIRED 포함, expired 카운트 추가
- `getCategoryHitRates()`: 동일
- `getPersonaCategoryHitRates()`: 동일
- `formatModeratorPerformanceContext()`: 만료 컬럼 추가, 공식 설명 변경
- `formatCategoryHitRateContext()`: 만료 컬럼 추가
- `formatPersonaCategoryHitRates()`: 만료 컬럼 추가, 유효 데이터 기준 변경

### P1: short_term_outlook 생성 억제 확대

**`src/debate/round3-synthesis.ts`**
- `ALLOWED_CATEGORIES_PER_PERSONA`: macro, geopolitics 추가 (structural_narrative, sector_rotation만 허용)

**`.claude/agents/macro-economist.md`**
- 카테고리 제한 규칙 추가 (sentiment 패턴 동일)

**`.claude/agents/geopolitics.md`**
- 카테고리 제한 규칙 추가 (sentiment 패턴 동일)

### 범위 밖

- calibration bins (`calcCalibrationBins`) — 별도 관심사 (confidence 캘리브레이션)
- `thesisStore.ts`의 `getConfidenceHitRates()` — CEO 리포트용 정보성 쿼리
- `sector_rotation` (62.5%) — Phase 2 주도섹터 포착에 기여, 건드리지 않음
- 카테고리별 quota — P0+P1으로 short_term_outlook 자체가 억제되면 불필요

## 작업 계획

1. **P0**: agent-performance.ts hitRate 공식 변경 + 테스트 업데이트
2. **P0**: confidenceCalibrator.ts 인터페이스/쿼리/포맷 함수 변경 + 테스트 업데이트
3. **P1**: round3-synthesis.ts ALLOWED_CATEGORIES_PER_PERSONA 확장
4. **P1**: macro-economist.md, geopolitics.md 프롬프트 규칙 추가
5. 전체 테스트 실행 + 커버리지 확인

## 리스크

| 리스크 | 대응 |
|--------|------|
| EXPIRED 포함으로 기존 적중률 수치 하락 | 의도된 변경. 실질 적중률 반영이 목적 |
| macro/geopolitics의 유효한 단기 전망도 차단 | structural_narrative/sector_rotation으로 재분류됨 (fallback) |
| promote-learnings와의 일관성 | 이미 EXPIRED를 부정 신호로 처리 중 (line 190) — 이번 변경으로 정합성 확보 |
| structural_narrative (91%) 영향 | 변경 범위를 short_term_outlook 카테고리/적중률 공식으로 한정 — 무관 |

## 골 정렬

- **ALIGNED**: 학습 루프(agent_learnings)는 thesis 적중률로 에이전트 성향을 교정함. 39% 적중률 thesis가 절반을 차지하면 학습 루프에 노이즈가 주입. 이번 변경으로 적중률 정확도 향상 + 저적중 thesis 생성 억제 → 학습 루프 품질 직접 개선.

## 무효 판정

- **해당 없음**: 기존 시스템과의 간섭 없음. promote-learnings.ts는 이미 EXPIRED를 부정으로 처리하므로 정합성만 개선됨.
