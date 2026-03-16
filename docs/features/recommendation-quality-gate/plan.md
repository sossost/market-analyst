# recommendation-quality-gate

## 선행 맥락

- `fix-recommendation-integrity` (PR #259/#260): ACTIVE 중복 방지 + 진입가 검증 구현. 하지만 CLOSED → 재추천 쿨다운은 미포함.
- `market-regime` (PR #270): 레짐 히스테리시스 — 2일 연속 확정 로직 구현. 레짐은 확정되지만 추천 게이트는 없음.
- `regimeStore.ts` 내 `REGIME_GUIDE`: "EARLY_BEAR: 신규 추천 최소화"가 프롬프트 텍스트로만 존재. 코드 레벨 하드 게이트 없음.
- `systemPrompt.ts` 607번째 줄: "BEAR → 최소화"가 프롬프트 가이드라인으로 존재. 마찬가지로 LLM이 무시 가능.
- 최근 90일 성과 데이터: ACTIVE PnL -5.91%, CLOSED_PHASE_EXIT -12.87%. EARLY_BEAR 날 3종목 추천이 근본 트리거.

## 골 정렬

**ALIGNED** — Phase 2 상승 초입 포착이라는 골에서 레짐이 EARLY_BEAR/BEAR일 때 신규 추천은 골과 정반대 방향이다. 잘못된 추천이 성과를 오염시켜 알파 판단 자체를 왜곡한다. 세 가지 게이트 모두 직접 기여.

## 문제

### 근본 원인 1: 레짐-추천 연결이 프롬프트 텍스트뿐

`saveRecommendations.ts`는 레짐을 `loadLatestRegime()`으로 조회해 `marketRegime` 필드에 저장만 한다. 레짐이 EARLY_BEAR/BEAR여도 INSERT를 막지 않는다. 코드 레벨에서 "저장하되 레짐을 기록"이지 "레짐에 따라 저장 차단"이 아니다.

```typescript
// 현재 — 레짐 조회는 스냅샷 저장 목적뿐
const latest = await loadLatestRegime();
currentRegime = latest?.regime ?? null;
// ... INSERT는 레짐과 무관하게 항상 실행됨
```

### 근본 원인 2: 중복 방지가 ACTIVE 상태에만 국한

현재 `saveRecommendations.ts`는 `status = 'ACTIVE'`인 symbol만 skip한다. CLOSED(phase exit, 손절 등) 후 1거래일 만에 재추천해도 통과된다.

```typescript
// 현재 — ACTIVE만 체크
const { rows: activeRows } = await pool.query(
  `SELECT symbol FROM recommendations WHERE status = 'ACTIVE' AND symbol = ANY($1)`,
  [symbols],
);
```

DAWN이 3/12 CLOSED → 3/13 재추천된 것이 이 로직의 직접 결과다.

### 근본 원인 3: Phase 2 진입 당일만으로 추천 허용

현재 추천 기준(validation.ts `MIN_PHASE = 2`)은 Phase >= 2이면 통과다. Phase 2에 막 진입한 당일 종목과 7일 연속 Phase 2 유지 종목을 동일하게 취급한다. CLOSED_PHASE_EXIT 4건 모두 max_pnl 0%인 것은 진입 즉시 Phase 이탈한 패턴으로, 진입 지속성 필터가 없었기 때문이다.

## Before → After

### [개선 1] 레짐 기반 하드 게이트

**Before**: `saveRecommendations.ts`가 레짐과 무관하게 항상 INSERT 실행. EARLY_BEAR 날 3종목 저장됨.

**After**: INSERT 전에 확정 레짐 체크. EARLY_BEAR 또는 BEAR이면 저장 거부 + 사유 로깅. 반환 메시지에 `blockedByRegime: N` 포함.

### [개선 2] 최근 CLOSED 종목 쿨다운

**Before**: ACTIVE만 체크. CLOSED 직후 다음날 동일 symbol 재추천 허용.

**After**: 최근 5 거래일 내 CLOSED 또는 CLOSED_PHASE_EXIT인 symbol 스킵. `blockedByCooldown: N`으로 집계.

### [개선 3] Phase 2 지속성 필터

**Before**: `MIN_PHASE = 2` 단순 비교. 당일 Phase 2 진입이면 통과.

**After**: `stock_phases` 테이블에서 해당 symbol의 최근 2 거래일 Phase를 조회. 두 날 모두 Phase >= 2여야 통과. 지속성 미충족 시 `[지속성 미확인]` 태그를 reason에 추가 (저장은 허용하되 태깅). — 이 개선은 하드 차단보다 소프트 태깅으로 구현. 이유: 신규 Phase 2 진입 자체가 골의 핵심 대상이므로 완전 차단은 과도함. 태깅으로 성과 추적 가능성 확보.

## 변경 사항

### `src/agent/tools/saveRecommendations.ts`

1. **레짐 게이트 추가** (INSERT 직전)
   - `loadConfirmedRegime()` 조회
   - `BEAR_REGIMES = new Set(['EARLY_BEAR', 'BEAR'])` 상수 정의
   - 레짐이 BEAR_REGIMES에 속하면 전체 배치를 거부하고 조기 반환
   - 반환 JSON에 `blockedByRegime` 카운트 포함

2. **쿨다운 쿼리 추가** (activeRows 조회와 함께 병렬 실행)
   - `WHERE symbol = ANY($1) AND status IN ('CLOSED', 'CLOSED_PHASE_EXIT') AND recommendation_date >= $2`
   - `$2` = 오늘 날짜에서 7 캘린더일 전 (거래일 5일 ≈ 캘린더일 7일)
   - cooldownSymbols Set 구성 후 각 symbol마다 `cooldownSymbols.has(symbol)` 체크

3. **Phase 지속성 조회 추가** (symbols 확정 후 병렬 실행)
   - `SELECT symbol FROM stock_phases WHERE symbol = ANY($1) AND date >= $2 AND phase >= 2`
   - 최근 2 거래일 기준 — 별도 `getRecentTradingDates(date, 2)` 헬퍼 필요 (또는 단순히 `date > CURRENT_DATE - INTERVAL '5 days'`로 근사)
   - Phase 2 연속 기준 미충족 symbol에 `[지속성 미확인]` reason 태그 추가

4. **반환 메시지 확장**
   - `{ savedCount, skippedCount, blockedByRegime, blockedByCooldown }`

### `src/agent/tools/validation.ts`

- 변경 없음 (MIN_PHASE는 유지, 지속성은 saveRecommendations.ts에서 처리)

### `src/agent/debate/regimeStore.ts`

- 변경 없음 (이미 `loadConfirmedRegime()` export 있음)

## 작업 계획

### Phase 1: 레짐 하드 게이트 (최우선)

**수정 파일**: `src/agent/tools/saveRecommendations.ts`

**구현 내용**:
```typescript
const BEAR_REGIMES = new Set<string>(['EARLY_BEAR', 'BEAR']);

// INSERT 전, activeRows 조회 이후
if (currentRegime != null && BEAR_REGIMES.has(currentRegime)) {
  logger.warn('RegimeGate', `${currentRegime} 레짐 — 신규 추천 차단 (${recs.length}건)`);
  return JSON.stringify({
    success: false,
    savedCount: 0,
    skippedCount: recs.length,
    blockedByRegime: recs.length,
    message: `${currentRegime} 레짐 — 신규 추천 차단. 레짐 전환 후 재시도.`,
  });
}
```

**완료 기준**: EARLY_BEAR/BEAR 레짐 시 `save_recommendations` 호출이 0건 저장 + blockedByRegime 반환.

### Phase 2: 쿨다운 게이트

**수정 파일**: `src/agent/tools/saveRecommendations.ts`

**구현 내용**: activeRows 조회와 병렬로 CLOSED 쿼리 실행. 7 캘린더일 이내 CLOSED symbol을 Set에 담아 skip.

```typescript
// 병렬 조회 확장
const COOLDOWN_CALENDAR_DAYS = 7; // 거래일 5일 근사

const cooldownFrom = new Date(date);
cooldownFrom.setDate(cooldownFrom.getDate() - COOLDOWN_CALENDAR_DAYS);
const cooldownFromStr = cooldownFrom.toISOString().slice(0, 10);

const [{ rows: activeRows }, { rows: cooldownRows }] = await Promise.all([
  retryDatabaseOperation(() =>
    pool.query<{ symbol: string }>(
      `SELECT symbol FROM recommendations WHERE status = 'ACTIVE' AND symbol = ANY($1)`,
      [symbols],
    ),
  ),
  retryDatabaseOperation(() =>
    pool.query<{ symbol: string }>(
      `SELECT DISTINCT symbol FROM recommendations
       WHERE status IN ('CLOSED', 'CLOSED_PHASE_EXIT')
         AND recommendation_date >= $1
         AND symbol = ANY($2)`,
      [cooldownFromStr, symbols],
    ),
  ),
]);

const cooldownSymbols = new Set(cooldownRows.map((r) => r.symbol));
```

symbol 루프에서:
```typescript
if (cooldownSymbols.has(symbol)) {
  logger.warn('Cooldown', `${symbol}: ${COOLDOWN_CALENDAR_DAYS}일 쿨다운 중, 스킵`);
  skippedCount++;
  blockedByCooldown++;
  continue;
}
```

**완료 기준**: 최근 7 캘린더일 내 CLOSED된 symbol이 재추천 시도 시 skip + 로그 출력.

### Phase 3: Phase 지속성 태깅

**수정 파일**: `src/agent/tools/saveRecommendations.ts`

**구현 내용**: 각 symbol의 최근 2 거래일 Phase 2 연속 여부 확인. 미충족 시 reason에 태그 추가.

```typescript
// Phase 2 지속성 확인 (근사: 최근 5 캘린더일 내 phase >= 2 행 수)
const { rows: phaseRows } = await retryDatabaseOperation(() =>
  pool.query<{ symbol: string; cnt: string }>(
    `SELECT symbol, COUNT(*) as cnt
     FROM stock_phases
     WHERE symbol = ANY($1)
       AND date >= CURRENT_DATE - INTERVAL '5 days'
       AND phase >= 2
     GROUP BY symbol`,
    [symbols],
  ),
);
const phaseConsistencyMap = new Map(
  phaseRows.map((r) => [r.symbol, parseInt(r.cnt, 10)]),
);
```

symbol 루프에서 reason 조합 시:
```typescript
const hasConsistentPhase2 = (phaseConsistencyMap.get(symbol) ?? 0) >= 2;
const consistencyTag = hasConsistentPhase2 ? '' : '[지속성 미확인] ';
const finalReason = `${consistencyTag}${taggedReason ?? ''}`.trim();
```

**완료 기준**: Phase 2 당일 진입 종목의 reason에 `[지속성 미확인]` 접두사 저장. 성과 DB에서 이 태그 종목의 PnL 추적 가능.

### Phase 4: 테스트 추가

**수정 파일**: `src/agent/tools/__tests__/saveRecommendations.test.ts` (신규 또는 기존 확장)

**커버리지 대상**:
- EARLY_BEAR 레짐 시 전체 배치 거부
- BEAR 레짐 시 전체 배치 거부
- EARLY_BULL 레짐 시 정상 저장 진행
- 쿨다운 기간 내 CLOSED symbol skip
- 쿨다운 기간 외 동일 symbol 정상 저장
- Phase 2 지속성 2일 이상: tag 없음
- Phase 2 지속성 1일: `[지속성 미확인]` tag

**완료 기준**: 위 7개 케이스 테스트 통과.

## 리스크

### R1: 레짐 판정 지연 — false block
레짐 히스테리시스로 인해 실제 EARLY_BULL 전환이 2일 지연됨. 전환 초기에 EARLY_BEAR 레짐이 하루 더 유지되면 해당 날 추천이 차단됨. **완화책**: 이것은 의도된 보수적 동작. EARLY_BEAR → EARLY_BULL 전환 확정 전에는 추천 자제가 골에 부합.

### R2: 쿨다운 기간 7일 — 너무 엄격할 가능성
예를 들어 Phase 2 재진입이 빠른 종목을 놓칠 수 있음. **완화책**: `COOLDOWN_CALENDAR_DAYS = 7`을 상수로 분리하여 향후 조정 쉽게. 초기값 7일은 최근 재추천 패턴(1~2일)보다 충분히 크고, 실제 Phase 2 재진입 평균보다 짧음.

### R3: Phase 지속성 쿼리 — 거래일 2일 ≠ 캘린더일 5일
주말을 포함한 5일 내 조회를 사용하므로 금요일 추천 시 이전 주 목요일까지 포함됨. 공휴일+주말 조합이면 실제 2 거래일이 캘린더 7일을 넘을 수 있음. **완화책**: 지속성 체크는 하드 차단이 아닌 소프트 태깅이므로 영향 최소. 향후 `getRecentTradingDates()` 헬퍼로 교체 가능.

### R4: 기존 테스트 영향
`saveRecommendations.test.ts`가 있다면 레짐 mock 추가 필요. loadConfirmedRegime이 null 반환 시 레짐 게이트를 통과하는지 확인 필요 (null = 레짐 미확정 = 차단 안 함이 올바른 동작).

## 의사결정 필요

없음 — 아래 결정은 자율 판단으로 확정.

- **레짐 게이트 적용 범위**: 전체 배치 차단 (개별 종목이 아닌 호출 단위). 사유: 레짐이 EARLY_BEAR면 어떤 종목도 추천 부적절.
- **쿨다운 기간 7 캘린더일**: 거래일 5일 근사. 나중에 상수로 조정 가능.
- **지속성 필터를 소프트 태깅으로 구현**: Phase 2 신규 진입이 골의 핵심 대상이므로 하드 차단은 과도.
- **loadConfirmedRegime() 사용 (pending 제외)**: pending은 아직 확정 아님. 확정 레짐 기준으로 게이트.
