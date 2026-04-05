# 의사결정 기록 — 주간 리포트 HTML 전환 + 섹션 구조 개편

GitHub Issue: #631
날짜: 2026-04-05
상태: proposed

---

## 결정 1: 업종 RS 주간 변화 계산 — DB 쿼리 추가 (Option A 채택)

**선택:** Option A — `sectorRepository.ts`에 `findIndustriesWeeklyChange` 쿼리 신규 추가, `getLeadingSectors(mode: "industry")` 도구에 `changeWeek` 필드 포함.

**맥락:**
섹션 2 "업종 RS 주간 변화 Top 10"은 이 기획의 핵심 신규 가치다. 섹터(11개) 대신 업종(135개)으로 자금 유입 초기 신호를 포착하는 것이 목적이다. 이 데이터가 부정확하면 섹션 2 자체가 의미 없어진다.

**거부된 대안:** Option B(에이전트 2회 호출). 에이전트가 `avgRs` 두 개를 받아 차이를 계산하는 것은 가능하지만, 도구 호출 2회 추가(시간/토큰 비용)와 계산 오류 가능성이 수용하기 어렵다. 특히 135개 업종의 숫자를 컨텍스트에서 두 번 처리하는 것은 불필요한 복잡성이다.

**구현 범위:**
```sql
-- sectorRepository.ts에 추가할 쿼리 (개념)
SELECT curr.sector, curr.industry,
       curr.avg_rs::text,
       curr.rs_rank,
       curr.group_phase,
       curr.phase2_ratio::text,
       (curr.avg_rs - COALESCE(prev.avg_rs, curr.avg_rs))::text AS change_week
FROM industry_rs_daily curr
LEFT JOIN industry_rs_daily prev
  ON curr.industry = prev.industry AND prev.date = $prevWeekDate
WHERE curr.date = $date
ORDER BY (curr.avg_rs - COALESCE(prev.avg_rs, curr.avg_rs))::numeric DESC
LIMIT $limit
```
`findPrevWeekDate()`는 이미 존재하므로 그대로 재사용.

**도구 변경:** `getLeadingSectors(mode: "industry")` 호출 시 내부적으로 전주 날짜를 조회한 뒤 JOIN. 반환 구조에 `changeWeek: number | null` 추가. `change_1w` 컬럼을 DB에 추가하지 않음 — 런타임 계산이 적합하다 (매일 바뀌는 값을 저장하는 것은 `change_4w` 같은 컬럼과 다르게 취급).

**결과:** 에이전트는 단 1회 `get_leading_sectors(mode: "industry")` 호출로 `changeWeek` 기준 정렬된 업종 데이터를 받는다.

---

## 결정 2: Discord 발송 방식 — 핵심 요약 + HTML 링크 (Option B 채택)

**선택:** Option B — Discord 메시지 1개에 핵심 수치 요약 + HTML 링크.

**맥락:**
HTML 전환의 목적은 정보 밀도와 가독성을 높이는 것이다. 그러나 Discord 알림의 즉각적인 가치(링크 클릭 없이 "이번 주 뭔가 있나" 판단)는 유지해야 한다. 현재 4개 메시지에서 1개로 줄이되, 링크만 있는 Option A는 Discord 사용 패턴에 맞지 않는다.

**포맷:**
```
📊 주간 시장 분석 (MM/DD 월 ~ MM/DD 금)

S&P: +X.XX% | NASDAQ: +X.XX% | Phase 2: XX%
신규 관심종목: N종목 | 관찰 중: N종목

📋 전체 리포트: [URL]
```

**에이전트 지시:** 프롬프트에서 `send_discord_report` 1회 호출 명시. `message`에 위 요약, `markdownContent`에 전체 5섹션 포함.

**기존 동작 변경:** 현재 에이전트는 섹션별 4회 호출. 프롬프트 변경으로 1회로 통일. `createDraftCaptureTool`은 draft 배열 관리이므로 1개 draft가 들어오면 자연스럽게 동작.

---

## 결정 3: `htmlReport.ts` 확장 vs 별도 렌더러 — 기존 재사용 (Option A 채택)

**선택:** Option A — `buildHtmlReport()` 그대로 재사용.

**맥락:**
`htmlReport.ts`는 2600줄 이상의 복잡한 파일이다. 시맨틱 렌더러(`renderMarketTemperatureSection` 등)는 특정 패턴을 인식하고 나머지는 `marked.parse()` 폴백으로 처리한다. 주간 리포트의 마크다운을 그대로 넣어도 폴백 경로가 동작하여 시각적으로 수용 가능한 결과가 나온다.

**주간 리포트에서 시맨틱 렌더러가 동작하는 부분:**
- 지수 테이블(`| S&P 500 | 5,200 | +1.2% |`) → `index-grid` 카드 자동 변환
- Phase 2 비율 stat-chip 패턴 인식
- `Phase 2` 텍스트 → `phase-badge p2` 자동 변환

**폴백으로 처리되는 부분(수용):**
- 섹션 2 업종 RS 변화 테이블 → 일반 `<table>` 렌더링
- 섹션 5 관전 포인트 리스트 → `<ul><li>` 렌더링

**향후 확장 기준:** 주간 리포트를 3회 이상 발행한 후, 시각적으로 부족한 부분이 구체적으로 식별되면 그때 전용 렌더러 추가를 검토한다.

---

## 결정 4: Thesis 적중률 / 시스템 성과 섹션 삭제 확정

**선택:** 삭제.

**맥락:**
CEO가 명시적으로 확정. Thesis 적중률과 시스템 성과는 내부 QA 성격으로, 투자자 의사결정에 직접 입력되지 않는다. 이 정보는 `strategic-aide`(전략 참모 자동 리뷰)와 `weekly-qa` 파이프라인이 별도로 처리하므로 주간 리포트에서 중복될 이유가 없다.

**thesis 활용 방식 변경:**
삭제 후에도 `thesesContext`는 시스템 프롬프트에 유지된다. Thesis는 섹션 3(관심종목 서사 유효성), 섹션 4(5중 게이트의 thesis 조건), 섹션 5(다음 주 시나리오)에서 내부 판단 근거로 사용되지만 리포트에서 thesis 검증 결과를 별도 표시하지 않는다.

---

## 결정 5: `reportPublisher.ts` 경로 분기 방식

**선택:** `type` 파라미터 추가, 경로를 `{type}/{date}/`로 통일.

**구현:**
```typescript
export async function publishHtmlReport(
  html: string,
  date: string,
  type: "daily" | "weekly" = "daily",
): Promise<string | null>
```
- `daily` (기본값): `daily/{date}/index.html` — 기존 동작 유지
- `weekly`: `weekly/{date}/index.html`

**URL 형태:**
- 일간: `https://sossost.github.io/market-reports/daily/2026-04-04/`
- 주간: `https://sossost.github.io/market-reports/weekly/2026-04-04/`

이 변경은 기존 `publishHtmlReport` 호출부(reviewAgent.ts의 `tryPublishHtmlReport`)에 기본값이 적용되므로 일간 파이프라인은 수정 불필요.

---

## 결정 6: 주간 에이전트의 `date` 미전달 버그 수정

**현황:** `run-weekly-agent.ts` L303:
```typescript
const sentDrafts = await runReviewPipeline(reportDrafts, "DISCORD_WEEKLY_WEBHOOK_URL", { reportType: "weekly" });
```
`date: targetDate`가 빠져 있다. 이 때문에 `sendDrafts(finalDrafts, webhookEnvVar, date)` 호출 시 `date`가 `undefined`가 되어 HTML 발행 경로 없이 Gist fallback으로 내려간다.

**수정:** `{ reportType: "weekly", date: targetDate }` — `date` 추가. 이것은 기능 추가가 아닌 기존 버그 수정이다.

---

## 아키텍처 결정: 주간 vs 일간 역할 분담

이번 #631 이후 확립되는 명확한 역할 분담:

| 리포트 | 주기 | 핵심 역할 | Phase 기반 종목 스크리닝 |
|--------|------|----------|------------------------|
| 일간 리포트 | 매일 | 시장 온도 + 업종 RS Top 10 일간 스냅샷 | 제거 예정 (#632) |
| 주간 리포트 | 매주 금요일 | 구조적 변화 + 종목 의사결정 허브 | 5중 교집합 게이트 |

**Phase 2 판정이 주봉 기준:** 일간 변동으로 Phase 등락이 있어도 주봉 구조가 더 신뢰할 수 있다. 종목 등록/해제 의사결정은 주간 리포트에서만 이루어진다. 일간 리포트에서 "이번 주 Phase 2 진입 종목" 같은 행위는 #632에서 제거된다.
