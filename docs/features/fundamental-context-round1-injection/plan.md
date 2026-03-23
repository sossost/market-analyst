# Plan: Fundamental Context Round 1 주입

## 문제 정의

`fundamentalContext`(SEPA 기반 실적 데이터)가 Round 3 모더레이터 합성에만 주입되어,
Round 1/2에서 전문가 4명이 EPS 가속·매출 성장·이익률 확대 등 핵심 지표 없이 토론한다.

결과적으로:
- 실적 부실 종목이 토론 합의에 포함될 가능성 높음
- 펀더멘탈 검증이 모더레이터 1명의 합성 능력에 전적으로 의존
- Phase 2 초입 포착의 핵심인 "기술적 전환 + 펀더멘탈 확인" 교차 검증 불가

## 골 정렬: ALIGNED

Phase 2 주도섹터/주도주 초입 포착의 핵심은 기술적 전환 + 펀더멘탈 확인의 교차 검증.
현재 Round 1/2에서 펀더멘탈이 누락되어 이 교차 검증이 구조적으로 불가능.
직접적으로 골 달성 품질을 개선하는 변경.

## 무효 판정: 해당 없음

LLM 백테스트, 무근거 숫자, 불필요한 제약 조건 등 무효 패턴 없음.
코드 변경은 기존 데이터 흐름에 컨텍스트 주입 경로를 추가하는 것뿐.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| Round 1 | 전문가가 실적 데이터 없이 분석 | 전문가가 fundamentalContext 참조 가능 |
| Round 2 | Round 1 기반 교차 검증 (실적 없음) | Round 1에 실적 반영 → 자연스럽게 Round 2에도 전파 |
| Round 3 | 모더레이터만 fundamentalContext 사용 | 동일 (기존 유지) |

## 변경 사항

### 1. `round1-independent.ts`
- `Round1Input` 인터페이스에 `fundamentalContext?: string` 추가
- 전문가 userMessage 조립 시 fundamentalContext를 question 뒤에 추가

### 2. `debateEngine.ts`
- `runRound1()` 호출 시 `fundamentalContext` 전달

### 3. 테스트
- Round 1 fundamentalContext 주입 테스트 추가

## 설계 결정

- **Round 2에는 직접 주입하지 않음**: Round 1 분석에 실적 데이터가 반영되면, Round 2 교차 검증에서 자연스럽게 실적 관점이 포함됨. Round 2에 별도로 주입하면 중복 컨텍스트로 토큰 낭비.
- **userMessage에 주입 (systemPrompt 아님)**: 실적 데이터는 매번 바뀌는 시장 데이터 성격이므로 system prompt가 아닌 user message에 추가하는 것이 적절. newsContext와 동일한 패턴.
- **XML 태그 래핑 유지**: Round 3에서 사용하는 `<fundamental-data>` 래핑을 Round 1에서도 동일하게 적용하여 일관성 유지.

## 작업 계획

1. `round1-independent.ts` — Round1Input에 fundamentalContext 추가 + userMessage 조립 로직 수정
2. `debateEngine.ts` — runRound1 호출에 fundamentalContext 전달
3. 테스트 작성 — Round 1 fundamentalContext 주입 검증
4. 기존 테스트 통과 확인

## 리스크

- **토큰 증가**: 전문가 4명 × fundamentalContext 크기만큼 입력 토큰 증가. 실적 데이터는 보통 10~20행의 마크다운 테이블이므로 영향 경미 (수백 토큰 수준).
- **기존 동작 변경 없음**: fundamentalContext가 없으면 (`undefined` 또는 빈 문자열) 기존과 동일하게 동작.
