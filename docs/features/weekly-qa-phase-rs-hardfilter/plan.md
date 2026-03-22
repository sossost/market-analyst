# Plan: Phase/RS 하드필터 도입 (Issue #366)

## 문제 정의

주간 QA 점수 3/10. 분석 적중률 58%는 합격이나 실행 승률 17%로 낙제.
Phase Exit 6건이 수익을 전부 갉아먹는 구조적 문제.

**근본 원인**: `saveRecommendations`에서 Phase < 2, RS < 60 종목을 **태깅만** 하고 **차단하지 않음**.
LLM이 기준 미달 종목을 추천하면 `[기준 미달]` 태그만 붙여 저장 → Phase 2 이탈 시 손실 확정.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| Phase < 2 진입 | `[기준 미달]` 태그 후 저장 허용 | **하드 블록** (저장 차단) |
| RS < 60 진입 | `[기준 미달]` 태그 후 저장 허용 | **하드 블록** (저장 차단) |
| Phase 2 지속성 기준 | 최소 2일 | 최소 **3일** |
| `tagSubstandardReason` | 태깅 함수로 사용 | 하드 블록 이후 도달 불가 → 제거 |

## 변경 사항

### 1. `saveRecommendations.ts`
- Phase < 2 하드 블록 추가 (RS 과열 체크 직후, 저가주 체크 전)
- RS < MIN_RS_SCORE 하드 블록 추가
- `blockedByPhase`, `blockedByLowRS` 카운터 추가
- `tagSubstandardReason` 호출 제거 (하드 블록으로 대체되어 도달 불가)
- `MIN_PHASE2_PERSISTENCE_COUNT` 2 → 3 상향
- 응답 메시지에 새 카운터 포함

### 2. `validation.ts`
- 변경 없음 (MIN_PHASE, MIN_RS_SCORE 상수는 그대로 사용)

### 3. 테스트 업데이트
- Phase < 2 하드 블록 테스트 추가
- RS < 60 하드 블록 테스트 추가
- Phase 2 지속성 기준 3일로 변경된 테스트 수정
- 기존 `tagSubstandardReason` + 지속성 조합 테스트 수정

## 골 정렬

**ALIGNED** — "Phase 2 주도섹터/주도주 초입 포착" 목표와 직접 정렬.
Phase 2가 아닌 종목, RS가 약한 종목의 진입을 구조적으로 차단하여 Phase Exit 손실을 원천 제거.

## 무효 판정

**해당 없음** — LLM 백테스트, 과거 데이터 피팅 등 무효 패턴에 해당하지 않음.
실제 QA 데이터(승률 17%, Phase Exit 6건)에 기반한 구조적 필터 강화.

## 리스크

- **추천 빈도 감소**: 필터 강화로 추천 건수가 줄어들 수 있음. 그러나 "적게 추천하되 정확하게"가 현 시점 올바른 방향.
- **LLM 판단 무시**: LLM이 Phase 1→2 전환 초입을 포착해도 DB 기준 Phase 2 미달이면 차단됨. 이는 의도된 동작 — DB 팩트가 LLM 판단보다 우선.

## 작업 계획

1. `saveRecommendations.ts` 수정 (하드 블록 + 지속성 상향)
2. 테스트 추가/수정
3. 타입 체크 + 테스트 통과 확인
