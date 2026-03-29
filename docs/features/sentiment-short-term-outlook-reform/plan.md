# Plan: sentiment 에이전트 short_term_outlook 방향성 예측 구조 개편

**이슈**: #501
**트랙**: Lite (구조적 버그 수정 — 의사결정 불필요)
**날짜**: 2026-03-30

## 문제 정의

sentiment 에이전트 적중률 40% (6 confirmed / 15 invalidated) — 50% 미만으로 실질 노이즈.
주요 원인: `short_term_outlook` 카테고리 방향성 예측의 반복 실패.

**현재 대응의 한계:**
- 프롬프트 규칙 (sentiment-analyst.md rule 7, 8) → LLM이 규칙 무시하고 방향성 예측 계속 생성
- 모더레이터 할인 (confidenceCalibrator.ts:522) → 사후 할인은 이미 생성된 저품질 thesis를 제거하지 못함
- 카테고리 경고 (formatCategoryHitRateContext) → 경고만으로는 생성 자체를 막지 못함

**핵심 문제**: 프롬프트 레벨 규칙만으로는 LLM의 방향성 예측 생성을 차단할 수 없음. 코드 레벨 하드 필터 필요.

## 골 정렬

**판정: SUPPORT**

Phase 2 주도섹터/주도주 초입 포착이 핵심 골. sentiment의 저적중 short_term_outlook thesis가 모더레이터 합의를 오염시키면 → 전체 토론 품질 저하 → 주도섹터 판단 정확도 하락. 이 수정은 토론 품질의 신호 대 잡음비(SNR)를 직접 개선한다.

## 무효 판정

**해당 없음**. LLM 백테스트, 미래 예측 등 무효 패턴에 해당하지 않음. 실제 90일 적중률 데이터(15건 resolved) 기반의 구조적 개선.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| sentiment의 thesis 카테고리 | 제한 없음 (short_term_outlook 생성 가능) | structural_narrative, sector_rotation만 허용 |
| short_term_outlook thesis 처리 | 모더레이터가 자유롭게 생성 | 코드 레벨에서 sector_rotation으로 자동 재분류 |
| sentiment 프롬프트 역할 | 방향성 예측 포함 (rule 8로 제한 시도) | 포지셔닝/자금 흐름 구조 분석 전문 |
| 모더레이터 프롬프트 | 카테고리 제한 규칙 없음 | sentiment의 허용 카테고리 명시 |

## 변경 사항

### 1. 코드 레벨 하드 필터 — `src/debate/round3-synthesis.ts`

`normalizeThesisFields()` 함수에 페르소나별 허용 카테고리 맵 추가:

```typescript
const ALLOWED_CATEGORIES_PER_PERSONA: Partial<Record<AgentPersona, Set<ThesisCategory>>> = {
  sentiment: new Set(["structural_narrative", "sector_rotation"]),
};
```

- sentiment의 `short_term_outlook` → `sector_rotation`으로 자동 재분류
- 다른 에이전트는 제한 없음 (맵에 없으면 모든 카테고리 허용)
- 재분류 시 logger.info로 기록

**왜 필터링(삭제)이 아닌 재분류인가?**
- thesis 자체에 유용한 정보(포지셔닝 분석 등)가 포함될 수 있음
- 삭제는 정보 손실, 재분류는 정보 보존 + 카테고리 교정

### 2. 프롬프트 업데이트 — `.claude/agents/sentiment-analyst.md`

Rule 8 "방향성 예측 제한" 교체:
- 기존: 조건부 형식 요구, confidence 하향 — 간접적 제한 (실패)
- 변경: 카테고리 명시적 제한 + 역할 재정의
  - "당신의 thesis는 structural_narrative 또는 sector_rotation 카테고리로만 분류됩니다"
  - "short_term_outlook은 시스템에서 자동 차단됩니다"
  - 역할 강조: 방향성 예측이 아닌 포지셔닝 과밀/자금 흐름 구조 분석

### 3. 모더레이터 프롬프트 — `src/debate/round3-synthesis.ts`

카테고리 분류 기준 섹션에 규칙 추가:
- "sentiment 에이전트의 thesis는 structural_narrative 또는 sector_rotation만 허용됩니다"
- "sentiment의 방향성 예측(지수 목표치, VIX 하락 예측 등)은 thesis로 추출하지 마세요"

### 4. 테스트 — `src/debate/__tests__/round3-synthesis.test.ts`

- `normalizeThesisFields`의 sentiment + short_term_outlook 재분류 검증
- 다른 에이전트의 short_term_outlook은 변경 없음 검증

## 작업 계획

1. `round3-synthesis.ts` — 하드 필터 구현 + 모더레이터 프롬프트 수정
2. `sentiment-analyst.md` — 역할 재정의
3. 테스트 작성 및 통과 확인
4. 커밋 + PR

## 리스크

| 리스크 | 대응 |
|--------|------|
| 재분류된 thesis가 sector_rotation에 부적합 | sector_rotation은 sentiment의 자금 흐름/로테이션 분석과 자연스럽게 매핑됨 |
| 프롬프트 변경으로 sentiment 분석 품질 변화 | 코드 필터가 최종 방어선 — 프롬프트 변경은 보조적 |
| 기존 ACTIVE thesis에 영향 | 영향 없음 — 새로 생성되는 thesis에만 적용 |
