# Plan: Debate Agent 레짐 태깅 — rationale과 판정 모순 방지

## 문제 정의

Round3 Moderator가 레짐 판정 시 **이전 확정 레짐 컨텍스트를 전혀 받지 못한다.**
결과: rationale에 "극단적 공포", "EARLY_BEAR 임계점 근접"이라 쓰면서 LATE_BULL을 태깅하는 모순 발생.
히스테리시스(`applyHysteresis`)가 사후적으로 비허용 전환을 차단하지만, LLM 오판 자체를 줄이지는 못한다.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| 이전 확정 레짐 | 프롬프트에 없음 | 프롬프트에 레짐명 + 확정일 + 경과일수 주입 |
| 허용 전환 경로 | LLM이 모름 | ALLOWED_TRANSITIONS 매트릭스를 프롬프트에 포함 |
| 초기 상태 | N/A | "확정된 레짐 없음 — 제약 없이 판정" 명시 |

## 변경 사항

### 1. `round3-synthesis.ts` — 프롬프트에 이전 확정 레짐 + 전환 매트릭스 주입

- `buildSynthesisPrompt` 시그니처에 `regimeContext?: string` 파라미터 추가
- 레짐 판정 섹션(L373~396) 앞에 이전 레짐 컨텍스트 블록 삽입
- `runRound3`에서 `loadConfirmedRegime()` 호출 → 컨텍스트 문자열 생성 → `buildSynthesisPrompt`에 전달

### 2. `round3-synthesis.ts` — 레짐 컨텍스트 포매터 함수

- `formatRegimeContext(regime: MarketRegimeRow | null, today: string): string`
  - regime이 null이면: "현재 확정된 레짐이 없습니다. 제약 없이 판정하세요."
  - regime이 있으면: 확정 레짐명, 확정일, 경과일수, 허용 전환 경로를 간결하게 포매팅

### 3. 테스트

- `buildSynthesisPrompt`에 `regimeContext`가 주어지면 프롬프트에 포함되는지 검증
- `formatRegimeContext` — null 케이스, 정상 케이스 검증

## 작업 계획

1. `formatRegimeContext` 함수 작성
2. `buildSynthesisPrompt`에 `regimeContext` 파라미터 추가 + 프롬프트에 삽입
3. `runRound3`에서 `loadConfirmedRegime` → `formatRegimeContext` → `buildSynthesisPrompt` 연결
4. 단위 테스트 추가
5. 기존 테스트 통과 확인

## 리스크

- **프롬프트 토큰 증가**: 최대 10줄 이내로 제한. 전체 프롬프트 대비 무시 가능.
- **초기 상태**: DB에 confirmed 레코드가 없을 때 "제약 없음" 명시로 안전 처리.
- **기존 테스트**: `buildSynthesisPrompt` 시그니처 변경은 optional param이므로 기존 테스트 호환.

## 골 정렬

- **ALIGNED** — 레짐 판정 정확도는 리포트 품질의 핵심 축. rationale-regime 모순은 리포트 신뢰도를 직접 훼손.

## 무효 판정

- 해당 없음 (버그 수정, 새로운 기능 아님)
