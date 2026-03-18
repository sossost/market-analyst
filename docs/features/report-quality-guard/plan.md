# report-quality-guard

이슈 #290 대응 기획서 — 2026-03-17 일간 리포트 품질 이슈 재발 방지

## 선행 맥락

**report-quality-gate** (`docs/features/report-quality-gate/plan.md`): #224/#229 통합 기획으로 구현 완료. 해당 기획의 핵심 성과:

- `getUnusualStocks.ts`에 `phase2WithDrop` 플래그 추가 (완료)
- `systemPrompt.ts`에 bull-bias 가드레일 + phase2WithDrop 규칙 추가 (완료)
- `reportValidator.ts`에 `checkPhase2RatioRange`, `checkRiskKeywords`, `checkSubstandardStocks` 구현 (완료)
- `validation.ts`에 `clampPercent` 함수 — 100% 초과 시 null 반환, QA mismatch 강제 (완료)
- `phase2RatioConversion.test.ts` — 이중 변환 방어 테스트 4건 (완료)

**무엇이 뚫렸는가**: 위 방어선들이 이미 존재함에도 불구하고 #290 이슈가 발생했다. 즉 **가드레일이 있지만 실행 경로 상에서 호출되지 않거나, 발송을 차단하지 않는** 구조적 문제가 남아 있다.

## 골 정렬

**ALIGNED** — 직접 기여.

리포트 신뢰도는 Phase 2 초입 주도주를 남들보다 먼저 포착하는 핵심 아웃풋의 품질을 결정한다. Phase 2 비율 2330% 같은 명백한 오류가 포함된 리포트는 독자의 투자 판단을 직접 왜곡하며, 시스템 전체의 신뢰성을 훼손한다.

5개 제안 각각의 골 정렬:

| 제안 | 판정 | 사유 |
|------|------|------|
| Phase 비율 100% 초과 시 발송 전 자동 차단 | ALIGNED | 명백한 데이터 오류를 발송 전 차단. 직접 기여 |
| bull-bias 자동 검증 (리스크 30% 미만 경고) | ALIGNED | 편향 리포트 억제. 이미 `reportValidator`에 WARN 로직 존재 — 발송 차단까지 강화 필요 |
| Phase 1 종목 별도 구분 | ALIGNED | Phase 2 추천 목록 순도 유지가 핵심 알파 형성에 직결 |
| 전일 대비 변화 자동 비교 | SUPPORT | 서술 품질 강화. 간접 기여 |
| 분석 대상 수 급변 시 원인 기재 강제 | SUPPORT | 데이터 파이프라인 모니터링. 직접 알파 기여보다는 시스템 건강도 |

## 문제

**이슈 #290의 핵심 5개:**

1. **Phase 2 비율 2330%**: 이중 변환 버그. `clampPercent`가 존재하지만, 이 함수를 통과하지 않은 경로가 있거나, `sendDiscordReport`의 `appendValidationWarnings`가 `checkPhase2RatioRange`를 호출하지만 에러를 **경고로만 기록하고 발송을 차단하지 않는** 구조다.

2. **분석 대상 132 → 4684개**: `getMarketBreadth`의 `totalStocks`는 `stock_phases` 전체 행을 카운팅한다. `is_actively_trading = true`, `is_etf = false`, `is_fund = false` 필터가 없다. `dailyQA.ts`의 `fetchPhase2Ratio`는 이 필터를 적용하는데, 도구 레이어가 불일치하는 쿼리를 사용하고 있다.

3. **Phase 1 종목(PBFS, MFA, NTIP) 추천 포함**: `saveRecommendations.ts`에서 Phase < 2인 종목은 `[기준 미달]` 태깅만 하고 저장은 허용한다. `reportValidator.ts`의 `checkSubstandardStocks`도 WARNING만 발행. Phase 1 종목이 추천 목록에 포함되는 것을 **차단하는** 하드게이트가 없다.

4. **bull-bias 100:0**: `reportValidator.ts`의 `checkRiskKeywords`는 bull-ratio > 80%이면 WARNING만 발행. 실제로 리포트 발송을 차단하지 않는다.

5. **주도 섹터 동일인데 이유 서술 없음**: `systemPrompt.ts`에 `buildDailySystemPrompt`의 MD 파일 6번 섹션 "전일 대비 변화 요약"이 명시되어 있으나, LLM이 이를 생략해도 차단하지 않는다. `reportValidator`의 `DAILY_REQUIRED_SECTIONS`에 해당 키워드가 없다.

## Before → After

**Before:**
- `reportValidator.validateReport`가 에러를 반환해도 `appendValidationWarnings`는 마크다운에 경고를 **삽입**할 뿐, 발송을 **차단**하지 않는다.
- `getMarketBreadth`의 `totalStocks`는 ETF/펀드/비활성 심볼을 포함하여 카운팅 — 실제 분석 대상 종목 수와 다른 숫자가 리포트에 기재된다.
- Phase 1 종목이 추천 목록에 `[기준 미달]` 태그와 함께 저장되고 리포트에 포함되어 발송된다.
- `checkRiskKeywords`에서 bear 키워드가 0개이면 ERROR를 반환하지만, 이 ERROR가 발송을 차단하지 않는다.
- "전일 대비 변화 요약" 섹션이 MD 필수 섹션 검증 목록(`DAILY_REQUIRED_SECTIONS`)에 없다.

**After:**
- `validateReport`에서 `errors` 배열에 항목이 있으면 `sendDiscordReport` 도구가 발송을 거부하고 에러 메시지를 Discord 에러 채널로 전송한다.
- `getMarketBreadth`의 `totalStocks` 쿼리에 `is_actively_trading = true AND is_etf = false AND is_fund = false` 필터 추가.
- Phase 1 종목(`phase < 2`)이 추천 목록에 포함되면 `sendDiscordReport` 호출 시점에 경고 섹션으로 분리 표시된다 (추천 목록에서 별도 "관찰 후보" 섹션으로 이동).
- `bearCount === 0`인 경우 기존 ERROR는 유지하되, `bull-bias` WARNING 임계값을 80% → 70%로 강화 (이슈 요구사항: 30% 이하이면 경고).
- `DAILY_REQUIRED_SECTIONS`에 `전일 대비` 키워드 추가 (WARNING 수준).

## 변경 사항

### Step 1 — 발송 차단 게이트 강화 (핵심)

**파일:** `src/agent/tools/sendDiscordReport.ts`

`appendValidationWarnings` 함수를 `appendValidationResult`로 확장:
- `result.errors.length > 0`이면 Discord 에러 채널(`DISCORD_ERROR_WEBHOOK_URL`)로 에러 내용 발송 후, 도구가 `{ success: false, error: "... 발송 차단" }` 반환.
- `result.warnings.length > 0`이면 기존처럼 마크다운에 경고 삽입 후 발송 진행.

이 변경으로 `checkPhase2RatioRange`가 ERROR를 발행하면 리포트 발송이 실제로 차단된다.

**완료 기준:**
- `validateReport`가 errors를 반환할 때 `execute`가 `success: false`를 반환하는 테스트 케이스 통과
- errors 없이 warnings만 있을 때 발송 진행하는 테스트 케이스 통과

---

### Step 2 — `getMarketBreadth` 쿼리 필터 정합성 수정

**파일:** `src/agent/tools/getMarketBreadth.ts`

**daily 모드** — 아래 두 쿼리에 `JOIN symbols s ON sp.symbol = s.symbol` 추가 후 WHERE에 필터 적용:

```sql
-- Phase 분포 쿼리 (line 241~249)
FROM stock_phases sp
JOIN symbols s ON sp.symbol = s.symbol
WHERE sp.date = $1
  AND s.is_actively_trading = true
  AND s.is_etf = false
  AND s.is_fund = false

-- 전일 Phase 2 비율 쿼리 (line 260~268)
FROM stock_phases sp
JOIN symbols s ON sp.symbol = s.symbol
WHERE sp.date = (SELECT MAX(date) FROM stock_phases sp2
                 JOIN symbols s2 ON sp2.symbol = s2.symbol
                 WHERE sp2.date < $1
                   AND s2.is_actively_trading = true
                   AND s2.is_etf = false
                   AND s2.is_fund = false)
  AND s.is_actively_trading = true
  AND s.is_etf = false
  AND s.is_fund = false

-- 시장 평균 RS 쿼리 (line 276~280)
FROM stock_phases sp
JOIN symbols s ON sp.symbol = s.symbol
WHERE sp.date = $1
  AND s.is_actively_trading = true
  AND s.is_etf = false
  AND s.is_fund = false
```

**weekly 모드** — 동일 패턴 적용 (line 61~79, line 110~124).

**완료 기준:**
- `dailyQA.ts`의 `fetchPhase2Ratio`와 `getMarketBreadth`의 `totalStocks` 쿼리가 동일한 symbols 필터 기준을 사용
- `totalStocks`가 약 132개 수준으로 정상화됨을 로컬 실행으로 확인

---

### Step 3 — bull-bias 임계값 강화

**파일:** `src/agent/lib/reportValidator.ts`

```typescript
// Before
const BULL_BIAS_THRESHOLD = 0.8;

// After
const BULL_BIAS_THRESHOLD = 0.7;
```

이슈 요구사항 "리스크/약세 언급 30% 미만이면 경고" = bull 비율 70% 초과이면 경고. 현재 80%보다 강화.

**완료 기준:**
- bull:bear = 7:3 케이스에서 WARNING 발행하는 테스트 케이스 통과
- bull:bear = 7:3 이하 케이스에서 WARNING 미발행 확인

---

### Step 4 — "전일 대비 변화 요약" 필수 섹션 추가

**파일:** `src/agent/lib/reportValidator.ts`

`DAILY_REQUIRED_SECTIONS` 배열에 추가:

```typescript
{ keyword: "전일 대비", label: "전일 대비 변화 요약", severity: "warning" },
```

`systemPrompt.ts`에 이미 MD 파일 6번 섹션으로 "전일 대비 변화 요약"이 정의되어 있으므로, 검증 키워드는 "전일 대비"로 충분히 매칭된다.

**완료 기준:**
- "전일 대비" 없는 일간 리포트 MD에서 WARNING 발행 테스트 케이스 통과

---

### Step 5 — Phase 1 종목 추천 목록 분리 (systemPrompt 가드레일)

**파일:** `src/agent/systemPrompt.ts`

`buildDailySystemPrompt`의 `## 규칙` 섹션에 추가:

```
- **Phase 1 종목 추천 금지**: Phase 1 종목(상승 추세 미확인)은 추천 목록에 포함하지 마세요. 관심 있으면 "🌱 주도주 예비군" 섹션에만 포함하세요. 추천 종목 = Phase 2 이상만.
```

동일 규칙을 `buildWeeklySystemPrompt`의 `## 주도주 선정 기준` 섹션에도 추가 (현재 "Phase 2 RS 60 이상"이 기준이나 명시적 Phase 1 제외 규칙이 없음).

`reportValidator.ts`의 `checkSubstandardStocks`에서 Phase < 2인 종목을 WARNING에서 ERROR로 격상:

```typescript
// Before
if (failReasons.length > 0) {
  substandard.push(`${rec.symbol} (${failReasons.join(", ")})`);
}
if (substandard.length > 0) {
  warnings.push(`기준 미달 종목: ${substandard.join(", ")}`);
}

// After — Phase < 2는 ERROR, RS < 60만 WARNING 유지
const substandardPhase: string[] = [];
const substandardRs: string[] = [];

for (const rec of recommendations) {
  if (rec.phase != null && rec.phase < MIN_PHASE) {
    substandardPhase.push(`${rec.symbol} (Phase ${rec.phase})`);
  } else if (rec.rsScore != null && rec.rsScore < MIN_RS_SCORE) {
    substandardRs.push(`${rec.symbol} (RS ${rec.rsScore})`);
  }
}

if (substandardPhase.length > 0) {
  errors.push(`Phase 1 종목 추천 감지: ${substandardPhase.join(", ")} — 추천 목록에서 제외하세요`);
}
if (substandardRs.length > 0) {
  warnings.push(`RS 기준 미달 종목: ${substandardRs.join(", ")}`);
}
```

이렇게 되면 Phase 1 종목이 추천에 포함되면 `validateReport`가 ERROR를 반환하고, Step 1의 발송 차단 게이트에서 발송이 차단된다.

**완료 기준:**
- Phase 1 종목이 recommendations에 포함될 때 `validateReport`가 errors를 반환하는 테스트 케이스 통과
- Step 1의 발송 차단과 연동하여 e2e 흐름 확인

---

### Step 6 — 테스트 커버리지 보강

**파일:** `src/agent/lib/__tests__/reportValidator.test.ts`

추가 테스트 케이스:
- Step 1: `validateReport`가 errors 반환 → `sendDiscordReport`의 `execute`가 `success: false` 반환
- Step 3: bull:bear = 7:3에서 WARNING 발행 확인
- Step 4: "전일 대비" 없는 일간 리포트 → WARNING 발행
- Step 5: Phase 1 종목 추천 → ERROR 반환

**파일:** `src/agent/tools/__tests__/getMarketBreadth.test.ts` (신규)

- `totalStocks`가 symbols 필터를 적용한 결과를 반환하는지 검증 (mock DB 사용)

## 작업 계획

| 단계 | 대상 파일 | 에이전트 | 완료 기준 |
|------|----------|---------|----------|
| Step 1 | `sendDiscordReport.ts` | 실행팀 | errors 시 발송 차단, warnings 시 경고 삽입 후 발송 — 테스트 통과 |
| Step 2 | `getMarketBreadth.ts` | 실행팀 | totalStocks 필터 정합성, dailyQA와 동일 기준 사용 |
| Step 3 | `reportValidator.ts` (THRESHOLD 변경) | 실행팀 | 70% 임계값 테스트 통과 |
| Step 4 | `reportValidator.ts` (섹션 추가) | 실행팀 | "전일 대비" WARNING 테스트 통과 |
| Step 5 | `reportValidator.ts` + `systemPrompt.ts` | 실행팀 | Phase 1 → ERROR, 발송 차단 연동 |
| Step 6 | 테스트 파일 보강 | 실행팀 | 신규 케이스 모두 green |

**병렬 가능**: Step 2, Step 3, Step 4는 독립적이므로 동시 실행 가능.
**의존성**: Step 1 완료 후 Step 5 연동 확인.

## 리스크

**Step 1 발송 차단의 false positive 위험**: `validateReport`가 errors를 발행하면 리포트 전체가 차단된다. `checkPhase2RatioRange`가 마크다운에서 "Phase 2: XX%" 패턴을 탐색하는데, 정상적인 서술(예: "Phase 2: 35.2%")은 통과한다. 하지만 LLM이 "Phase 2 비율: 2330.0%"처럼 쓰지 않고 다른 포맷으로 쓸 경우 패턴 미매칭 → 에러 미감지 가능성. 정규식 패턴 `/Phase\s*2[^:]*:\s*([\d,]+(?:\.\d+)?)\s*%/gi` 커버리지가 충분한지 테스트 케이스로 검증 필요.

**Step 2 쿼리 성능**: `getMarketBreadth`에 JOIN이 추가되면 쿼리 성능이 저하될 수 있다. `symbols` 테이블에 `is_actively_trading`, `is_etf`, `is_fund` 인덱스 존재 여부 확인 필요. 없으면 쿼리 플랜 확인 후 인덱스 추가 검토.

**Step 5 Phase 1 ERROR 격상의 운영 영향**: `saveRecommendations.ts`는 여전히 Phase 1 종목을 `[기준 미달]` 태그와 함께 저장한다. DB 저장은 유지하되 리포트 발송만 차단하는 설계이므로, `validateReport`에 넘기는 `recommendations` 배열을 구성하는 호출자(`sendDiscordReport.ts`)에서 phase 정보를 포함해야 한다. 현재 `appendValidationWarnings`는 markdown 텍스트만 파싱하므로, `validateReport`의 `recommendations` 파라미터가 실제로 채워지려면 `createSendDiscordReport`에 recommendations 정보가 전달되어야 한다. **현재 `sendDiscordReport`의 `execute` 시그니처에 recommendations 파라미터가 없다** — 이를 추가하거나, 대신 markdown 텍스트에서 `[기준 미달]` 태그를 탐지하는 방식으로 구현 선택 필요.

## 의사결정 필요

**없음** — 아래 판단은 자율 결정으로 진행:

1. **Step 5 구현 방식**: `sendDiscordReport`의 execute가 recommendations 파라미터를 받도록 확장하는 것은 인터페이스 변경이 크다. 대신 markdown에서 `[기준 미달]` 태그 또는 "Phase 1" 키워드를 탐지하는 방식이 더 단순하다. 단순한 텍스트 탐지 방식으로 먼저 구현 후, 필요 시 구조적 파라미터 방식으로 개선한다.

2. **Step 2 전일 비율 쿼리 복잡도**: 서브쿼리에 JOIN이 중첩되면 쿼리가 복잡해진다. 필터 일관성이 더 중요하므로 복잡도를 감수한다.
