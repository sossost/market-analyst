# 주간 리포트 HTML 전환 + 섹션 구조 개편

GitHub Issue: #631

## 선행 맥락

- `weekly-report-redesign` (2024) — 주간 리포트 전면 재설계. 도구에 `mode: "weekly"` 추가, 섹터 로테이션 분석 강화. 현재 운영 중인 5섹션 구조의 전신.
- `html-daily-report` — 일간 리포트 HTML 전환. `htmlReport.ts`, `reportPublisher.ts` 인프라 구축. GitHub Pages (`sossost/market-reports`) 발행 파이프라인 확립.
- `industry-rs-ranking` / `industry-rs-top10-cap` — 업종 RS Top 10 섹터당 2개 제한 + HTML 렌더링. `getLeadingSectors(mode: "industry")` 도구 이미 존재.
- `insight-briefing-pivot` (F11) — 추천→관심종목 전환, 5중 교집합 게이트, 90일 트래킹. 현재 주간 프롬프트의 기반.
- 메모리 기록 — 5중 AND 게이트의 퍼널 역산, 섹터 vs 업종 해상도 문제, SEPA S/A가 0건이어도 정상임을 확립.

## 골 정렬

ALIGNED — Phase 2 초입 포착의 "주간 의사결정 단일 허브"가 된다.

- 섹션 2(업종 RS 주간 변화 Top 10)는 자금 유입 초기 신호를 섹터보다 먼저 포착한다. 섹터 RS는 11개 대분류라 이미 알려진 뒤에 반응하지만, 업종 RS 변화는 135개 세분류로 실제 자금 흐름 방향을 먼저 드러낸다.
- 섹션 5(다음 주 관전 포인트)는 Phase 1 후기→2 임박 종목을 미리 식별하는 "예측 레이어"다. 이것이 핵심 알파 소스다.
- HTML 전환은 도구가 아닌 전달 품질이므로 SUPPORT가 아니라 ALIGNED다. 가독성이 떨어지면 인사이트가 소비되지 않는다.

## 문제

주간 리포트가 Discord 텍스트 메시지 4개로 발행되어 구조화된 정보 전달이 어렵고, 섹션 구조가 Thesis 적중률/시스템 성과 같은 내부 메트릭 위주라 투자자 의사결정에 필요한 정보가 빠져 있다. 업종 RS 주간 변화(자금 유입 초기 신호)와 다음 주 관전 포인트(예측 레이어)가 없어 Phase 2 초입 포착 목적을 절반만 달성하고 있다.

## Before → After

**Before**
- Discord 텍스트 4개 메시지 발행 (메시지 1: 시장 구조 변화, 메시지 2: 관심종목 궤적, 메시지 3: 신규 등록/해제, 메시지 4: Thesis 적중률 + 시스템 성과)
- 섹션 4(Thesis 적중률), 섹션 5(시스템 성과)가 내부 QA 성격으로 투자자 리포트에 부적합
- 업종 RS 주간 변화 데이터 없음 — 섹터 로테이션만 보고 업종 단위 자금 흐름 불가
- 다음 주 관전 포인트 없음 — 현재 상태 요약에 그쳐 예측 레이어 부재
- MD 파일은 Gist fallback 의존으로 URL 안정성 불확실

**After**
- Discord 링크 메시지 1개 + GitHub Pages HTML 리포트 (일간과 동일한 파이프라인)
- 5섹션 구조: 시장 구조 변화 / 업종 RS Top 10 / 관심종목 궤적 / 신규 등록-해제 / 다음 주 관전 포인트
- Thesis 적중률, 시스템 성과 섹션 삭제
- 섹션 2: `getLeadingSectors(mode: "industry")` 기반 업종 RS 이번 주 변화량 Top 10 — 자금 유입 초기 신호
- 섹션 5: Phase 1 후기→2 임박, RS 가속 업종, thesis 기반 시나리오 — 예측 레이어
- `reportPublisher.ts`의 `weekly/` 경로 지원 추가

## 변경 사항

### 1. `src/lib/reportPublisher.ts`

- `publishHtmlReport(html, date, type?)` — `type: "daily" | "weekly"` 파라미터 추가
- 기본값 `"daily"` 유지 → 기존 일간 파이프라인 무변경
- `weekly` 시 GitHub Pages 저장 경로를 `daily/{date}/` → `weekly/{date}/` 로 분기
- URL 반환: `https://sossost.github.io/market-reports/weekly/{date}/`

### 2. `src/lib/htmlReport.ts`

- `buildHtmlReport(markdown, title, date)` 그대로 재사용
- 주간 전용 CSS 변수/스타일 추가 불필요 — 기존 화이트 모드 스타일로 충분
- 주간 리포트 헤더 타이틀은 에이전트가 `markdownContent` 첫 줄에 포함하도록 프롬프트에서 명시

### 3. `src/agent/reviewAgent.ts`

- `tryPublishHtmlReport(markdownContent, draftMessage, date, reportType?)` — `reportType` 파라미터 추가
- `reportType: "weekly"` 시 `publishHtmlReport(html, date, "weekly")` 호출
- `runReviewPipeline(drafts, webhook, options)` — 기존 `options.date`를 주간 에이전트가 전달 (현재 미전달 → 이 부분 수정)

### 4. `src/agent/run-weekly-agent.ts`

- `runReviewPipeline` 호출 시 `options.date` 추가 (현재 누락 — Gist fallback만 동작)
- `options.reportType: "weekly"` 추가
- Discord 발송 방식: 에이전트가 메시지를 여러 번 `send_discord_report` 호출하는 방식에서 → 단일 마크다운 + 링크 방식으로 전환 (에이전트는 `markdownContent`에 전체 리포트 담고, Discord는 링크 메시지 1개 발송)

### 5. `src/agent/systemPrompt.ts` — `buildWeeklySystemPrompt()`

기존 5섹션(시장 구조 / 관심종목 궤적 / 신규 등록-해제 / Thesis 적중률 / 시스템 성과)을 아래 5섹션으로 교체:

#### 섹션 1: 주간 시장 구조 변화 (기존 섹션 1 + 업종 RS 추가)

**워크플로우:**
1. `get_index_returns(mode: "weekly")` — 주간 지수 수익률
2. `get_market_breadth(mode: "weekly")` — Phase 2 비율 5일 추이
3. `get_leading_sectors(mode: "weekly")` — 섹터 로테이션 (전주 대비 순위 변동)

**추가:** 섹터 로테이션 분석에 업종 클러스터 컨텍스트(`sectorClusterContext`) 활용 명시

#### 섹션 2: 업종 RS 주간 변화 Top 10 (신규)

**목적:** 이번 주 RS 변화량이 가장 큰 업종 10개 = 자금 유입 초기 신호

**워크플로우:**
4. `get_leading_sectors(mode: "industry")` — 전체 업종 RS + change_4w 정렬
5. 이번 주 RS 변화량(`rsChange`) 기준 정렬 — change_4w에서 1주치 변화를 추산하거나, 도구가 반환하는 현재 avgRs와 전주 avgRs 차이 사용

**주의:** `getLeadingSectors(mode: "industry")` 도구는 이미 `change_4w`, `change_8w`, `change_12w`와 `avgRs`를 반환한다. 단, 이 도구는 1주 변화량(`changeWeek`)을 직접 반환하지 않는다. 에이전트는 이 도구를 2회 호출(이번 주 + 전주)하거나, `change_4w`에서 추세를 추론한다. **→ `get_leading_sectors(mode: "industry")`에 `prevWeekDate` 기준 전주 데이터를 포함한 별도 쿼리 추가가 필요하다. 이는 의사결정 사항으로 하단에 기록.**

**리포트 포맷 — 섹션 2:**
```
## 업종 RS 주간 변화 Top 10 — 자금 유입 초기 신호

| 순위 | 업종 | 섹터 | RS | 주간 변화 | Phase |
|------|------|------|----|-----------| ------|
| 1    | Semiconductors | Technology | 72.3 | ▲+8.2 | 2 |
...

해석: [상위 3개 업종의 공통점 또는 자금 흐름 방향 1~2줄]
```

#### 섹션 3: 관심종목 궤적 (기존 섹션 2 + 서사 유효성 보강)

**워크플로우:**
6. `get_watchlist_status(include_trajectory: true)` — Phase 궤적 포함
7. 각 종목의 등록 당시 thesis/서사가 이번 주 데이터로 여전히 유효한지 판단 (thesis 컨텍스트 활용)

**추가 판단 규칙:**
- thesis는 ACTIVE이지만 종목의 업종 RS가 지난 2주 연속 하락 → "서사는 유효하나 종목 선택 재검토" 표기
- Phase 2 유지 + thesis 가속 → "서사 가속" 표기

#### 섹션 4: 신규 관심종목 등록/해제 (기존 섹션 3 그대로)

기존 5중 교집합 게이트 유지. 변경 없음.

**워크플로우:**
8. `get_phase2_stocks()` + `get_phase1_late_stocks()` + `get_rising_rs()` + `get_fundamental_acceleration()`
9. `read_report_history()` + `get_stock_detail()` + `search_catalyst()`
10. `save_watchlist()`

#### 섹션 5: 다음 주 관전 포인트 (신규)

**목적:** 다음 주 Phase 2 전환이 임박한 종목/업종을 미리 식별. 예측 레이어.

**워크플로우:**
11. 섹션 2 결과에서 RS 급가속 업종 중 Phase 1 후기 종목 목록 추출 (`get_phase1_late_stocks()` 결과 활용)
12. thesis 기반 시나리오 — ACTIVE thesis 중 "이번 주 데이터로 진전이 보인 것" vs "아직 관망인 것" 구분

**리포트 포맷 — 섹션 5:**
```
## 다음 주 관전 포인트

### Phase 1 후기 → 2 임박 (N종목)
• SYMBOL — [업종 RS ▲ + Phase 1 후기 + 근거]

### RS 가속 업종 — 이번 주 Top 3
• [업종명] — [RS 변화 + 소속 섹터 + 의미]

### Thesis 기반 시나리오
• [thesis 요약] → 다음 주 확인 포인트: [구체적 지표]
```

### 6. MD 구조 (markdownContent) 변경

기존 6개 챕터 → 5개 챕터:

1. 주간 시장 구조 변화 — Phase 2 비율 5일 추이 표, 섹터 RS 전주 대비 변동 테이블
2. 업종 RS 주간 변화 Top 10 — 변화량 테이블, 자금 흐름 해석
3. 관심종목 궤적 — Phase 궤적 표, 서사 유효성 평가
4. 신규 등록/해제 — 5중 게이트 평가 근거, 해제 원인
5. 다음 주 관전 포인트 — Phase 2 임박 종목, RS 가속 업종, thesis 시나리오

삭제: Thesis 검증 상세, 시스템 성과 트래킹

## 작업 계획

### Phase 1: 발행 파이프라인 수정 (2개 파일)

**P1-1. `reportPublisher.ts` 수정**
- 담당: 구현 에이전트
- 완료 기준: `publishHtmlReport(html, date, "weekly")` 호출 시 `weekly/{date}/index.html`로 push, URL `weekly/{date}/` 반환. 기존 `daily` 경로 무변경.
- 테스트: `publishHtmlReport` 함수에 `type` 파라미터 추가 유닛 테스트

**P1-2. `reviewAgent.ts` 수정**
- 담당: 구현 에이전트
- 완료 기준: `tryPublishHtmlReport`가 `reportType` 받아 `publishHtmlReport`에 전달. `runReviewPipeline`이 `options.date` + `options.reportType` 조합으로 올바르게 라우팅.
- 테스트: 기존 테스트 무변경 (인터페이스 확장만)

### Phase 2: 업종 RS 주간 변화 DB 쿼리 추가

Option A 채택 확정: `getLeadingSectors(mode: "industry")`에 `prevWeekDate` 기반 전주 데이터 JOIN 추가 → `changeWeek` 필드 반환.

**P2-1. `sectorRepository` — `findIndustriesWeeklyChange` 쿼리 추가**
- 담당: 구현 에이전트
- 완료 기준: `industry_rs_daily`에서 현재 주 RS와 전주 RS 차이(`changeWeek`) 계산, 변화량 내림차순 반환.
- 테스트: 쿼리 결과 구조 유닛 테스트

**P2-2. `getLeadingSectors` 도구 — `changeWeek` 필드 추가**
- 담당: 구현 에이전트
- 완료 기준: `mode: "industry"` 반환에 `changeWeek` 필드 존재.
- 테스트: 도구 반환 구조 테스트

### Phase 3: 주간 에이전트 + 프롬프트 재설계

의존성: Phase 1, Phase 2 완료 후.

**P3-1. `buildWeeklySystemPrompt()` 전면 재작성**
- 담당: 구현 에이전트
- 완료 기준: 5개 신규 섹션이 워크플로우 포함해서 기술됨. Discord 발송 방식 변경 (단일 마크다운 → 링크). 기존 섹션 4, 5 삭제.
- 테스트: 없음 (LLM 프롬프트 — 통합 테스트로 검증)

**P3-2. `run-weekly-agent.ts` 수정**
- `runReviewPipeline(reportDrafts, "DISCORD_WEEKLY_WEBHOOK_URL", { reportType: "weekly", date: targetDate })` — `date` 누락 버그 수정 포함
- 완료 기준: 주간 실행 후 GitHub Pages `weekly/{date}/` 발행 + Discord에 HTML URL 링크 포함 메시지 발송

## 리스크

1. **`reportPublisher.ts` 경로 분기**: `weekly/` 폴더를 GitHub Pages `market-reports` 레포에 처음 push하면 Jekyll이 `index.html` 자동 인식. 별도 설정 불필요. 리스크 낮음.

2. **주간 에이전트 단일 Discord 메시지 전환**: 기존 프롬프트는 `send_discord_report`를 여러 번 호출하도록 설계되어 있다. 단일 `markdownContent`로 전환 시 에이전트가 프롬프트를 올바르게 따르지 않을 수 있다. → 프롬프트에 "단 1회 `send_discord_report` 호출, `markdownContent`에 전체 리포트 포함" 명시. 기존 `createDraftCaptureTool`이 draft 배열을 처리하므로 N회 호출해도 파이프라인은 동작하지만, HTML URL은 마지막 `markdownContent` 기준 생성됨.

3. **업종 RS 주간 변화 계산**: `industry_rs_daily`에 `change_4w` 컬럼은 있으나 `change_1w`(주간 변화)는 없다. 현재 `findPrevWeekDate`가 `sector_rs_daily` 기준으로 구현되어 있어, 업종용 `findPrevWeekIndustries` 쿼리가 추가로 필요하다.

4. **Discord 발송 메시지 수 감소**: 기존 4개 메시지에서 1개 링크 메시지로. Discord 채널 구독자가 내용을 보려면 링크를 클릭해야 한다. 수용 가능한 UX 변화.

## 의사결정 필요

### 결정 1: 업종 RS 주간 변화 계산 방식

**배경:** `getLeadingSectors(mode: "industry")` 도구는 `change_4w`(4주 변화)를 반환하지만 `change_1w`(이번 주 변화량)는 없다. 섹션 2의 "이번 주 RS 변화량이 큰 업종 Top 10"을 정확히 뽑으려면 전주 avgRs가 필요하다.

**Option A: DB 쿼리 수정 (권장)**
- `sectorRepository.ts`에 `findIndustriesWeeklyChange(date, prevWeekDate, limit)` 쿼리 추가
- `industry_rs_daily curr LEFT JOIN industry_rs_daily prev ON prev.date = prevWeekDate` → `curr.avg_rs - prev.avg_rs AS change_1w` 계산
- 도구에 `mode: "industry-weekly"` 추가 또는 기존 `industry` 모드에 `changeWeek` 필드 포함
- 장점: 정확한 주간 변화량, 에이전트 호출 1회
- 단점: 코드 변경 필요

**Option B: 에이전트 2회 호출**
- 이번 주 + 전주 `get_leading_sectors(mode: "industry")` 각각 호출, 에이전트가 직접 차이 계산
- 장점: 코드 변경 없음
- 단점: 도구 호출 2회 추가 (토큰/시간 비용), 에이전트 계산 오류 가능성

**판단:** Option A 권장. 주간 변화량은 섹션 2의 핵심 데이터인데, 에이전트 계산에 의존하면 오류 가능성이 생긴다. DB 쿼리 추가는 30줄 내외의 단순 작업이다.

### 결정 2: Discord 발송 방식

**배경:** 현재 주간 프롬프트는 섹션별로 `send_discord_report`를 여러 번 호출한다. HTML 전환 후에는 링크 1개 + 간단 요약 메시지로 충분하다.

**Option A: 단일 메시지 (HTML 링크 + 1~2줄 요약)**
- Discord 메시지: "📊 주간 시장 분석 (MM/DD ~ MM/DD)\n🔗 [리포트 링크]"
- 장점: 깔끔함, Discord 스크롤 오염 없음
- 단점: 링크 클릭 없이 내용 확인 불가

**Option B: 핵심 요약 메시지 + HTML 링크**
- Discord 메시지 1개: 지수 수익률 + Phase 2 추이 + 신규 등록 종목 수 + 링크
- 장점: Discord에서 핵심만 즉시 확인 가능
- 단점: 메시지 일부 텍스트 유지

**판단:** Option B 권장. Discord 알림을 열었을 때 "이번 주 뭔가 있었나" 즉각 판단 가능해야 한다. 지수 수익률, Phase 추이, 신규 등록 N건 정도는 텍스트로 포함.

### 결정 3: `htmlReport.ts` 확장 vs 별도 주간 렌더러

**배경:** 현재 `buildHtmlReport(markdown, title, date)`는 일간 리포트 전용 시맨틱 렌더러를 포함한다 (`renderMarketTemperatureSection`, `tryRenderIndexGrid` 등). 주간 리포트는 섹션 구조가 다르다(업종 RS 변화 테이블, 관전 포인트 리스트 등).

**Option A: 기존 `buildHtmlReport` 그대로 사용 (권장)**
- 마크다운을 `marked`로 렌더링하는 폴백 경로가 이미 존재
- 시맨틱 렌더러가 매칭 실패하면 그냥 `marked.parse()` 사용
- 장점: 코드 변경 없음, 즉시 적용 가능
- 단점: 주간 전용 시각화(업종 RS 변화 바 차트 등) 불가

**Option B: 주간 전용 렌더러 추가**
- `buildWeeklyHtmlReport(markdown, title, date)` 신규 함수
- 업종 RS 변화 테이블, 관전 포인트 카드 등 전용 시맨틱 렌더링
- 장점: 시각적으로 최적화된 주간 리포트
- 단점: 약 200~300줄 추가 코드, 현재 요구사항에 과잉

**판단:** Option A 권장. 첫 버전은 `marked` 폴백으로 충분히 동작하며, 향후 주간 리포트 활용이 검증되면 Option B로 확장 가능하다. 지금 별도 렌더러를 만들면 에이전트가 출력하는 마크다운 구조에 맞게 계속 유지보수해야 하는 부담이 생긴다.
