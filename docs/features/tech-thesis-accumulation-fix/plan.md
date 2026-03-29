# Plan: tech thesis ACTIVE 적체 해소 — 검증 파이프라인 병목 수정

**이슈**: #502
**트랙**: Lite (버그픽스/파이프라인 개선)
**골 정렬**: ALIGNED — 학습 루프 정상화는 시스템 핵심 건강도 지표

## 문제 정의

tech 에이전트의 ACTIVE thesis 비율이 73% (16/22)로, 타 에이전트(24~50%) 대비 비정상적으로 높다.

**근본 원인 분석**:
1. **LLM 검증기의 HOLD 남발**: 진행률이 높아도 LLM이 HOLD를 반환하면 thesis가 ACTIVE로 잔류. 코드 레벨에서 HOLD를 제한하는 안전장치 없음.
2. **정량 조건 미파싱**: tech thesis의 targetCondition이 정량 파싱 불가한 형태(정성적 서술, 개별 종목 티커 등)로 생성되면 quantitativeVerifier가 skip → LLM 주관 판정 의존.
3. **모니터링 부재**: 에이전트별 ACTIVE 적체율을 추적하는 함수 없음.

**영향**:
- 학습 루프 정체: CONFIRMED/INVALIDATED 되어야 agent_learnings 반영
- 적중률 과대평가: 해소된 5건만 기준 (80%)
- 모더레이터 편향: readActiveTheses가 tech ACTIVE로 편향

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| 진행률 80%+ HOLD | ACTIVE 잔류 (무기한) | EXPIRED 강제 전환 |
| LLM 프롬프트 | HOLD 비권장 (가이드만) | 80%+ HOLD 명시 금지 |
| 정량 미파싱 경고 | 없음 | saveTheses 시 warn 로그 |
| 에이전트별 통계 | 없음 | getThesisStatsByPersona() |
| Round 3 tech 가이드 | 1줄 주의 | 결과 설명 포함 강화 |

## 변경 사항

### 1. `src/debate/thesisVerifier.ts`
- **HOLD 강제 만료**: LLM이 HOLD 반환 시 진행률 >= 80%면 EXPIRED 전환
- **프롬프트 강화**: "진행률 80% 이상 thesis는 HOLD 금지" 규칙 추가
- **반환값 확장**: `forceExpired` 카운트 추가

### 2. `src/debate/thesisStore.ts`
- **`forceExpireTheses()`**: ID 배열 기반 배치 EXPIRED 처리
- **`getThesisStatsByPersona()`**: 에이전트별 status 집계
- **`saveTheses()` 정량 파싱 검증**: 저장 시 targetCondition 파싱 가능 여부 warn 로그

### 3. `src/debate/round3-synthesis.ts`
- tech thesis 정량 조건 가이드 강화: 미파싱 시 학습 루프 반영 불가 경고 추가

### 4. 테스트
- HOLD 강제 만료 로직 단위 테스트
- getThesisStatsByPersona() 단위 테스트
- saveTheses() 정량 파싱 경고 테스트

## 리스크

1. **기존 thesis 일괄 처리 없음**: 이 PR은 로직만 변경. 기존 16건 ACTIVE thesis는 다음 검증 사이클에서 자연 처리됨.
2. **적중률 하락 가능**: 강제 만료로 EXPIRED 증가 → 적중률 분모 변화. 이는 실제 성능 반영이므로 정상.
3. **LLM 비결정론**: 프롬프트 강화에도 LLM이 HOLD를 반환할 수 있음 → 코드 레벨 안전장치로 보완.

## 무효 판정

- 이 변경이 무효가 되는 조건: tech thesis가 정량 조건을 잘 생성하고 있고, 적체 원인이 단순히 timeframe 미초과인 경우.
- 진단 근거: 73% 적체율은 다른 에이전트 대비 2~3배이므로 구조적 문제가 있을 개연성이 높음. 코드 레벨 안전장치 추가는 부작용 없이 방어적.
