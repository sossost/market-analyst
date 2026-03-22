# Plan: Phase 2 판정 관대 + 소형주 필터 부재 수정

> Closes #376

## 문제 정의

90일간 추천 14건 중 청산 완료 10건의 승률 0%. Phase Exit 6건 중 대부분이 1~2일 내 Phase 3 이탈.

**근본 원인 3가지:**
1. `PHASE_2_MIN_CONDITIONS = 6` — 소형 저가주의 높은 변동성과 결합하여 false positive Phase 2 판정
2. 가격/시가총액 하한선 부재 — EONR($1.53), DWSN($4.42) 등 극소형주가 추천 풀에 포함
3. Phase 2 지속성 미확인이 소프트 태깅만 — 하루짜리 Phase 2도 추천 가능

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| Phase 2 최소 조건 | 6/8 (early) | 7/8 (tighter) |
| 가격 하한선 | 없음 | $5 미만 하드 블록 |
| Phase 2 지속성 | 소프트 태깅 ([지속성 미확인]) | 하드 블록 (2일 미만 → 추천 차단) |

## 변경 사항

### 1. Phase 2 판정 강화 (`src/lib/phase-detection.ts`)
- `PHASE_2_MIN_CONDITIONS`: 6 → 7
- 근거: 6/8은 소형주에서 하루만에 조건 깨짐. 7/8은 최소한의 안정성 확보하면서도 초입 포착 가능

### 2. 저가주 하드 게이트 (`src/agent/tools/saveRecommendations.ts`)
- `MIN_PRICE = 5` 상수 추가 (`validation.ts`)
- entry_price < $5 종목 하드 블록 (소프트 태깅 아님)
- 근거: $5 미만은 penny stock 분류, 일일 변동성이 과도하여 Phase 2 판정 신뢰 불가

### 3. Phase 2 지속성 하드 블록 (`src/agent/tools/saveRecommendations.ts`)
- 기존: `phase2Count < MIN_PHASE2_PERSISTENCE_COUNT` → `[지속성 미확인]` 태깅만
- 변경: 하드 블록으로 전환, 추천 차단 + 카운터 추가
- 근거: 1일짜리 Phase 2는 false positive 확률 극도로 높음

## 작업 계획

1. `src/lib/phase-detection.ts` — 상수 변경
2. `src/agent/tools/validation.ts` — `MIN_PRICE` 상수 추가
3. `src/agent/tools/saveRecommendations.ts` — 저가주 게이트 + 지속성 하드 블록
4. 테스트 작성/수정
5. 기존 테스트 통과 확인

## 골 정렬

**ALIGNED** — Phase 2 주도섹터/주도주 "초입" 포착이 목표. 현재 false positive Phase 2가 승률 0%의 근본 원인. 진입 품질 필터 강화는 목표 달성의 필수 전제 조건.

## 무효 판정

**해당 없음** — LLM 백테스트, 과거 데이터 피팅 아님. 실제 청산 데이터 분석 기반의 구조적 필터 추가.

## 리스크

- Phase 2 조건 7/8로 강화 시 추천 건수 감소 가능 → 의도된 결과 (false positive 제거)
- $5 미만 필터로 일부 유효 소형주 제외 가능 → penny stock 리스크 대비 acceptable trade-off
- 지속성 하드 블록으로 빠른 Phase 1→2 전환 종목 놓칠 수 있음 → 2일 최소 기준은 충분히 관대
