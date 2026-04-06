# Plan: 일간 리포트 데이터/인사이트 분리 + API→CLI 전환

GitHub Issue: #649

---

## 선행 맥락

`feedback_data_programmatic_llm_insight.md` — "데이터 테이블은 프로그래밍으로, LLM은 해석만. LLM에 데이터 렌더링 시키지 마라."

`weekly-report-data-llm-split` 피처(#636) — 주간 리포트에서 동일 아키텍처를 완료. `weekly-html-builder.ts`, `weeklyReportSchema.ts`, CLI 단발 호출 패턴이 검증됨.

`htmlReport.ts` 2,194줄 역파서는 LLM이 생성한 마크다운 구조에 의존한다. 주간은 이미 우회했고, 일간이 마지막 남은 코드패스다.

`html-daily-report` 피처 — 일간 HTML 리포트 도입 이력 존재. 기존 CSS 변수·디자인 패턴을 그대로 재사용한다.

Issue #632(일간 종목 스크리닝 제거) 흡수 — `get_phase2_stocks`, `get_phase1_late_stocks` 일간에서 제거.

---

## 골 정렬

**ALIGNED** — 비결정적 숫자 생성을 제거하면 Phase 2 포착 판단의 데이터 신뢰도가 직접 높아진다. $3~5/회 API 비용 제거는 부가적 효과다.

---

## 문제

`run-daily-agent.ts`가 `runAgentLoop` 15 iteration으로 실행된다. LLM이 지수 수익률·Phase 분포·섹터 RS 같은 확정 데이터를 직접 마크다운으로 작성한다. 그 결과:

1. 같은 데이터를 5번 돌리면 5번 다른 숫자가 나올 수 있다
2. `htmlReport.ts` 2,194줄이 LLM 출력 구조를 역파싱해야 한다 — 파싱 실패 시 레이아웃 깨짐
3. API 비용 $3~5/회 (Sonnet × 15 iteration)
4. 토큰 낭비: 확정 데이터를 LLM이 토큰으로 다시 작성

---

## Before → After

**Before**:
- `runAgentLoop(15 iterations)` → LLM이 마크다운 전체 작성 → `reviewAgent`가 마크다운 역파싱 → `buildHtmlReport` (htmlReport.ts) → Supabase Storage

**After**:
- 도구 직접 호출(프로그래밍) → `DailyReportData` 구성
- `ClaudeCliProvider.call(단발)` → `DailyReportInsight` JSON 수신
- `buildDailyHtml(data, insight, date)` → HTML 직접 조립 → Supabase Storage
- `htmlReport.ts` 완전 제거

---

## 합성 아키텍처

주간과 동일한 슬롯 기반 HTML 합성 패턴을 적용한다.

### LLM이 담당하는 것 (DailyReportInsight)

텍스트 판단과 해석만. 숫자 계산, 테이블 렌더링, 카운팅 금지.

- `marketTemperature`: bullish / neutral / bearish
- `marketTemperatureLabel`: 한 줄 판단 레이블 (예: "약세 — 하락 3일째")
- `marketTemperatureRationale`: 2~3문장. 시장 온도 판단 근거. 데이터 나열 금지, 해석만.
- `unusualStocksNarrative`: 2~3문장. 특이종목 공통 테마 또는 이질적 패턴 해석. 없으면 "해당 없음".
- `risingRSNarrative`: 1~2문장. RS 상승 초기 종목군의 공통 업종/테마 관찰. 없으면 "해당 없음".
- `watchlistNarrative`: 관심종목이 있는 경우 1~2문장. ACTIVE 종목 서사 유효성. 없으면 "해당 없음".
- `todayInsight`: 토론 인사이트가 있는 경우 2~3문장 핵심만. 없으면 "해당 없음".
- `discordMessage`: 3~5줄. 지수 변화 + Phase2 비율 + 특이종목 수 요약. 링크 금지.

### 프로그래밍이 담당하는 것 (DailyReportData)

도구 반환값을 직접 렌더링. LLM이 절대 이 필드의 숫자를 재작성하지 않는다.

- 지수 수익률 테이블 (get_index_returns)
- Fear & Greed 지수 (get_index_returns 포함)
- Phase 분포 + Phase 2 비율 추이 (get_market_breadth)
- 섹터 RS 랭킹 (get_leading_sectors mode=daily)
- 업종 RS Top 10 (get_leading_sectors mode=industry)
- 특이종목 목록 (get_unusual_stocks)
- RS 상승 초기 종목 (get_rising_rs) — 관찰 목적, 일간 적합
- 관심종목 현황 (get_watchlist_status)

### 제거 도구 (#632 흡수)

`get_phase2_stocks`, `get_phase1_late_stocks` — 일간 컨텍스트에서 제거. 주간 리포트에서 이미 5중 게이트로 처리됨. 일간에서 중복 스크리닝은 이슈 #632 근거에 따라 불필요.

`searchCatalyst`, `getStockDetail` — LLM이 종목별 상세 분석을 하지 않으므로 제거. 특이종목 해석은 LLM의 `unusualStocksNarrative` 필드로 대체.

`saveRecommendations` — 일간 에이전트가 추천 저장을 직접 호출하는 구조 제거. ETL이 자동 스캔·저장.

`createDraftCaptureTool`, `createReportLogCaptureTool` — agentLoop 제거와 함께 불필요.

---

## 변경 파일

### 신규 생성

| 파일 | 역할 |
|------|------|
| `src/tools/schemas/dailyReportSchema.ts` | DailyReportData + DailyReportInsight 타입 정의, fillInsightDefaults |
| `src/lib/daily-html-builder.ts` | 일간 리포트 HTML 직접 렌더링 — 데이터 블록 프로그래밍 렌더링 + 해석 블록 marked 변환 합성 |
| `scripts/preview-daily-html.ts` | 실 DB 데이터로 일간 HTML 미리보기 생성 스크립트 |

### 수정

| 파일 | 변경 내용 |
|------|-----------|
| `src/agent/run-daily-agent.ts` | runAgentLoop 제거 → 도구 직접 호출 + ClaudeCliProvider 단발 호출. 환경변수에서 ANTHROPIC_API_KEY 제거 |
| `src/agent/prompts/daily.ts` | 워크플로우 지시(1~11단계) 제거, 해석 필드 JSON 반환 구조로 전환, 테이블 생성 지시 제거 |
| `src/agent/reviewAgent.ts` | `buildHtmlReport` import 제거. 일간용 `tryPublishHtmlReport` 경로 제거 또는 `buildDailyHtml` 사용으로 교체 |

### 삭제

| 파일 | 사유 |
|------|------|
| `src/lib/htmlReport.ts` (2,194줄) | 마지막 참조처(reviewAgent.ts)가 제거되면 완전 삭제 |
| `src/lib/__tests__/htmlReport.test.ts` (803줄) | 대상 파일 삭제와 함께 제거 |

### 참조 확인 (영향 없음)

`buildHtmlReport`의 유일한 import처는 `src/agent/reviewAgent.ts:9`다. 다른 파일에서 직접 import하는 곳 없음 (grep 확인 완료).

---

## 작업 계획

### Phase 0: 스키마 + 도구 구조 설계 (선행, 단독)

| # | 작업 | 파일 | 완료 기준 |
|---|------|------|-----------|
| 0-A | DailyReportData + DailyReportInsight 스키마 정의 | `src/tools/schemas/dailyReportSchema.ts` | 타입 정의 + fillInsightDefaults 구현 완료 |

**스키마 설계 원칙**:
- `DailyReportData`의 모든 필드는 도구 반환값에서 직접 매핑. LLM이 채우지 않는다.
- `DailyReportInsight`의 모든 필드는 텍스트 전용. 숫자·카운트·퍼센트 금지.
- 주간 스키마(`weeklyReportSchema.ts`)의 패턴을 그대로 따른다.

실제 도구 반환 타입 확인 후 스키마 정렬:
- `getIndexReturns` — `date` 파라미터로 일간 데이터 수집
- `getMarketBreadth` — `mode: 'daily'`
- `getLeadingSectors` — `mode: 'daily'` (섹터), `mode: 'industry'` (업종 Top 10)
- `getUnusualStocks` — 특이종목
- `getRisingRS` — RS 상승 초기 관찰 (일간 유지, #632 원안 존중)
- `getWatchlistStatus` — `include_trajectory: false` (일간은 궤적 불필요)

### Phase 1: HTML 빌더 구현 (Phase 0 완료 후)

| # | 작업 | 파일 | 완료 기준 |
|---|------|------|-----------|
| 1-A | `daily-html-builder.ts` 구현 | `src/lib/daily-html-builder.ts` | 렌더링 함수 8개 구현, buildDailyHtml 조립 함수 완성 |
| 1-B | 단위 테스트 | `src/lib/__tests__/daily-html-builder.test.ts` | 빈 배열/null 케이스 포함 80%+ 커버리지 |

**렌더링 함수 목록**:
- `renderIndexTable(data: DailyIndexReturn[], fearGreed: FearGreedData | null): string`
- `renderPhaseDistribution(data: DailyBreadthSnapshot): string` — Phase 분포 + Phase 2 비율
- `renderSectorTable(data: DailySectorItem[]): string` — 섹터 RS 랭킹
- `renderIndustryTop10Table(data: DailyIndustryItem[]): string` — 업종 RS Top 10
- `renderUnusualStocksSection(stocks: DailyUnusualStock[], narrative: string): string` — 특이종목 카드 + LLM 해석
- `renderRisingRSSection(stocks: DailyRisingRSStock[], narrative: string): string` — RS 상승 초기 종목 + LLM 해석
- `renderWatchlistSection(data: DailyWatchlistData, narrative: string): string` — 관심종목 현황
- `renderInsightSection(insight: DailyReportInsight): string` — 온도 판단 + 토론 인사이트
- `buildDailyHtml(data: DailyReportData, insight: DailyReportInsight, date: string): string` — 최종 HTML 조립

**색상 규칙 준수**: `--up: #cf222e` (상승=빨강), `--down: #0969da` (하락=파랑). `weekly-html-builder.ts`의 CSS 변수와 동일하게 유지.

**주간 빌더 재사용**: CSS, escapeHtml, markedInstance 패턴을 `weekly-html-builder.ts`에서 그대로 복사. 중복이지만 파일 분리가 결합도 관리에 유리하다.

### Phase 2: 에이전트 수정 (Phase 1 완료 후)

| # | 작업 | 파일 | 완료 기준 |
|---|------|------|-----------|
| 2-A | 프롬프트 간결화 | `src/agent/prompts/daily.ts` | 워크플로우 지시 제거, JSON 응답 구조 명시, 각 필드 2~3문장 상한 지시 |
| 2-B | `run-daily-agent.ts` 전환 | `src/agent/run-daily-agent.ts` | runAgentLoop 제거, 도구 직접 호출 + ClaudeCliProvider 단발 호출, ANTHROPIC_API_KEY 환경변수 불필요 |
| 2-C | QA 시스템 처리 | `src/agent/run-daily-agent.ts` | dailyQA, withQAWarning 제거 또는 data 기반으로 재작성 (QA는 data에서 직접 검증 가능하므로 LLM 의존 불필요) |

**2-A 프롬프트 변경 방향**:

Before (제거 대상): 10단계 워크플로우, 마크다운 템플릿, 섹션 구조 지시 전체

After (유지): 판단 원칙 + JSON 필드별 작성 지침
```
당신은 미국 주식 시장 분석 전문가입니다.
아래 수집된 데이터를 기반으로 해석과 판단만 작성합니다.
데이터 테이블 작성 금지 — 이미 프로그래밍으로 렌더링됩니다.

## 작성 규칙
- 각 필드 2~3문장 이내. 장황한 설명 금지.
- 판단과 근거만. 데이터 나열/반복 금지.
- 정보가 없거나 할 말이 없으면 "해당 없음" 한 줄.
- 숫자 인용 시 제공된 데이터의 정확한 값만 사용.
- 반드시 유효한 JSON만 출력.
```

**2-B 에이전트 흐름 변경**:

Before: `runAgentLoop(config)` → 에이전트가 도구 직접 호출 + 마크다운 생성 + send_discord_report

After:
1. 도구 병렬 직접 호출 → `DailyReportData` 구성 (주간의 `collectWeeklyData` 패턴)
2. `ClaudeCliProvider.call({ system, user: dataSummary })` — JSON 응답 수신
3. `fillInsightDefaults(parsed)` → `DailyReportInsight`
4. `buildDailyHtml(data, insight, date)` → HTML
5. `publishHtmlReport(html, date, 'daily')` → Storage URL
6. Discord 발송 (URL 포함)
7. `updateReportFullContent(date, 'daily', html)` → DB 저장

**2-C QA 처리**:
- 기존 `dailyQA`는 LLM 리포트의 수치를 DB 원본과 대조하는 구조. 프로그래밍 렌더링 후에는 데이터가 DB에서 직접 오므로 대조 불필요.
- `withQAWarning`, `createReportLogCaptureTool`, `reportQAIssue` 로직 제거.
- `priceDeclineFilter`(급락 경고)는 Discord 메시지에 독립적으로 추가 가능하지만, 일간 리포트에서 제거해도 무방. 이슈 #649 범위 판단: 제거.

### Phase 3: htmlReport.ts 제거 (Phase 2 완료 후)

| # | 작업 | 파일 | 완료 기준 |
|---|------|------|-----------|
| 3-A | `reviewAgent.ts`에서 buildHtmlReport 제거 | `src/agent/reviewAgent.ts` | `import { buildHtmlReport }` 제거, `tryPublishHtmlReport` 함수 제거 또는 단순화 |
| 3-B | `htmlReport.ts` + 테스트 삭제 | `src/lib/htmlReport.ts`, `src/lib/__tests__/htmlReport.test.ts` | 파일 삭제 후 빌드 통과 |

**주의**: Phase 2 완료 전까지 `htmlReport.ts`를 삭제하지 않는다. `reviewAgent.ts`의 `sendDrafts`가 `tryPublishHtmlReport`를 호출하는 경로가 남아있으면 빌드 오류.

### Phase 4: 검증 (Phase 3 완료 후)

| # | 작업 | 완료 기준 |
|---|------|-----------|
| 4-A | 프리뷰 스크립트 실행 | `yarn ts-node scripts/preview-daily-html.ts` → `preview-daily.html` 생성. 브라우저에서 지수 테이블, Phase 분포, 섹터 테이블, 업종 Top 10, 특이종목 카드, 관심종목 섹션 렌더링 확인 |
| 4-B | 빌드 + 테스트 통과 | `yarn tsc --noEmit` 오류 없음. `yarn test` 80%+ 커버리지 통과 |
| 4-C | 비용 검증 | ANTHROPIC_API_KEY 환경변수 없이 실행 가능. 로그에 "CLI Mode" 표기 확인 |

---

## 커밋 단위

```
commit 1: feat: DailyReportData + DailyReportInsight 스키마 정의
commit 2: feat: daily-html-builder.ts — 데이터 블록 프로그래밍 렌더링 8개 함수
commit 3: test: daily-html-builder 단위 테스트
commit 4: refactor: run-daily-agent.ts — runAgentLoop 제거, 도구 직접 호출 + CLI 단발 호출
commit 5: refactor: daily.ts 프롬프트 간결화 — JSON 응답 구조 전환
commit 6: refactor: reviewAgent.ts — buildHtmlReport import 제거
commit 7: chore: htmlReport.ts + htmlReport.test.ts 삭제
commit 8: chore: scripts/preview-daily-html.ts 추가 + 스모크 테스트
```

---

## 의존성

```
Phase 0 (스키마)
    |
    v
Phase 1 (HTML 빌더 + 단위 테스트)   ← Phase 0과 Phase 2-A는 병렬 가능
    |
    v
Phase 2 (에이전트 + 프롬프트 수정)
    |
    v
Phase 3 (htmlReport.ts 삭제)
    |
    v
Phase 4 (검증)
```

병렬 가능: Phase 0(스키마)과 2-A(프롬프트 간결화)는 동시 진행 가능.

---

## 리스크

| 리스크 | 대응 |
|--------|------|
| 도구 반환값 구조가 DailyReportData 스키마와 불일치 | Phase 0에서 도구 타입 파일(getIndexReturns.ts 등) 직접 확인 후 스키마 정렬. 도구 반환 타입 변경 없이 매핑만 |
| LLM이 JSON 스키마를 준수하지 않는 케이스 | `fillInsightDefaults`로 누락 필드 기본값 채움. 주간과 동일 폴백 패턴 |
| reviewAgent.ts 내 sendDrafts가 markdownContent 기반 경로 유지 | Phase 2에서 daily 경로가 HTML 직접 전달로 바뀌면 reviewAgent.ts의 해당 분기는 dead code가 됨. Phase 3에서 함께 정리 |
| dailyQA 제거로 인한 데이터 정합성 모니터링 공백 | 프로그래밍 렌더링은 DB에서 직접 오므로 LLM 오류 가능성 없음. QA는 해석 필드(텍스트)로는 의미 없음 — 제거가 타당 |
| `getUnusualStocks`가 0건 반환하는 날 | `unusualStocksNarrative`에 "해당 없음" + 빌더에서 빈 섹션 처리 |

---

## 의사결정 필요

없음 — 바로 구현 가능.

단, Phase 2-C에서 `priceDeclineFilter`(급락 경고 섹션) 처리 방향을 메모한다:
현재 구조는 LLM 리포트에 텍스트 블록을 주입하는 방식이다. HTML 빌더로 전환하면 별도 섹션으로 프로그래밍 렌더링 가능하나, 일간 리포트에서 급락 경고를 별도 섹션으로 표기하는 것이 Phase 2 포착 목표에 기여하는지 불명확하다. 이번 이슈 범위에서는 제거하고, 필요 시 별도 이슈로 재도입.
