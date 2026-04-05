# Plan: short_term_outlook 카테고리 가드레일 강화

## 문제 정의

90일간 thesis 카테고리별 적중률 분석 결과, **short_term_outlook 카테고리 적중률이 41.7%**(10/24)로 50% 미만 역신호.
이미 sentiment/macro/geopolitics는 해당 카테고리 차단됨(#561, #563). **tech만 생산 가능**하지만 여전히 역신호.

Phase 2 철학 "언제(타이밍)"가 아닌 "무엇(구조적 변화)"과 정합 — 단기 전망 카테고리 자체가 시스템에 해로움.

## 골 정렬

- **ALIGNED** — Phase 2 초입 포착 시스템의 핵심 가치("구조적 변화 포착")와 직접 정합
- 역신호 카테고리를 억제하면 전체 thesis 품질 향상

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| tech의 short_term_outlook confidence | LLM이 high/medium/low 자유 설정 | 시스템이 강제 `low`로 다운그레이드 |
| short_term_outlook 발행 건수 | 제한 없음 (tech가 여러 건 가능) | 세션당 최대 1건 (초과분 드롭) |
| 프롬프트 안내 | 규칙은 있으나 강제 없음 | 1건 제한 + low 강제 명시 |

## 변경 사항

### 1. 카테고리 기반 confidence 강제 하향 (`round3-synthesis.ts`)

`normalizeThesisFields()`에 카테고리 기반 다운그레이드 추가:
- `CONFIDENCE_DOWNGRADE_CATEGORIES = new Set(["short_term_outlook"])`
- short_term_outlook 카테고리 thesis → confidence 강제 `low`
- 기존 페르소나 기반 다운그레이드 이후에 적용 (순서 독립적이나 가독성 위해)

### 2. 세션당 발행 건수 제한 (`round3-synthesis.ts`)

`filterShortTermOutlookCap()` 함수 신설:
- short_term_outlook 카테고리 thesis를 세션당 최대 1건으로 제한
- 2건 이상이면 첫 번째만 유지, 나머지 드롭 + 로그
- `extractThesesFromText()`와 `extractDebateOutput()` 양쪽 파이프라인에 적용

### 3. 프롬프트 업데이트 (`round3-synthesis.ts`)

`buildSynthesisPrompt()`의 short_term_outlook 섹션에 추가:
- "시스템이 confidence를 자동으로 low로 다운그레이드합니다"
- "세션당 최대 1건만 저장됩니다"

### 4. 테스트 (`thesis-category-filter.test.ts`)

- 카테고리 기반 confidence 다운그레이드 테스트 (tech high→low, tech medium→low)
- 세션당 1건 제한 테스트 (2건 → 1건 유지)
- 기존 테스트 호환성 확인

## 리스크

- **low confidence thesis downstream 영향**: low confidence thesis가 이미 리포트에서 정상 표시됨 (⚪ 아이콘). 차단이 아닌 약화이므로 정보 손실 최소.
- **tech 에이전트 thesis 감소**: tech가 short_term_outlook 대신 sector_rotation이나 structural_narrative로 분류할 가능성. 이는 오히려 바람직한 방향.

## 무효 판정

- **PASS** — 역신호(41.7%) 카테고리에 대한 직접적 대응. 오버엔지니어링 아님.
