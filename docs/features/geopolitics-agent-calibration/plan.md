# Plan: Geopolitics 에이전트 적중률 개선

## 문제 정의

Geopolitics 에이전트 적중률 40% (2/5) — 랜덤(50%) 미만. 3건 INVALIDATED 중 2건이 Energy 섹터 RS 방향 예측 실패. 같은 섹터에 상반된 예측을 내서 한쪽은 맞고 한쪽은 틀리는 패턴.

## 골 정렬: ALIGNED

"Phase 2 주도섹터/주도주 초입 포착" 목표에 직접 연결. 저적중 에이전트의 의견이 동일 가중치로 합의에 반영되면 잘못된 섹터에 자원이 집중됨.

## 무효 판정: 해당 없음

LLM 백테스트가 아닌 프롬프트 보정 + 가중치 전달. 기존 인프라(calibrationContext, agent-performance)를 활용한 확장.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| Per-agent 캘리브레이션 | confidence별 ECE만 표시 | 전체 적중률 + 최근 INVALIDATED thesis 포함 |
| Round 3 모더레이터 | 에이전트 가중치 없음 (동등 반영) | 에이전트별 적중률 테이블 수신, 저적중 에이전트 할인 지시 |
| 에이전트 자기 인식 | 과거 실패 패턴 미인지 | 최근 실패 thesis를 보고 반복 회피 |

## 변경 사항

### 1. `src/debate/confidenceCalibrator.ts` — Per-agent 캘리브레이션 강화

- `formatCalibrationForPrompt`에 전체 적중률 추가 (bins에서 산출)
- `loadRecentInvalidatedTheses(persona, limit)` 추가 — 최근 INVALIDATED thesis 조회
- `buildPerAgentCalibrationContexts`에 최근 실패 thesis 포함
- `buildModeratorPerformanceContext()` 추가 — 모더레이터에 전달할 에이전트별 적중률 요약

### 2. `src/debate/round3-synthesis.ts` — 모더레이터 가중치 전달

- `Round3Input`에 `agentPerformanceContext?: string` 추가
- `buildSynthesisPrompt`에 에이전트 성과 섹션 추가 (저적중 에이전트 할인 지시)

### 3. `src/debate/debateEngine.ts` — 파이프라인 연결

- `DebateConfig`에 `agentPerformanceContext?: string` 추가
- `runRound3` 호출 시 전달

### 4. `src/agent/run-debate-agent.ts` — 컨텍스트 빌드

- `buildModeratorPerformanceContext()` 호출
- `runDebate` config에 전달

### 5. 테스트

- `confidenceCalibrator` 신규 함수 단위 테스트
- `round3-synthesis` buildSynthesisPrompt에 성과 컨텍스트 반영 테스트

## 작업 계획

1. `confidenceCalibrator.ts` 수정 — 전체 적중률 + 실패 thesis + 모더레이터 컨텍스트
2. `round3-synthesis.ts` 수정 — 모더레이터 프롬프트에 성과 컨텍스트
3. `debateEngine.ts` + `run-debate-agent.ts` — 파이프라인 연결
4. 테스트 작성 + 실행
5. 커밋 + PR

## 리스크

- **프롬프트 길이 증가**: 에이전트당 최근 실패 3건 + 모더레이터에 4행 테이블 — 토큰 영향 미미 (~200 tokens)
- **DB 쿼리 추가**: 에이전트당 INVALIDATED 조회 1건 추가 — 4개 에이전트 병렬이므로 지연 무시 가능
- **모더레이터 할인 효과**: 프롬프트 기반이므로 100% 보장은 불가. 그러나 현재 가중치 0%보다 확실히 개선
