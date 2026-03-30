# Plan: LATE_BULL 레짐 진입 감쇠 게이트

**이슈:** #508
**유형:** Lite (기존 게이트 패턴 확장)
**날짜:** 2026-03-30

---

## 문제 정의

90일 추천 14건(중복 제외 12건) 중 실질 승률 0%. 11건이 3/4~3/12 기간(LATE_BULL 레짐)에 진입했으며, 3/14에 EARLY_BEAR로 전환되면서 전수 실패.

**근본 원인:** `bearExceptionGate.ts`는 EARLY_BEAR/BEAR 레짐만 차단. LATE_BULL 레짐에서의 진입은 무제한 허용되어, 시장 과열 후기에 "Phase 2 말기" 종목에 진입하는 구조적 모순 발생.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| LATE_BULL 진입 | 무제한 허용 | RS 70+, SEPA A등급+, Phase 2 지속 5일+ 모두 충족해야 통과 |
| 게이트 구조 | Bear 레짐만 게이트 | Bear + Late Bull 레짐 게이트 |
| 통과 태그 | `[Bear 예외]` | + `[Late Bull 감쇠]` |
| 결과 카운터 | `blockedByRegime`, `bearExceptionCount` | + `blockedByLateBull`, `lateBullPassCount` |

## 골 정렬

**ALIGNED** — Phase 2 초입 포착이 목표인데, LATE_BULL에서 진입하면 Phase 2 "말기"에 진입하는 격. LATE_BULL 감쇠 게이트는 "초입이 아닌 탈출 직전 진입"을 구조적으로 차단하여 포착 정확도를 높인다.

## 무효 판정

**해당 없음** — LLM 백테스트가 아닌, 실제 90일 운영 데이터(14건 전수 실패) 기반. `bearExceptionGate.ts`와 동일 패턴 확장으로, 기존 검증된 구조 위에 구축.

## 변경 사항

### 1. `src/tools/lateBullGate.ts` (신규)

`bearExceptionGate.ts` 패턴 그대로 — 순수 평가 함수 + DB 조회 헬퍼.

**통과 조건 (3가지 AND):**
- RS ≥ 70 (기본 60보다 강화)
- SEPA 등급 A 이상 (S 또는 A)
- Phase 2 지속성 5일 이상 (기본 3일보다 강화)

**설계 근거:**
- RS 70: 기본 하한 60에서 10pt 강화. LATE_BULL에서는 "평균적 강세"가 아닌 "확실한 강세"만 허용
- SEPA A+: Bear 예외(S만 허용)보다 1단계 완화. LATE_BULL은 Bear보다 덜 위험하므로 A까지 허용
- Phase 2 지속 5일: Bear 예외와 동일 수준. "방금 Phase 2 진입"이 아닌 "안정적 Phase 2" 확인

**fail-closed 설계:** DB 조회 실패 시 진입 불허. 보수적 접근.

### 2. `src/tools/saveRecommendations.ts` (수정)

기존 Bear 게이트(Phase 1.5) 직후에 Late Bull 게이트(Phase 1.6) 삽입:
- `isLateBullRegime` 플래그 추가 (confirmed 레짐 == LATE_BULL)
- 개별 종목별 `evaluateLateBullGate()` 호출
- 통과 시 `[Late Bull 감쇠]` 태그, 실패 시 차단
- `blockedByLateBull`, `lateBullPassCount` 카운터 추가

### 3. 테스트

- `src/tools/__tests__/lateBullGate.test.ts`: 단위 테스트 (bearExceptionGate.test.ts 패턴)
- `src/tools/__tests__/saveRecommendations.test.ts`: LATE_BULL 통합 테스트 추가

## 작업 계획

1. `lateBullGate.ts` 작성 (bearExceptionGate.ts 패턴)
2. `saveRecommendations.ts`에 Late Bull 게이트 삽입
3. 단위 테스트 + 통합 테스트
4. README.md Feature Roadmap + docs/ROADMAP.md 업데이트
5. 커밋 + PR

## 리스크

- **위양성 차단:** RS 70 기준이 너무 높으면 LATE_BULL 초기 유효 종목도 차단 가능. 그러나 90일 데이터에서 LATE_BULL 진입 전수 실패이므로, 보수적 접근이 합리적.
- **기존 테스트 호환:** saveRecommendations의 pool.query mock 순서가 변경되지 않음 (Late Bull 게이트는 per-stock 평가이므로 기존 batch 쿼리에 영향 없음).
