# Plan: 조기포착 도구 결과 → 토론 에이전트 주입

## 문제 정의

조기포착 도구 3종(`getPhase1LateStocks`, `getRisingRS`, `getFundamentalAcceleration`)이 존재하지만,
토론 파이프라인과 연결되지 않아 전문가들은 "이미 Phase 2인 종목"만 보고 토론한다.
결과적으로 시스템 추천이 RS 97-100인 "후기 Phase 2" 종목에 집중되며,
프로젝트 골인 "남들보다 먼저 포착"이 달성되지 않는 구조적 문제.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| Round 1 입력 | Phase 2 확정 종목 + SEPA 펀더멘탈만 | + Phase1Late/RisingRS/펀더멘탈가속 후보 |
| Round 3 입력 | 동일 | + 조기포착 후보 (모더레이터 검증용) |
| 전문가 인식 | "곧 Phase 2 전환될 종목" 인지 불가 | 조기포착 후보를 명시적으로 평가 |
| thesis 범위 | 후기 Phase 2 집중 | pre-Phase 2 후보까지 커버 |

## 변경 사항

### 1. 새 모듈: `src/debate/earlyDetectionLoader.ts`
- `loadEarlyDetectionContext(date: string): Promise<string>` 함수
- 내부에서 3개 도구의 DB 쿼리 함수를 직접 호출 (AgentTool.execute가 아닌 repository 함수)
- 결과를 `<early-detection>` XML 태그로 래핑한 텍스트 반환
- 각 카테고리별 상위 10개로 제한 (토큰 절약)

### 2. `src/agent/run-debate-agent.ts` 수정
- `loadEarlyDetectionContext(debateDate)` 호출 추가
- `runDebate()` 호출 시 `earlyDetectionContext` 전달

### 3. `src/debate/debateEngine.ts` 수정
- `DebateConfig` 인터페이스에 `earlyDetectionContext?: string` 추가
- Round 1, Round 3에 전달

### 4. `src/debate/round1-independent.ts` 수정
- `Round1Input`에 `earlyDetectionContext?: string` 추가
- fundamentalContext 뒤에 `<early-detection>` 블록 주입

### 5. `src/debate/round3-synthesis.ts` 수정
- `Round3Input`에 `earlyDetectionContext?: string` 추가
- `buildSynthesisPrompt`에 조기포착 섹션 추가

## 작업 계획

1. `earlyDetectionLoader.ts` 작성 + 단위 테스트
2. `debateEngine.ts` 인터페이스 확장
3. `round1-independent.ts` 주입 로직 추가 + 테스트 확장
4. `round3-synthesis.ts` 주입 로직 추가
5. `run-debate-agent.ts`에서 로더 호출 + 파이프라인 연결
6. 기존 테스트 통과 확인

## 리스크

| 리스크 | 영향 | 대응 |
|--------|------|------|
| 토큰 증가 | 비용 상승 | 카테고리별 top 10 제한, 간결한 포맷 |
| DB 쿼리 실패 | 토론 중단 | try-catch로 격리, 빈 문자열 폴백 |
| 프롬프트 과부하 | LLM 품질 저하 | XML 태그 분리, 핵심 필드만 포함 |

## 골 정렬

- **판정: ALIGNED**
- 프로젝트 골 "Phase 2 주도섹터/주도주 초입 포착"에 직접 기여
- 조기포착 도구의 ROI를 0 → 실질적 활용으로 전환

## 무효 판정

- **해당 없음** — LLM 백테스트, 과적합 등 무효 패턴 해당하지 않음
- 실제 DB 데이터를 프롬프트에 주입하는 구조적 개선
