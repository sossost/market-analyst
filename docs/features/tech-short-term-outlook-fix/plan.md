# Plan: Tech 에이전트 short_term_outlook 가격 목표 thesis 차단

## 문제 정의

Tech 에이전트가 short_term_outlook 카테고리에서 구체적 가격 목표 thesis를 남발하고 있다.
EXPIRED 10건 중 8건이 tech + short_term_outlook이며, 패턴은 "$X → $Y 목표가", "N% 상승", "ETF X가 Y% 상승" 형태.

**근본 원인**: 기존 가드레일이 tech 에이전트의 가격 목표 패턴을 잡지 못한다.
- `filterNumericPredictions`: sentiment 에이전트 전용 (VIX/F&G/RS 패턴)
- 프롬프트 금지 패턴: VIX/심리지표 중심, 가격 목표/% 상승 패턴 미포함
- tech 에이전트 프롬프트: short_term_outlook에 대한 가이드라인 부재

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| tech short_term_outlook | 가격 목표 thesis 생성 가능 (코드 필터 없음) | 가격 목표 패턴 자동 드롭 |
| tech-analyst.md | short_term_outlook 가이드라인 없음 | 구조적 전환 신호로 유도, 가격 예측 금지 |
| 합성 프롬프트 | tech 가격 목표 금지 패턴 미포함 | tech 전용 금지 패턴 추가 |

## 변경 사항

### 1. 코드: `src/debate/round3-synthesis.ts`
- `TECH_PRICE_TARGET_PATTERNS` 정규식 배열 추가
  - `$N`, `$N → $N`, `N% 상승/하락`, `목표가`, `목표 가격` 패턴
- `containsPriceTarget()` 순수 함수 추가 (export, 테스트 가능)
- `filterTechPriceTargets()` 함수 추가 — tech + short_term_outlook thesis에서 가격 목표 패턴 드롭
- `extractThesesFromText` 파이프라인에 삽입 (filterNumericPredictions 뒤)

### 2. 프롬프트: `.claude/agents/tech-analyst.md`
- "분석 규칙" 섹션에 short_term_outlook thesis 가이드라인 추가
- 금지: 구체적 가격/% 목표
- 허용: 기술 채택 가속, capex 사이클 전환, 밸류체인 병목 해소 등 구조적 전환 신호

### 3. 합성 프롬프트: `src/debate/round3-synthesis.ts` (buildSynthesisPrompt)
- "short_term_outlook 범위 제한" 금지 패턴에 tech 전용 예시 추가

### 4. 테스트: `src/debate/__tests__/thesis-category-filter.test.ts`
- `containsPriceTarget` 패턴 검출 테스트
- `filterTechPriceTargets` 통합 테스트 (extractThesesFromText 경유)

## 리스크

- **프롬프트 무시 가능성**: LLM이 프롬프트 지침을 무시할 수 있음 → 코드 레벨 가드레일로 이중 차단
- **과도한 필터링**: 정상적인 tech thesis가 잘못 드롭될 수 있음 → structural_narrative/sector_rotation은 필터 대상 아님, short_term_outlook만 적용
- **기존 thesis 영향 없음**: 향후 생성분부터 적용

## 골 정렬

- ALIGNED: thesis 적중률 향상 → 프로젝트 KPI (hit rate 50%+) 직접 기여
- structural_narrative (93% 적중률)은 절대 건드리지 않음
