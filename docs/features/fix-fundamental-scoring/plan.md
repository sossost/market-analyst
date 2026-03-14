# fix-fundamental-scoring

## 선행 맥락

- **fundamental-report-quality** (이슈 #191): 이익률 포맷 버그(`netMargin × 100` 미적용)를
  `stockReport.ts`와 `fundamentalAgent.ts`에서 이미 수정 완료.
  그러나 이번 이슈(#225)는 **스코어링 판정 로직** 자체의 오류로, 이전 수정과 별개.
- **sepa-data-quality-guard** 등 기존 품질 게이트는 LLM이 검증하는 방식이라,
  판정 로직 자체 버그는 걸러내지 못함.
- **`__tests__/lib/fundamental-scorer.test.ts`** 존재 — `checkEpsAcceleration`,
  `checkMarginExpansion` 단위 테스트 이미 있으나 CYD 사례(311%→66%→-17% 감속인데 가속 판정)를
  재현하는 테스트는 없음.

## 골 정렬

**ALIGNED** — SEPA 스코어링의 판정 오류는 종목 등급을 왜곡하여 잘못된 S/A 종목이 리포트에
오른다. Phase 2 초입 주도주를 남들보다 먼저 포착하는 프로젝트 골에 직접 타격.
등급 오류 수정이 우선순위 최상위 버그.

## 문제

CYD(2026-03-14 리포트)에서 5가지 오류 확인:

1. **EPS 가속 판정 역전**: 311%→66%→-17%는 명백한 감속인데 ✅ 가속으로 판정
2. **이익률 확대 판정 역전**: 2.65%→1.46%로 하락인데 ✅ 확대로 판정
3. **분기 실적 테이블 중복**: 동일 수치가 연속 2행 — 데이터 복제 의심
4. **이익률 소수점 15자리 원시값 노출**: `quarterly_ratios.net_margin`이 이미 퍼센트
   단위(예: `2.65`)인 종목이 있어, `× 100` 후 `265.xxx...%`로 출력
5. **가점 테이블 ↔ 서술 내부 모순**: 판정 역전 결과로 리포트 텍스트와 표가 불일치

## Before → After

**Before**

```
EPS 가속 (가점) | ✅ | EPS 가속: 311.0% → 66.0% → -17.0%  ← 감속인데 가속 판정
이익률 확대 (가점) | ✅ | 이익률 확대: 2.65% → 1.46%          ← 하락인데 확대 판정
이익률 열       | 265.00000000000003%                        ← × 100 중복 적용
```

**After**

```
EPS 가속 (가점) | ❌ | EPS 가속 미충족: 311.0% → 66.0% → -17.0%
이익률 확대 (가점) | ❌ | 이익률 확대 미충족: 2.65% → 1.46%
이익률 열       | 2.7%                                       ← 단위 일관성 보장
```

## 근본 원인 분석

### 버그 1 — EPS 가속 판정 역전 (`checkEpsAcceleration`)

`evaluateEpsAcceleration()`이 `growthRates[]` 배열에 growthRate를 **newest-first**로 채운다:

```
growthRates[0] = 최신분기 EPS YoY = -17%
growthRates[1] = 전분기  EPS YoY = 66%
growthRates[2] = 전전분기 EPS YoY = 311%
```

`checkEpsAcceleration()`은 `growthRates[i] > growthRates[i+1]` 조건으로 확인:

```
i=0: growthRates[0](-17) > growthRates[1](66) → false → 즉시 return false
```

이 로직은 **"최신이 이전보다 크면 가속"** 판정이므로, 위 예시에서는 `false` 반환이 맞다.

**따라서 `checkEpsAcceleration` 로직 자체는 정확하다.**

문제는 `evaluateEpsAcceleration()`의 **성장률 계산 방향**:
`findYoYQuarter()`가 `asOfQ` 기반으로 1년 전 분기를 찾는데, CYD의 경우
`as_of_q` 데이터가 정렬/매핑이 잘못되어 있을 가능성 또는
DB에서 `quarterly_financials`의 `as_of_q` 컬럼 값이 비정상적으로 채워진 케이스.

**실제 재현을 위해 체크해야 할 것:**
- DB에서 CYD의 `as_of_q` 컬럼 값 확인
- `findYoYQuarter()`가 잘못된 분기를 YoY 기준으로 매칭하는 경우

단, 이슈에서 "311%→66%→-17%가 가속으로 판정됐다"고 명시했으므로
`checkEpsAcceleration`에 배열 입력이 oldest-first로 들어간 것 — 즉 **배열 순서가 역전**된
상태로 함수에 진입했을 가능성이 높다. 아래 두 가지 시나리오를 검증해야 한다:

**시나리오 A (가장 유력)**: `evaluateEpsAcceleration()`에서 loop `i=0,1,2`가
newest-first로 채우지만, growthRate 결과 순서가 실제로는 oldest-first로 나오는 케이스.
예: `findYoYQuarter`가 의도와 다른 분기를 매칭해서 growthRates 배열이
`[311, 66, -17]` (oldest-first)으로 채워짐 → `checkEpsAcceleration([311, 66, -17])`
→ 311>66 true, 66>-17 true → **가속 오판정**.

**시나리오 B**: `quarters[]` 배열 자체가 oldest-first로 넘어온 경우.

### 버그 2 — 이익률 확대 판정 역전 (`checkMarginExpansion`)

`evaluateMarginExpansion()`이 `quarters.slice(0, 4).map(q => q.netMargin)`으로
**newest-first** 순서로 margins 배열을 구성한다.

`checkMarginExpansion()` 내부에서 `.reverse()`로 oldest-first 변환 후 비교:
```
chronological[0] = oldest, chronological[last] = newest
if (newest <= oldest) return false
```

**이 로직도 정확하다.**

CYD 이슈에서 "2.65%→1.46%로 하락인데 확대 판정"이 나왔다면:
- DB의 `net_margin` 값이 0~1 소수로 저장되지 않고 퍼센트 그대로 저장된 종목이 있어
  `× 100` 변환 후 `265 → 146`처럼 실제와 다른 크기 비교가 일어날 수 있음.
  그러나 이익률 확대는 순서 비교라 단위가 일관되면 방향은 동일해야 함.
- **더 유력한 원인**: `netMargin` 값 자체가 DB에 0~1 소수(`0.0265`)로 저장된 경우
  `checkMarginExpansion`은 절댓값 비교이므로 방향은 맞다. 그러나 출력 포맷에서
  `× 100`을 적용하면 `2.65%`로 보이지만, 리포트 `detail` 문자열 생성 시
  `evaluateMarginExpansion()`의 역방향 reverse가 적용되어 "확대" 문구가 잘못 붙을 수 있음.

**정확한 원인 확정을 위해 CYD의 실제 DB 값 검증 필요** — 이를 테스트로 재현.

### 버그 3 — 분기 실적 테이블 중복

`groupBySymbol()`에 `as_of_q` 중복 제거 로직이 있음:
```ts
if (quarters.some((q) => q.asOfQ === row.as_of_q)) continue;
```
그러나 `as_of_q` 값이 두 행 간 다른 포맷(예: `"Q4 2024"` vs `"2024Q4"`)이면
중복으로 감지되지 않아 같은 분기 데이터가 두 번 들어갈 수 있음.

### 버그 4 — 이익률 소수점 15자리 원시값 노출

`stockReport.ts` L93:
```ts
const margin = q.netMargin != null ? `${(q.netMargin * 100).toFixed(1)}%` : "N/A";
```
이미 수정됨. 그러나 일부 종목의 `net_margin`이 DB에 **이미 퍼센트 단위**로 저장된 경우
`× 100` 후 15자리 소수 노출 (예: `2.65 × 100 = 265.0000000003%`).

**단위 일관성 문제**: `quarterly_ratios.net_margin`이 일부 종목은 0~1 소수, 일부는
퍼센트 단위로 혼재할 가능성. DB 레이어에서 통일이 필요하지만 이번 범위는
이상값 감지(>1인 경우 이미 퍼센트 단위로 간주) 방어 로직 추가.

## 변경 사항

### 1. `src/lib/fundamental-scorer.ts`

#### 1-A. `evaluateEpsAcceleration()` — 성장률 배열 순서 보장 및 detail 개선

현재 구현이 newest-first 순서로 배열을 채우나, `findYoYQuarter()` 매칭 실패 시
배열이 불완전하게 채워지는 케이스를 명시적으로 방어.

`detail` 문자열: 가속 실패 시도 성장률 수치를 표시하여 디버깅 가능하게.

```ts
// 변경 전
: `EPS 가속 미충족 (${growthRates.length}분기 데이터)`;

// 변경 후
: growthRates.length > 0
  ? `EPS 가속 미충족: ${growthRates.map((r) => `${r}%`).join(" → ")}`
  : `EPS 가속 미충족 (데이터 부족)`;
```

#### 1-B. `evaluateMarginExpansion()` — detail 방향 버그 수정

현재 passed=true일 때 `[...margins].reverse()`로 oldest-first 순서의 문자열을 생성하지만,
passed=false 케이스에도 동일 포맷으로 표시해서 판정 근거를 명확히.

```ts
// 변경 전
detail: passed
  ? `이익률 확대: ${[...margins].reverse().map((m) => `${m}%`).join(" → ")}`
  : `이익률 확대 미충족 (${margins.length}분기 데이터)`,

// 변경 후
const chronologicalStr = [...margins].reverse().map((m) => `${m.toFixed(2)}%`).join(" → ");
detail: passed
  ? `이익률 확대: ${chronologicalStr}`
  : `이익률 확대 미충족: ${chronologicalStr}`,
```

### 2. `src/lib/fundamental-data-loader.ts`

#### 2-A. `as_of_q` 중복 감지 — 포맷 정규화 후 비교

```ts
// 변경 전: 문자열 그대로 비교 (포맷 다르면 중복 미감지)
if (quarters.some((q) => q.asOfQ === row.as_of_q)) continue;

// 변경 후: 파싱된 (year, quarter) 기준 비교
if (quarters.some((q) => isSameQuarter(q.asOfQ, row.as_of_q))) continue;
```

`isSameQuarter(a, b)`: 두 asOfQ 문자열을 `parseQuarterLabel()`(scorer에서 이미 구현)과
동일한 파싱 로직으로 분해하여 `(year, quarter)` 쌍 비교.
파싱 실패 시 fallback으로 문자열 동일성 비교.

#### 2-B. `netMargin` 단위 이상값 방어

`quarterly_ratios.net_margin`이 DB에 이미 퍼센트 단위로 저장된 경우 (절댓값 > 1 기준)
`÷ 100` 변환하여 0~1 소수로 정규화:

```ts
// groupBySymbol() 내부 netMargin 처리
netMargin: normalizeMargin(toNumber(row.net_margin)),

function normalizeMargin(val: number | null): number | null {
  if (val == null) return null;
  // 절댓값이 1 초과 → 이미 퍼센트 단위 → 소수로 변환
  if (Math.abs(val) > 1) return val / 100;
  return val;
}
```

**주의**: 이익률이 100% 이상인 정상 케이스(일부 기술 기업)를 잘못 변환할 수 있음.
임계값을 1이 아닌 5(500% 이상만 이상값으로 처리)로 설정 — 실제 기업 이익률이
500%를 넘는 케이스는 데이터 오류로 판단.

### 3. `src/agent/fundamental/stockReport.ts`

`netMargin × 100` 이미 적용됨. 추가 방어: `normalizeMargin` 적용 후에는 정상 범위.
변경 불필요 (2-B에서 로더 레이어 정규화로 해결).

### 4. `__tests__/lib/fundamental-scorer.test.ts` — 회귀 테스트 추가

CYD 사례를 재현하는 테스트 케이스 추가:

```ts
// EPS 감속 (311% → 66% → -17%) 이 false를 반환하는지
it("rejects clearly decelerating growth rates (311 → 66 → -17)", () => {
  expect(checkEpsAcceleration([311, 66, -17])).toBe(false);
  // 이 입력이 true를 반환했다면 버그 — 회귀 방지
});

// 이익률 하락 (2.65 → 1.46) 이 false를 반환하는지
it("rejects contracting margins expressed as decimals (0.0265 → 0.0146)", () => {
  expect(checkMarginExpansion([0.0146, 0.0155, 0.0200, 0.0265])).toBe(false);
});
```

### 5. `__tests__/lib/fundamental-data-loader.test.ts` — 중복 감지 테스트 추가

```ts
it("deduplicates rows with same quarter in different format (Q4 2024 vs 2024Q4)", () => {
  // 동일 분기 다른 포맷 → 첫 번째만 남겨야 함
});
```

## 작업 계획

### 단계 1 — 버그 재현 + 테스트 작성 (TDD Red) [backend-engineer]

- `__tests__/lib/fundamental-scorer.test.ts`에 CYD 감속 사례 재현 테스트 추가
- `__tests__/lib/fundamental-data-loader.test.ts`에 `as_of_q` 중복 포맷 테스트 추가
- 완료 기준: 신규 테스트가 **실패** (버그 재현 확인)

### 단계 2 — `fundamental-scorer.ts` 수정 [backend-engineer]

- `evaluateEpsAcceleration()` detail 개선 (가속 미충족 시 수치 표시)
- `evaluateMarginExpansion()` detail 개선 (미충족 시도 수치 표시)
- 완료 기준: 1-A, 1-B 케이스 테스트 통과

### 단계 3 — `fundamental-data-loader.ts` 수정 [backend-engineer]

- `isSameQuarter()` 헬퍼 추가 + 중복 감지 로직 교체
- `normalizeMargin()` 추가 + netMargin 처리에 적용
- 완료 기준: 중복 포맷 테스트 통과, `netMargin > 1` 경우 정규화 확인

### 단계 4 — 전체 테스트 통과 확인 [backend-engineer]

- `yarn test` 전체 통과 확인
- 신규 테스트 포함 기존 회귀 없음
- 완료 기준: CI green

## 리스크

| 항목 | 내용 | 대응 |
|------|------|------|
| `normalizeMargin` 임계값 오설정 | 이익률 100~499% 구간 정상 기업을 잘못 변환 가능 | 임계값 5(500%)로 보수적 설정. 해당 구간 기업은 거의 없음 |
| `isSameQuarter` 파싱 실패 | 비정상 포맷 `as_of_q` 값은 파싱 실패 → fallback 문자열 비교 | fallback 명시 구현 |
| EPS 가속 로직이 실제로 맞았는데 CYD가 이상 데이터인 경우 | `checkEpsAcceleration` 자체가 아니라 DB `as_of_q` 매핑 오류 가능성 | 단계 1 TDD로 재현 확인 후 수정 범위 결정 |
| `fundamental-report-quality`(#191) 에서 이미 `×100` 적용됨 | 2중 적용 방지 필요 | `normalizeMargin`은 로더에서 적용, stockReport는 현행 유지 — 단 정규화 완료 후 stockReport `×100` 로직이 중복인지 검토 필요 |

## 의사결정 필요

**`normalizeMargin` 임계값**: 500%(절댓값 5)로 보수 설정 예정. CEO 동의 없으면 진행.
실질적으로 이익률 500% 이상 종목은 데이터 오류로 봐도 무방하므로 자율 판단으로 진행.
