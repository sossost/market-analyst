# 일간 리포트 시장 위치 멀티게이트

## 선행 맥락

없음. 이 피처에 대한 이전 결정/시도 기록 없음.

## 골 정렬

SUPPORT — 시장 환경을 4개 게이트로 간접 서술하여 Phase 2 포착의 맥락 정보를 강화한다.
직접 주도종목을 발굴하는 것은 아니지만, 강세 환경 여부를 빠르게 판단하는 데 기여한다.

## 문제

일간 리포트에 "지금이 매수 환경인가 아닌가"를 빠르게 판단할 수 있는 지표가 없다.
S&P 500의 MA 위치와 시장 브레드스(신고가/신저가, A/D)를 게이트 형태로 표시하면
LLM 해석 없이도 환경 판단이 가능하다.

## Before → After

**Before**: 일간 리포트에 지수 카드(종가/등락률)와 Phase 분포는 있으나, MA 기반 시장 위치 정보 없음.

**After**: 리포트 상단(지수 현황 섹션 하단)에 시장 환경 게이트 블록 추가.
4개 게이트의 충족/미충족 + 수치를 표시. 판정 라벨("강세/약세") 없음.

```
━━━ 시장 환경 (3/4) ━━━
● S&P 500 > 200MA (+3.2%)
○ S&P 500 > 50MA (-1.4%)
● 신고가 > 신저가 (66 vs 56)
● A/D > 1.0 (1.39)
```

## 아키텍처 결정

**daily_ma 테이블 사용 불가**: `daily_ma`는 `symbols` 테이블 FK를 가지며 지수 심볼(^GSPC)은
`symbols`에 존재하지 않아 직접 삽입 불가. ETL 확장 방식 포기.

**채택 방식**: `index_prices` 테이블에서 런타임으로 MA 계산.
`index_prices`에는 이미 ^GSPC 가격이 250일 치 이상 존재하므로 추가 ETL 없이 즉시 사용 가능.

쿼리 패턴: 최신 날짜 기준으로 250일치 가격을 내림차순 조회 → 역순 정렬 → 슬라이스로 MA 계산.
`build-daily-ma.ts`의 `calculateMA` 함수와 동일한 로직.

## 변경 사항

### 1. 신규 도구 `src/tools/getMarketPosition.ts`

`index_prices`에서 ^GSPC 가격을 조회하여 MA50/MA200 계산.
`market_breadth_daily`에서 hl_ratio, ad_ratio 조회.

반환 형태:
```typescript
interface MarketPositionGate {
  label: string;
  passed: boolean;
  detail: string;           // 표시 문자열 e.g. "+3.2%" 또는 "66 vs 56"
}

interface MarketPositionData {
  gates: MarketPositionGate[];
  passCount: number;
  totalCount: number;
  date: string;
}
```

### 2. `src/tools/schemas/dailyReportSchema.ts` 스키마 확장

`DailyReportData`에 `marketPosition` 필드 추가:
```typescript
marketPosition: MarketPositionData | null;
```

`MarketPositionGate`, `MarketPositionData` 인터페이스도 이 파일에 정의.

### 3. `src/lib/daily-html-builder.ts` 렌더러 추가

`renderMarketPositionGates(data: MarketPositionData | null): string` 함수 신규 추가.

CSS에 `.gate-row`, `.gate-dot`, `.gate-dot.pass`, `.gate-dot.fail` 추가.

`buildDailyHtml`에서 섹션 2(지수 현황) 내부, `indexTableHtml` 하단에 게이트 블록 삽입:
```html
<!-- 섹션 2: 지수 현황 -->
<section>
  <h2>지수 현황</h2>
  ${indexTableHtml}
  ${marketPositionHtml}   <!-- 신규 -->
</section>
```

### 4. `src/agent/run-daily-agent.ts` 수집 추가

`getMarketPosition` 도구 import 및 `collectDailyData` 함수에 병렬 호출 추가.
폴백: 실패 시 `null` — 리포트 나머지는 정상 실행.

`DailyReportData` 빌드 시 `marketPosition` 필드 매핑 추가.

`buildDailyHtml` 호출부는 변경 없음 — `data.marketPosition`을 내부에서 처리.

### 5. ETL 스케줄 변경 없음

런타임 계산 방식이므로 `etl-daily.sh` 수정 불필요.

## 작업 계획

### 커밋 1: 스키마 타입 정의

**파일**: `src/tools/schemas/dailyReportSchema.ts`

추가 내용:
```typescript
export interface MarketPositionGate {
  label: string;
  passed: boolean;
  detail: string;
}

export interface MarketPositionData {
  gates: MarketPositionGate[];
  passCount: number;
  totalCount: number;
  date: string;
}
```

`DailyReportData`에 `marketPosition: MarketPositionData | null` 필드 추가.

**완료 기준**: TypeScript 컴파일 오류 없음.

---

### 커밋 2: 도구 구현 `getMarketPosition.ts`

**파일**: `src/tools/getMarketPosition.ts` (신규)

구현 내용:

**게이트 1, 2 — S&P 500 vs MA50/MA200**:
```
SELECT date, close
FROM index_prices
WHERE symbol = '^GSPC' AND date <= :targetDate AND close IS NOT NULL
ORDER BY date DESC
LIMIT 250
```
결과를 역순 정렬. slice(-200) 평균 = MA200, slice(-50) 평균 = MA50.
최신 close와 비교.
detail: `"${sign}${pctDiff.toFixed(1)}%"` — 예: "+3.2%" 또는 "-1.4%"

**게이트 3 — 신고가 > 신저가**:
`market_breadth_daily` 테이블에서 `new_highs`, `new_lows` 조회.
detail: `"${newHighs} vs ${newLows}"`

**게이트 4 — A/D > 1.0**:
동일 테이블에서 `ad_ratio` 조회.
detail: `"${adRatio.toFixed(2)}"`

게이트 3, 4는 `getMarketBreadth` 도구처럼 `market_breadth_daily` 직접 조회.
A/D와 신고/저 데이터는 이미 `DailyBreadthSnapshot`에 있지만, 도구 자체가
독립적으로 동작해야 하므로 별도 조회.

에러 처리:
- 데이터 부족(prices < 200) 시 해당 게이트 passed=false, detail="데이터 부족"
- market_breadth_daily 미조회 시 게이트 passed=false, detail="—"

**완료 기준**:
- `npx tsx -e "import('./src/tools/getMarketPosition.ts').then(m => m.getMarketPosition('2026-04-04').then(console.log))"` 실행 시 4개 게이트 반환
- MA 계산값이 `build-daily-ma.ts`의 로직과 일치

---

### 커밋 3: HTML 렌더러 추가

**파일**: `src/lib/daily-html-builder.ts`

CSS 추가 (`DAILY_REPORT_CSS` 내):
```css
/* Market Position Gates */
.gate-block {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 16px;
  margin-top: 16px;
}

.gate-header {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 10px;
}

.gate-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: 0.85rem;
}

.gate-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.gate-dot.pass { background: var(--up); }
.gate-dot.fail { background: var(--down); }

.gate-detail {
  color: var(--text-muted);
  font-size: 0.8rem;
  margin-left: auto;
}
```

`renderMarketPositionGates` 함수 추가:
```typescript
export function renderMarketPositionGates(
  data: MarketPositionData | null,
): string {
  if (data == null) return "";

  const rows = data.gates
    .map((g) => {
      const dotCls = g.passed ? "pass" : "fail";
      return `
        <div class="gate-row">
          <div class="gate-dot ${escapeHtml(dotCls)}"></div>
          <span>${escapeHtml(g.label)}</span>
          <span class="gate-detail">${escapeHtml(g.detail)}</span>
        </div>`;
    })
    .join("");

  return `
    <div class="gate-block">
      <div class="gate-header">시장 환경 (${escapeHtml(String(data.passCount))}/${escapeHtml(String(data.totalCount))})</div>
      ${rows}
    </div>`;
}
```

`buildDailyHtml` 수정:
```typescript
const marketPositionHtml = renderMarketPositionGates(data.marketPosition);
// ...
<!-- 섹션 2: 지수 현황 -->
<section>
  <h2>지수 현황</h2>
  ${indexTableHtml}
  ${marketPositionHtml}
</section>
```

**완료 기준**: `buildDailyHtml` 실행 시 `<!-- 섹션 2 -->` 블록에 `.gate-block` HTML 포함.

---

### 커밋 4: `run-daily-agent.ts` 수집 연결

**파일**: `src/agent/run-daily-agent.ts`

import 추가:
```typescript
import { getMarketPosition } from "@/tools/getMarketPosition";
```

`collectDailyData` 내 `Promise.all` 배열에 추가:
```typescript
getMarketPosition(targetDate).catch((err: unknown) => {
  logger.warn("Tool", `getMarketPosition 실패: ${err instanceof Error ? err.message : String(err)}`);
  return null;
}),
```

`DailyReportData` 빌드 시:
```typescript
marketPosition: marketPositionRaw,
```

**완료 기준**:
- 로컬 실행 시 로그에 "게이트: X/4" 형태의 수집 결과 출력
- 실패 시 나머지 리포트 정상 실행 (폴백 확인)

---

### 커밋 5: 테스트 추가

**파일**: `src/tools/__tests__/getMarketPosition.test.ts` (신규)

테스트 범위:
1. MA200 계산 정확성 — 200개 가격 배열에서 단순 평균 검증
2. 데이터 부족 처리 — 150개 rows 시 MA200 게이트 passed=false
3. A/D 게이트 — ad_ratio 1.5 시 passed=true, 0.8 시 passed=false
4. 신고가/신저가 게이트 — newHighs > newLows 시 passed=true
5. DB 오류 시 폴백 — getMarketPosition이 null 반환하지 않고 gates passed=false로 반환

DB는 모킹. Vitest + vi.mock 패턴 사용 (기존 `__tests__` 파일 패턴 참고).

**완료 기준**: `yarn test src/tools/__tests__/getMarketPosition.test.ts` 통과.

## 리스크

**1. `index_prices` 데이터 공백**: 휴일/주말에 가격이 없으면 MA 계산 시 rows < 200.
→ 대응: rows < 50 시 50MA 실패, rows < 200 시 200MA 실패. 해당 게이트만 "데이터 부족" 표시.

**2. 런타임 쿼리 부하**: 매일 250행 조회. `index_prices`는 지수 7개 × 250일 = 1750행 수준이므로 부담 없음.
인덱스 `idx_index_prices_symbol_date`가 있어 최적화 불필요.

**3. market_breadth_daily 미생성**: ETL 실패 시 브레드스 테이블에 당일 데이터 없음.
→ 대응: 가장 최근 데이터 (최대 1영업일 이전) 사용. 없으면 게이트 passed=false.

**4. A/D 데이터 중복**: `DailyBreadthSnapshot`에도 동일 데이터 있음.
→ 중복 쿼리지만 독립 도구 설계 원칙 유지. 성능 영향 없음.

## 의사결정 필요

없음 — 바로 구현 가능.

---

## 구현 참고

### 기존 MA 계산 로직 (`build-daily-ma.ts`)
```typescript
function calculateMA(prices: Record<string, unknown>[], period: number): number | null {
  if (prices.length < period) return null;
  const recentPrices = prices.slice(-period);
  const sum = recentPrices.reduce((acc, p) => acc + Number(p.close), 0);
  return sum / period;
}
```
`getMarketPosition.ts`에서도 동일 패턴으로 구현.

### 기존 도구 패턴
기존 도구들은 `execute(params)` 메서드를 가진 객체로 export한다.
`getMarketPosition`은 단순 함수 export로도 충분 (에이전트 tool call용 execute 래퍼 불필요 — 직접 호출).

### `DailyReportData` 확장 주의
`EMPTY_BREADTH_SNAPSHOT` 패턴처럼 fallback 값 필요.
`marketPosition: null` 을 기본값으로 사용.
