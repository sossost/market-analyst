# Plan: 주간 리포트 데이터/인사이트 역할 분리

GitHub Issue: #636

---

## 선행 맥락

`feedback_data_programmatic_llm_insight.md` — "데이터 테이블은 프로그래밍으로, LLM은 해석만. LLM에 데이터 렌더링 시키지 마라."

실제 사고 사례: 04/02 주간 리포트에서 "신규 등록 (0종목)" 헤더 바로 아래 3종목 카드를 나열하는 자기 모순. LLM이 카운트 계산과 렌더링을 동시에 담당하면서 발생. 프로그래밍 렌더링이었으면 구조적으로 불가능한 버그.

`weekly-report-redesign` 피처(#69) — 주간 에이전트 도구/프롬프트 재설계 완료. 이번 이슈는 그 위에 렌더링 책임 분리를 올리는 것.

---

## 골 정렬

**ALIGNED** — 데이터 왜곡 없는 리포트는 Phase 2 포착 판단의 신뢰도를 직접 높인다. LLM이 데이터 테이블을 만들면 숫자가 틀려도 검증 불가. 프로그래밍 렌더링으로 전환하면 데이터 정합성이 보장되고, LLM은 판단/해석 품질에만 집중할 수 있다.

---

## 문제

주간 리포트의 데이터 테이블(지수 수익률, Phase 2 추이, 섹터 로테이션 등)을 LLM이 마크다운으로 생성하고, `htmlReport.ts`가 역파싱한다. LLM은 카운트를 틀리고, 테이블 컬럼을 생략하고, 수치를 조합하는 과정에서 자기 모순을 만든다. 파싱에 실패하면 시맨틱 렌더러가 일반 마크다운으로 폴백한다.

---

## Before → After

**Before**: LLM이 마크다운 전체를 생성 → `htmlReport.ts`가 2,194줄의 역파서로 섹션을 분류 → HTML 렌더링

**After**:
- 확정 데이터 블록(지수/Phase2/섹터 테이블 등): 도구가 구조화 데이터를 반환 → `run-weekly-agent.ts`가 프로그래밍으로 HTML 렌더링
- 해석 블록(섹터 로테이션 해석, 관심종목 서사 유효성, 다음 주 관전 포인트 등): LLM이 JSON 필드로 텍스트만 생성
- 두 블록을 HTML 슬롯으로 합성 → 최종 리포트

---

## 합성 아키텍처 결정

**슬롯 기반 HTML 합성** (마크다운 역파싱 제거):

1. 에이전트가 `send_discord_report` 대신 구조화된 JSON 객체를 반환
   - 데이터 필드: 도구가 이미 반환한 원시 데이터를 그대로 전달 (LLM 재작성 금지)
   - 해석 필드: LLM이 텍스트 블록만 작성

2. `run-weekly-agent.ts`가 JSON을 받아 HTML 직접 조립:
   - 데이터 블록 → 프로그래밍 렌더링 (`buildWeeklyHtml.ts`)
   - 해석 블록 → 마크다운-to-HTML (marked, 최소한의 변환)

3. 조립된 HTML → 기존 Supabase Storage 업로드 경로 재사용

**마크다운 역파싱 완전 제거**: `htmlReport.ts`의 주간 관련 시맨틱 파서(`renderSectorRankingSection`, `renderIndustryRankingSection`, `renderPhaseTransitionBlock` 등) 주간 코드패스에서 제거.

---

## 변경 사항

### 신규 파일

| 파일 | 역할 |
|------|------|
| `src/lib/weekly-html-builder.ts` | 주간 리포트 HTML 직접 렌더링 (프로그래밍 데이터 블록 + 해석 블록 합성) |
| `src/tools/schemas/weeklyReportSchema.ts` | LLM 출력 구조 정의 (zod 스키마, structured output용) |

### 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `src/agent/systemPrompt.ts` | `buildWeeklySystemPrompt` 를 `src/agent/prompts/weekly.ts`로 분리 |
| `src/agent/prompts/daily.ts` | `buildDailySystemPrompt` 분리 수용 |
| `src/agent/run-weekly-agent.ts` | JSON 응답 수집 + `weekly-html-builder.ts` 호출로 HTML 조립 |
| `src/tools/sendDiscordReport.ts` | 주간 전용 도구 `capture_weekly_report` 추가 (JSON 스키마 강제) |
| `src/lib/htmlReport.ts` | 주간 코드패스 제거 (일간 전용으로 축소). 주간 HTML은 `weekly-html-builder.ts`에서 처리 |

---

## 작업 계획

### Phase 0: 스키마 설계 (선행, 단독)

| # | 작업 | 파일 | 완료 기준 |
|---|------|------|-----------|
| 0-A | 주간 리포트 JSON 스키마 정의 | `src/tools/schemas/weeklyReportSchema.ts` | zod 스키마 정의 완료. 데이터 필드 vs 해석 필드 명확히 구분 |

**스키마 구조 (상세)**:

```typescript
// 데이터 필드 — LLM이 채우지 않는다. run-weekly-agent.ts가 도구 결과에서 직접 추출.
interface WeeklyReportData {
  indexReturns: IndexReturn[];         // get_index_returns 반환값
  phase2Trend: Phase2Snapshot[];       // get_market_breadth 반환값 weeklyTrend
  sectorRanking: SectorRS[];           // get_leading_sectors(weekly) 반환값
  industryTop10: IndustryRS[];         // get_leading_sectors(industry) 반환값
  watchlist: WatchlistItem[];          // get_watchlist_status 반환값
  gate5Candidates: GateCandidate[];    // get_phase2_stocks 결과 + 게이트 평가
}

// 해석 필드 — LLM이 텍스트만 작성
interface WeeklyReportInsight {
  sectorRotationNarrative: string;     // 섹터 로테이션 구조적/일회성 판단
  industryFlowNarrative: string;       // 업종 RS 자금 흐름 해석
  watchlistNarrative: string;          // 관심종목 서사 유효성 평가
  gate5Summary: string;                // 5중 게이트 결과 서술 (등록/해제 판단 근거)
  nextWeekWatchpoints: string;         // 다음 주 관전 포인트
  riskFactors: string;                 // 리스크 요인
  thesisScenarios: string;             // Thesis 기반 시나리오
  discordMessage: string;              // Discord 핵심 요약 (3~5줄)
}
```

### Phase 1: HTML 빌더 구현 (Phase 0 완료 후)

| # | 작업 | 파일 | 완료 기준 |
|---|------|------|-----------|
| 1-A | `weekly-html-builder.ts` 구현 | `src/lib/weekly-html-builder.ts` | 기존 CSS 변수 재사용, 데이터 블록 6개 HTML 렌더링 함수 구현 |
| 1-B | 단위 테스트 | `src/__tests__/lib/weekly-html-builder.test.ts` | 각 렌더링 함수에 대해 빈 배열/null 케이스 포함 80%+ 커버리지 |

**렌더링 함수 목록 (1-A)**:
- `renderIndexTable(data: IndexReturn[]): string` — 지수 수익률 테이블
- `renderPhase2TrendTable(data: Phase2Snapshot[]): string` — Phase 2 추이 5거래일
- `renderSectorTable(data: SectorRS[]): string` — 섹터 로테이션 11개 전체
- `renderIndustryTop10Table(data: IndustryRS[]): string` — 업종 RS Top 10
- `renderWatchlistTable(data: WatchlistItem[]): string` — 관심종목 궤적 (Phase 궤적 포함)
- `renderGate5Block(data: GateCandidate[]): string` — 5중 게이트 평가 카드
- `buildWeeklyHtml(data: WeeklyReportData, insight: WeeklyReportInsight, date: string): string` — 최종 HTML 조립

**색상 규칙 준수**: `--up: #cf222e` (상승=빨강), `--down: #0969da` (하락=파랑). 기존 CSS 변수 그대로 사용.

### Phase 2: 프롬프트 분리 + 에이전트 수정 (Phase 1 완료 후)

| # | 작업 | 파일 | 완료 기준 |
|---|------|------|-----------|
| 2-A | 프롬프트 파일 분리 | `src/agent/prompts/weekly.ts`, `src/agent/prompts/daily.ts` | `systemPrompt.ts`에서 두 함수 추출. 기존 `systemPrompt.ts`는 re-export로 호환성 유지 |
| 2-B | `send_discord_report` 도구 주간 버전 분리 또는 JSON 모드 추가 | `src/tools/sendDiscordReport.ts` | 주간 호출 시 JSON 스키마 enforced. 기존 일간 동작 불변 |
| 2-C | 주간 프롬프트에서 데이터 테이블 생성 지시 제거 | `src/agent/prompts/weekly.ts` | 섹션 1~3의 테이블 포맷 지시(`### 리포트 포맷` 블록) 제거. 해석 필드 작성 지시만 남김 |
| 2-D | `run-weekly-agent.ts` 수정 | `src/agent/run-weekly-agent.ts` | 도구 결과 직접 캡처 → WeeklyReportData 구성 → LLM JSON 응답(WeeklyReportInsight) → `buildWeeklyHtml` 호출 |

**2-C 상세 — 프롬프트 변경 전후**:

Before (제거 대상):
```markdown
### 리포트 포맷 — 섹션 1 (markdownContent에 포함)
```markdown
| 지수 | 종가 | 주간 등락 | 전주 등락 |
|------|------|-----------|-----------|
...
```

After (유지):
```markdown
### 섹션 1 해석 (sectorRotationNarrative 필드에 작성)
- "구조적 상승 vs 일회성 반등" 판단
- 2주 연속 상위 3 유지 섹터 = 확인된 주도섹터
- sectorClusterContext 참조하여 업종 클러스터 연결
```

**2-D 상세 — run-weekly-agent.ts 흐름 변경**:

Before: 에이전트가 `send_discord_report(markdownContent=전체마크다운)` 호출 → reviewAgent가 마크다운을 역파싱해서 HTML 생성

After:
1. `run-weekly-agent.ts`가 도구 실행 결과를 직접 캡처 (`WeeklyReportData` 구성)
2. 에이전트는 해석 필드만 JSON으로 반환 (`capture_weekly_insight` 도구 호출)
3. `run-weekly-agent.ts`가 `buildWeeklyHtml(data, insight, date)` 호출
4. `tryPublishHtmlReport`에 완성된 HTML을 직접 전달 (마크다운 변환 불필요)

### Phase 3: htmlReport.ts 주간 코드패스 제거 (Phase 2 완료 후)

| # | 작업 | 파일 | 완료 기준 |
|---|------|------|-----------|
| 3-A | 주간 전용 파서 함수 제거 | `src/lib/htmlReport.ts` | `renderSectorRankingSection`, `renderIndustryRankingSection`, `renderPhaseTransitionBlock`, `renderStockCardSection` 중 주간에서만 사용하는 코드패스 제거. 일간 코드패스 불변 |
| 3-B | `buildHtmlReport` 주간 분기 확인 | `src/lib/htmlReport.ts` | 주간 경로에서 `buildHtmlReport`가 더 이상 호출되지 않음을 테스트로 검증 |

**주의**: `htmlReport.ts`를 전면 제거하지 않는다. 일간 리포트는 기존 마크다운 → HTML 파이프라인을 유지한다. 주간 코드패스만 새 빌더로 교체.

### Phase 4: 스모크 테스트 (Phase 3 완료 후)

| # | 작업 | 완료 기준 |
|---|------|-----------|
| 4-A | `scripts/preview-weekly-html.ts` 실행 | HTML 파일 생성 확인. 지수 테이블, Phase 2 추이 테이블, 섹터 테이블, 업종 Top 10, 관심종목 테이블, 5중 게이트 카드 렌더링 확인 |
| 4-B | 내부 모순 검증 | "신규 등록 N종목" 헤더와 실제 렌더링된 카드 수가 일치하는지 `buildWeeklyHtml` 내부에서 assert |

---

## 커밋 단위

```
commit 1: feat: 주간 리포트 JSON 스키마 정의 (WeeklyReportData, WeeklyReportInsight)
commit 2: feat: weekly-html-builder.ts — 데이터 블록 프로그래밍 렌더링 6개 함수
commit 3: test: weekly-html-builder 단위 테스트
commit 4: refactor: systemPrompt.ts → prompts/daily.ts + prompts/weekly.ts 분리
commit 5: feat: 주간 프롬프트에서 테이블 생성 지시 제거, 해석 필드 JSON 반환 구조로 전환
commit 6: feat: run-weekly-agent.ts — 데이터 캡처 + HTML 직접 조립 파이프라인
commit 7: refactor: htmlReport.ts 주간 코드패스 제거
commit 8: test: 스모크 테스트 + 내부 모순 assert
```

---

## 의존성

```
Phase 0 (스키마)
    |
    v
Phase 1 (HTML 빌더 + 단위 테스트)
    |
    v
Phase 2 (프롬프트 분리 + 에이전트 수정)  [Phase 1과 일부 병렬 가능: 2-A는 Phase 1과 동시 진행 가능]
    |
    v
Phase 3 (htmlReport.ts 주간 코드패스 제거)
    |
    v
Phase 4 (스모크 테스트)
```

---

## 리스크

| 리스크 | 대응 |
|--------|------|
| 도구 반환값 구조가 WeeklyReportData 스키마와 불일치 | Phase 0에서 실제 도구 반환 타입 확인 후 스키마 정렬. 도구 반환 타입 변경 없이 매핑만 |
| 에이전트가 JSON 스키마를 준수하지 않는 케이스 | `capture_weekly_insight` 도구에서 zod 검증 후 실패 시 필드별 기본값으로 폴백 |
| htmlReport.ts 일간 코드패스 영향 | Phase 3은 주간 코드패스만 제거. 제거 전 일간 리포트 HTML 출력 diff 비교로 확인 |
| `reviewAgent.ts`의 `tryPublishHtmlReport` 인터페이스 변경 | 주간은 HTML을 직접 전달하는 새 경로 추가. 기존 `markdownContent` 경로는 일간용으로 유지 |
| 관심종목 0건 / 게이트 후보 0건 케이스 | 렌더링 함수에서 빈 배열 케이스를 단위 테스트로 검증 |

---

## 의사결정 필요

없음 — 바로 구현 가능.

단, Phase 2-D(run-weekly-agent.ts 수정) 구현 시 "에이전트가 도구 호출 결과를 직접 캡처하는 방식" vs "에이전트가 계속 도구를 호출하되 agentLoop이 결과를 인터셉트하는 방식" 중 후자(기존 패턴 유지)를 권장한다. `createDraftCaptureTool` 패턴을 `createDataCaptureTool`로 확장하면 기존 agentLoop 수정 없이 데이터를 수집할 수 있다.
