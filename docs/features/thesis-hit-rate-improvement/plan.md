# Plan: short_term_outlook thesis 적중률 개선

## 문제 정의

90일 thesis 판정 결과:
- `short_term_outlook` 카테고리 적중률 47% (동전 던지기 수준)
- `sentiment` 에이전트 적중률 50%, `geopolitics` 에이전트 적중률 50%
- INVALIDATED 패턴: 방향성 예측 오판 (QQQ -7% 예측→반등, WTI $100 예측→미달, VIX 20 이하 예측→27)

핵심 원인: sentiment/geopolitics 에이전트가 구체적 가격/지수 목표치를 제시하는 방향성 예측에서 반복 실패.

## 골 정렬

- **판정**: ALIGNED
- **근거**: Phase 2 주도섹터/주도주 초입 포착이 시스템의 핵심 골. 47% 적중률의 short_term_outlook thesis가 섹터 로테이션 및 종목 선정에 영향을 미치면 노이즈가 시그널을 오염시킴. 이 개선은 시스템 전체 판단력 향상에 직결.

## 무효 판정

- **판정**: 해당 없음
- **근거**: LLM 백테스트가 아닌 실제 90일 thesis 판정 결과(DB 데이터)에 기반. 표본 크기 충분 (68건).

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| sentiment 프롬프트 | 방향성 예측 제한 없음 | 구체적 가격/지수 목표치 제시 금지, 조건부(if-then) 형식 강제 |
| geopolitics 프롬프트 | 섹터 RS 극단값 예측만 금지 | + 상품 가격 목표치 예측 금지 |
| 모더레이터 합의 가중치 | 에이전트별 적중률만 반영 | + 카테고리별 적중률 반영, 저적중 카테고리 할인 |
| 에이전트 캘리브레이션 | confidence별 적중률만 | + 카테고리별 적중률 피드백 추가 |

## 변경 사항

### 1. sentiment-analyst.md 프롬프트 강화
- 분석 규칙에 "방향성 예측 제한" 규칙 추가
- VIX/지수 등의 구체적 수치 목표 제시 금지
- 조건부(if-then) 형식 강제: "X이면 Y" 형태로만 단기 전망 제시

### 2. geopolitics.md 프롬프트 강화
- 상품 가격(WTI, 금, 구리 등) 목표치 예측 금지 규칙 추가
- 기존 "섹터 RS 극단값 예측 금지" 규칙과 일관성 유지

### 3. confidenceCalibrator.ts — 카테고리별 적중률 계산 및 피드백
- `calcCalibrationBinsForCategory()` 추가: category별 CONFIRMED/INVALIDATED 집계
- `buildCategoryCalibrationContext()` 추가: 모더레이터에게 전달할 카테고리별 적중률
- `buildEnhancedPerAgentCalibrationContexts()`에 에이전트별 카테고리 적중률 추가

### 4. round3-synthesis.ts — 모더레이터에 카테고리 성과 컨텍스트 전달
- `buildSynthesisPrompt()`에 카테고리별 적중률 컨텍스트 추가
- 저적중 카테고리(short_term_outlook) thesis 생성 시 경고 문구 삽입

### 5. 테스트
- confidenceCalibrator: 카테고리별 적중률 함수 단위 테스트
- round3-synthesis: 카테고리 컨텍스트 포함 확인

## 작업 계획

1. sentiment-analyst.md 프롬프트 수정
2. geopolitics.md 프롬프트 수정
3. confidenceCalibrator.ts — 카테고리별 적중률 함수 추가
4. memoryLoader 또는 debateEngine — 카테고리 적중률을 모더레이터에 전달
5. round3-synthesis — 모더레이터 프롬프트에 카테고리 성과 반영
6. 테스트 작성 및 실행

## 리스크

- **프롬프트 변경의 즉각적 효과 측정 어려움**: 프롬프트 변경은 다음 토론부터 적용되므로 효과는 30-90일 후 검증 가능
- **과도한 제약**: 방향성 예측을 완전히 차단하면 유효한 인사이트까지 억제할 수 있음 → 조건부 형식으로 허용하여 완화
