# Plan: geopolitics medium confidence 캘리브레이션

## 문제 정의

geopolitics 에이전트의 medium confidence thesis 적중률이 25% (1/4)로, 기대 적중률 60%를 크게 하회.
high confidence는 100% (1/1)로 양호하나, medium에서 체계적으로 실패.

현재 시스템의 구조적 문제:
1. **캘리브레이션이 전체 에이전트 합산** — 각 에이전트가 자기 성적을 모름
2. **geopolitics 프롬프트에 medium confidence 기준 부재** — 정량 근거 없이 medium 부여 가능

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| 캘리브레이션 | 전체 합산만 피드백 | **에이전트별** 캘리브레이션 피드백 |
| geopolitics medium 기준 | 없음 | 정량 지표 1개+ 근거 필수 규칙 |
| 최소 데이터 기준 (per-agent) | N/A (전체 20건) | 에이전트별 5건 |

## 변경 사항

### 1. geopolitics 프롬프트 (`.claude/agents/geopolitics.md`)
- 규칙 9 추가: medium confidence 제출 시 정량 지표(가격, RS, 관세율, 정책 Stage 등) 1개 이상 근거 필수
- 근거 없으면 low로 하향하거나 제출 보류

### 2. confidenceCalibrator.ts — per-agent 캘리브레이션
- `calcCalibrationBinsForPersona(persona)`: agentPersona 필터링 쿼리
- `getCalibrationResultForPersona(persona)`: per-agent CalibrationResult (최소 5건)
- `formatCalibrationForPrompt()` 재사용 (동일 포맷)

### 3. run-debate-agent.ts — per-agent 캘리브레이션 주입
- 전체 합산 캘리브레이션 → per-agent 캘리브레이션으로 교체
- `Record<string, string>` (persona → calibration prompt) 생성

### 4. debateEngine.ts + round1-independent.ts — per-agent 컨텍스트 전달
- `DebateConfig`에 `calibrationContext?: Record<string, string>` 추가
- Round 1에서 각 에이전트 시스템 프롬프트에 자기 캘리브레이션 주입

## 골 정렬

**SUPPORT** — thesis 적중률 개선은 리포트 전망 품질을 높이고, Phase 2 포착 판단의 노이즈를 줄인다.

## 무효 판정

해당 없음. 프롬프트 캘리브레이션은 LLM 백테스트가 아니라 운영 품질 개선.

## 리스크

- per-agent 데이터가 5건 미만이면 피드백 미생성 → 영향 없음 (안전 장치)
- 프롬프트 규칙 추가로 geopolitics가 thesis 제출을 과도하게 보류할 가능성 → ACTIVE 9건 결과로 모니터링
