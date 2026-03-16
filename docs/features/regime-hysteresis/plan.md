# 시장 레짐 히스테리시스

## 선행 맥락

`docs/features/market-regime/01-spec.md` (2026-03-08):
- 레짐 시스템 Phase 1에서 LLM 정성 태깅 방식을 채택할 때, RFC 리스크 메모로 "초기에는 참고 정보로만 사용, 자동 행동 조정은 충분한 검증 후"를 명시함
- 즉, 안정화 메커니즘 없이 LLM 판정을 직접 노출한 것은 설계 당시부터 알고 있던 위험을 임시 수용한 상태였음

이번 이슈(#267)는 그 위험이 실제로 발현된 사례: 5일 4단계 변경.

## 골 정렬

ALIGNED — Phase 2 초입 포착의 전제조건은 시장 국면 판단의 안정성이다.

레짐이 매일 뒤집히면 행동 지침이 무력화되고, EARLY_BEAR 레짐에서도 신규 추천이 생성되는 현 상황은 레짐 시스템 자체가 기능 불량임을 의미한다. 히스테리시스로 레짐 안정성을 확보하는 것이 주도주 포착 알파의 직접 기반이다.

## 문제

LLM이 매일 독립적으로 레짐을 판정한다. 전날 판정을 고려하지 않으므로 당일 시장 데이터에 과잉 반응하여 레짐이 연속으로 바뀐다. 히스테리시스(이력 현상) 없이 입력만으로 출력을 결정하는 구조 자체가 근본 원인이다.

## Before → After

**Before**
- `run-debate-agent.ts`에서 토론 완료 즉시 `saveRegime(debateDate, validated)` 호출
- LLM이 당일 판정한 레짐이 그대로 DB에 확정 기록됨 (히스테리시스 없음)
- `formatRegimeForPrompt`는 항상 최신 레짐을 "현재 레짐"으로 주입
- 5일간 4단계 변경처럼 진동해도 시스템이 인식하지 못함

**After**
- 새 레짐 판정은 즉시 확정하지 않고 `is_confirmed = false` 상태로 보류(pending) 저장
- N일 연속 동일 판정이 축적되면 비로소 `is_confirmed = true`로 확정
- 확정 전까지는 직전 확정 레짐이 행동 지침에 계속 사용됨
- 판정 요청 프롬프트에 최근 N일 레짐 히스토리를 주입하여 LLM이 컨텍스트 인지 상태로 판정

## 현재 레짐 판정 흐름

```
run-debate-agent.ts (main)
  │
  ├── runDebate() → round3-synthesis.ts → buildSynthesisPrompt()
  │     LLM이 프롬프트 내 "시장 레짐 판정" 섹션을 보고
  │     {"marketRegime": {"regime": "...", "rationale": "...", "confidence": "..."}} 반환
  │
  ├── extractDebateOutput() → extractMarketRegime() 파싱
  │
  ├── validateRegimeInput() → 유효성 검증
  │
  └── saveRegime(debateDate, validated) → market_regimes INSERT/UPSERT
        regime_date UNIQUE → 하루 한 건, 즉시 확정 저장
```

`formatRegimeForPrompt()` → 주간 에이전트나 일간 에이전트 프롬프트에 주입 시
최신 1건을 "현재 레짐"으로 사용.

LLM이 레짐 판정 시 이전 레짐을 참고하지 않는 것은 아님. `formatRegimeForPrompt`에서
최근 14일 히스토리가 프롬프트에 포함된다. 문제는 그것이 "참고 텍스트"일 뿐이며,
저장 로직에는 연속 판정 확인 과정이 전혀 없다는 것이다.

## 변경 사항

### DB 스키마 변경

**`market_regimes` 테이블에 컬럼 추가:**

```sql
ALTER TABLE market_regimes
  ADD COLUMN is_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN confirmed_at text;  -- 확정일 (YYYY-MM-DD)
```

- `is_confirmed = false`: 당일 LLM 판정 결과 (pending)
- `is_confirmed = true`: N일 연속 동일 판정 후 확정된 레짐
- `confirmed_at`: 레짐이 확정된 날짜 (디버깅/분석용)

기존 레코드는 모두 `is_confirmed = true`로 마이그레이션 (과거 데이터 유지).

인덱스 추가: `idx_market_regimes_confirmed` ON `(is_confirmed, regime_date DESC)`

### 히스테리시스 로직 설계

**핵심 파라미터:**
- `CONFIRMATION_DAYS = 2`: 동일 레짐 2일 연속 → 확정. (3일은 너무 느리고, 1일은 무의미)

**판정 흐름:**

```
매일 LLM이 새 레짐 판정 → saveRegimePending(date, newRegime)
  │
  ├── 오늘 pending 저장 (is_confirmed = false)
  │
  └── applyHysteresis(date) 호출
        │
        ├── 최근 CONFIRMATION_DAYS일의 pending 레짐 조회
        │     (오늘 포함, 최신 N건 DESC)
        │
        ├── 모든 레짐이 동일한가?
        │     YES → 최신 pending 레코드를 is_confirmed = true, confirmed_at = 오늘로 업데이트
        │             이전 확정 레짐이 다른 값이면 로그: "레짐 전환 확정: OLD → NEW"
        │     NO  → pending 유지. 확정 레짐 변경 없음.
        │
        └── 현재 확정 레짐 반환 (다음 프롬프트 주입용)
```

**엣지 케이스:**
- 데이터 부족(첫 날 등): pending 레코드가 CONFIRMATION_DAYS보다 적으면 첫 판정을 즉시 확정 처리
- LLM 판정 실패(validateRegimeInput null): pending 저장 자체를 건너뜀. 이전 확정 레짐 유지.
- 확정 레짐이 존재하지 않는 경우(초기): 첫 pending 레코드를 즉시 확정

**롤백 조건은 별도로 두지 않는다.** 단방향으로 충분하다. 레짐이 바뀌더라도 CONFIRMATION_DAYS 동안 새 레짐이 연속되면 자연스럽게 전환된다.

### 코드 변경

**1. `src/db/schema/analyst.ts`**

`marketRegimes` 테이블에 `isConfirmed`, `confirmedAt` 컬럼 추가.

**2. `src/agent/debate/regimeStore.ts`**

기존 `saveRegime` 함수를 두 단계로 분리:

```typescript
// pending 저장 (LLM 판정 직후)
export async function saveRegimePending(
  date: string,
  input: MarketRegimeInput,
): Promise<void>

// 히스테리시스 적용: 연속 판정 확인 후 확정 처리
// 확정된 레짐 반환 (없으면 null)
export async function applyHysteresis(
  date: string,
): Promise<MarketRegimeRow | null>

// 현재 확정 레짐 조회 (is_confirmed = true 최신 1건)
export async function loadConfirmedRegime(): Promise<MarketRegimeRow | null>

// 기존 loadLatestRegime → loadConfirmedRegime으로 교체 (호출부 수정)
// loadRecentRegimes는 confirmed만 반환하도록 WHERE is_confirmed = true 추가
```

**3. `src/agent/run-debate-agent.ts`**

```typescript
// 변경 전
if (result.marketRegime != null) {
  const validated = validateRegimeInput(result.marketRegime);
  if (validated != null) {
    await saveRegime(debateDate, validated);
  }
}

// 변경 후
if (result.marketRegime != null) {
  const validated = validateRegimeInput(result.marketRegime);
  if (validated != null) {
    await saveRegimePending(debateDate, validated);
    const confirmed = await applyHysteresis(debateDate);
    if (confirmed != null) {
      logger.info("Regime", `확정 레짐: ${confirmed.regime} (${confirmed.confidence})`);
    } else {
      logger.info("Regime", `레짐 pending — 확정 대기 중`);
    }
  }
}
```

**4. 프롬프트 주입 개선 (`formatRegimeForPrompt`)**

`loadRecentRegimes` 결과를 넘길 때 confirmed 레코드만 전달하도록 호출부 수정.
프롬프트 내 "현재 레짐"은 `loadConfirmedRegime` 기반으로 변경.
히스토리 섹션에 pending 항목도 별도로 표시하는 옵션 추가 (디버깅 가시성):

```
현재 확정 레짐: MID_BULL (medium) — 2026-03-12 확정
pending 판정: EARLY_BEAR (2026-03-14), EARLY_BEAR (2026-03-15, 오늘) — 2일 연속 → 내일 확정 예정
```

이 정보를 프롬프트에 포함하면 LLM이 현재 전환 국면임을 인지하고 판단의 일관성을 높인다.

**5. Drizzle 마이그레이션**

신규 마이그레이션 파일 생성.
기존 레코드: `UPDATE market_regimes SET is_confirmed = true, confirmed_at = regime_date`.

## 작업 계획

### Phase 1: DB 스키마 + 마이그레이션 (선행)

**담당**: 구현팀
**완료 기준**: 마이그레이션 적용 후 기존 레코드 전체 `is_confirmed = true` 확인

- `src/db/schema/analyst.ts` — `isConfirmed`, `confirmedAt` 컬럼 추가
- Drizzle 마이그레이션 생성 (`drizzle-kit generate`)
- 마이그레이션 SQL에 `UPDATE market_regimes SET is_confirmed = true, confirmed_at = regime_date` 포함

### Phase 2: regimeStore 리팩토링

**담당**: 구현팀
**완료 기준**: 단위 테스트 통과

- `saveRegimePending` 함수 구현 (기존 `saveRegime` 교체)
- `applyHysteresis` 함수 구현:
  - 최근 CONFIRMATION_DAYS일 pending 레코드 조회
  - 동일 판정 여부 확인
  - 확정 처리 (UPDATE)
- `loadConfirmedRegime` 구현
- `loadRecentRegimes` 수정 — `WHERE is_confirmed = true` 추가

### Phase 3: run-debate-agent 호출부 수정

**담당**: 구현팀
**완료 기준**: 로컬 실행 시 pending/확정 로그 정상 출력

- `saveRegime` → `saveRegimePending` + `applyHysteresis` 순차 호출로 교체
- 레짐 저장 에러 격리 유지 (기존 try-catch 패턴 계승)

### Phase 4: 프롬프트 주입 업데이트

**담당**: 구현팀
**완료 기준**: `formatRegimeForPrompt` 출력에 확정/pending 구분 표시

- `formatRegimeForPrompt` — confirmed 레짐 기반으로 수정
- pending 상태 표시 옵션 추가

### Phase 5: 테스트

**담당**: 구현팀 (TDD)
**완료 기준**: 커버리지 80% 이상

테스트 대상:
- `applyHysteresis` 단위 테스트:
  - 1일 pending → 확정 안 됨
  - 2일 연속 동일 → 확정
  - 2일 중 1일 다름 → 확정 안 됨
  - 레짐 변경 시 기존 확정 유지, 새 레짐 2일 연속 후 전환
  - 초기 상태 (pending 0건) → 첫 판정 즉시 확정
- `loadConfirmedRegime` — confirmed 레코드만 반환 확인
- `loadRecentRegimes` — confirmed 레코드만 반환 확인

## 리스크

**레짐 전환 지연**: 히스테리시스로 실제 국면 전환도 2일 지연됨. 수용 가능한 트레이드오프.
CONFIRMATION_DAYS = 2는 "노이즈 제거"와 "반응 속도" 사이의 최소 절충점. 데이터 축적 후 조정 가능.

**히스토리 프롬프트 주입 시 pending 노출**: LLM이 pending 상태를 보고 불안정하게 판정할 가능성.
반대로 pending 맥락이 없으면 LLM이 이전 판정과 단절된 상태로 판단.
결론: pending 표시를 포함하되 "참고 정보"로 명시. 프롬프트 문구로 제어.

**기존 `loadLatestRegime` 호출부 누락**: `regimeStore`를 import하는 파일이 더 있을 수 있음.
구현 시 전체 codebase grep 필요.

## 의사결정 필요

없음 — 바로 구현 가능
