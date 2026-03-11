# 투자 브리핑 QA 에이전트 (이슈 #160)

## 선행 맥락

- **기존 daily-report-qa/plan.md** (미구현 상태): LLM이 리포트 텍스트를 읽고 4가지 항목을 주관적으로 점수화 → GitHub 이슈 자동 생성. **발송 후 감사(post-hoc audit)** 성격. 이번 기획과 레이어가 다름.
- **reviewAgent.ts** (기존, 운영 중): 발송 전 실시간 교정. LLM이 텍스트 품질 OK/REVISE/REJECT 판정 후 즉시 수정·발송.
- **reportValidator.ts** (기존, 운영 중): 텍스트 기반 후처리 검증. bull-bias 키워드 비율, Phase 2 비율 100% 초과, 필수 섹션 존재 여부 검사. **DB 수치 대조는 없음.**
- **saveReportLogTool**: 에이전트가 `reportedSymbols`(종목 배열) + `marketSummary`(phase2Ratio, leadingSectors)만 저장. 리포트 원문 텍스트(`full_content`)는 저장되지 않음.
- **일간 에이전트 실행 경로**: GitHub Actions (`etl-daily.yml`) + 맥미니 launchd (`com.market-analyst.etl-daily.plist`) 양쪽 운영 중.
- **에이전트 데이터 흐름**: `getLeadingSectors` → DB `sector_rs_daily` 쿼리 → 에이전트가 해석 → 리포트 텍스트에 수치 기재. 수치를 DB에서 직접 읽어 쓰는 구조이므로 오염 가능성이 있음.

## 골 정렬

**ALIGNED** — 직접 기여.

리포트 수치 정확성은 Phase 2 주도섹터/주도주 포착 결과물의 신뢰도 기반이다. 에이전트가 DB에서 읽은 섹터 RS 78을 "65"로 보고하거나, Phase 1 후기 종목 리스트에 없는 종목을 기재하면 구독자의 판단을 오염시킨다. 팩트 검증 레이어는 시스템 신뢰도의 최소 보장선이다.

## 문제

투자 브리핑에 DB 원본 데이터 대비 수치 정확성 검증이 없다. 현재 두 검증 레이어(reviewAgent, reportValidator)는 모두 텍스트 레벨 검증이며, DB 실제값과 리포트 기재값의 기계적 대조를 수행하지 않는다.

구체적 공백:
- 섹터 RS 점수: 리포트에 "Technology RS 78"이라고 기재했을 때 DB `sector_rs_daily.avg_rs`가 실제로 78인지 대조 없음
- Phase 2 비율: 리포트의 퍼센트 수치가 `stock_phases` 집계값과 일치하는지 대조 없음
- 추천 종목: `reportedSymbols`에 저장된 종목과 `stock_phases.phase`가 실제로 Phase 1~2인지 재검증 없음

## Before → After

**Before**: agentLoop → (DB 쿼리 결과를 에이전트가 해석) → 리포트 초안 → reviewAgent(텍스트 리뷰) → 발송. 리포트 내 수치와 DB 원본값의 대조 없음. 에이전트가 수치를 잘못 읽거나 환각해도 발견 수단 없음.

**After**: 위 파이프라인 유지 + **`runDailyQA.ts`** 단계 추가. 발송 직전(reviewAgent 이전) 또는 발송 직후 독립 실행. DB에서 해당 거래일의 실제 수치를 직접 조회하고, `reportedSymbols`/`marketSummary`와 기계적으로 대조. 불일치 항목은 경고로 로그 기록. 심각한 불일치(임계값 초과)는 발송 차단 또는 경고 문구 삽입.

## 변경 사항

### 신규 파일

1. **`src/agent/dailyQA.ts`** — QA 오케스트레이터. DB에서 실제값 조회 + `reportedSymbols`/`marketSummary` 수집 + 불일치 감지 + 결과 반환.
2. **`src/agent/lib/factChecker.ts`** — 팩트 체크 순수 함수 집합. DB 실제값과 리포트 기재값을 비교하는 로직. 단위 테스트 대상.
3. **`src/agent/lib/__tests__/factChecker.test.ts`** — 단위 테스트.

### 수정 파일

4. **`src/agent/run-daily-agent.ts`** — QA 단계 삽입. 발송 전 `runDailyQA` 호출. 결과를 로그에 기록. BLOCK 판정 시 발송 차단.

### 선택적 수정 (Phase 2)

5. **`src/agent/tools/saveReportLog.ts`** — `full_content` 필드 추가. 마크다운 전문 저장. Phase 1에서는 불필요(구조화 데이터만으로 검증).
6. **`db/migrations/`** — `report_qa_results` 테이블. QA 결과 이력 저장. 트렌드 추적용.

## QA 검증 항목 (Phase 1 범위)

### 검증 가능한 항목 (구조화 데이터 기반)

| 항목 | DB 원본 | 리포트 비교 대상 | 허용 오차 |
|------|---------|----------------|---------|
| 상위 섹터 목록 | `sector_rs_daily.sector` (상위 5) | `marketSummary.leadingSectors` | 순서 무관, 집합 일치 여부 |
| Phase 2 비율 | `stock_phases` 집계 | `marketSummary.phase2Ratio` | ±2% (반올림 허용) |
| 추천 종목 Phase | `stock_phases.phase` | `reportedSymbols[].phase` | 정확 일치 |
| 추천 종목 RS | `stock_phases.rs_score` | `reportedSymbols[].rsScore` | ±2 (반올림 허용) |

### 검증 불가 항목 (Phase 1 제외)

- 리포트 텍스트 내 자유 서술 수치 (마크다운 파싱 필요, 복잡도 높음)
- 지수 수익률 (Yahoo Finance 외부 API 기반, DB 없음)
- 공포탐욕지수 (외부 API)

## 작업 계획

### Phase 1: 핵심 팩트 체크 루프 (이슈 #160 최소 구현 범위)

**Step 1 — `factChecker.ts` 작성 (TDD)**
- 담당: 실행팀 (tdd-guide 에이전트)
- 작업: 순수 함수로 구현. DB 의존성 없음. 입력: `{ dbData, reportData }`, 출력: `{ mismatches: Mismatch[], severity: 'ok' | 'warn' | 'block' }`.
  - `compareSectors(dbTopSectors, reportLeadingSectors)` — 집합 비교, 50% 미만 겹침 시 warn
  - `comparePhase2Ratio(dbRatio, reportRatio, tolerancePct = 2)` — ±2% 이내 pass
  - `compareSymbolPhase(dbPhase, reportPhase)` — 정확 일치, 불일치 시 warn
  - `compareSymbolRs(dbRs, reportRs, tolerance = 2)` — ±2 이내 pass
  - `aggregateSeverity(mismatches)` — block: 2개 이상 mismatch / warn: 1개 / ok: 0개
- 완료 기준: 단위 테스트 통과, 커버리지 80% 이상

**Step 2 — `dailyQA.ts` 작성**
- 담당: 실행팀
- 작업: DB에서 해당 거래일의 실제 수치 조회 + `reportedSymbols`/`marketSummary` 수집 + `factChecker` 호출 + 결과 반환.
  ```typescript
  export interface DailyQAResult {
    date: string;
    severity: 'ok' | 'warn' | 'block';
    mismatches: Mismatch[];
    checkedAt: string;
  }

  export async function runDailyQA(
    date: string,
    reportData: { reportedSymbols: ReportedSymbol[]; marketSummary: MarketSummary },
  ): Promise<DailyQAResult>
  ```
- DB 쿼리 실패 시 severity 'warn' 반환 (QA 실패가 발송을 막지 않음)
- 완료 기준: 로컬에서 실행 시 DailyQAResult 반환

**Step 3 — `run-daily-agent.ts` 연동**
- 담당: 실행팀
- 작업: 리뷰 파이프라인(`runReviewPipeline`) 직전에 `runDailyQA` 삽입.
  - reportLog에서 방금 저장된 `reportedSymbols`/`marketSummary` 읽기
  - `runDailyQA(targetDate, reportData)` 실행
  - severity `ok`/`warn`: 로그 기록 후 계속 진행
  - severity `block`: 리포트 앞에 경고 문구 삽입 후 발송 (차단 아닌 경고 삽입 방식) — 발송 완전 차단은 Phase 2 판단
- 완료 기준: 일간 에이전트 실행 시 QA 결과가 로그에 출력됨

**Step 4 — 경고 삽입 로직**
- 담당: 실행팀
- 작업: `block` severity 시 draft 메시지 앞에 경고 블록 삽입.
  ```
  ⚠️ [데이터 정합성 경고]
  - Phase2 비율: 리포트 34.2% / DB 실측 31.0% (차이 3.2%)
  - 추천 종목 NVDA: 리포트 Phase 2 / DB Phase 1
  분석 참고 시 유의 요망.
  ```
- 완료 기준: block 시 경고 블록이 Discord 메시지 상단에 포함됨

### Phase 2: 이력 추적 + 자동 이슈 (Phase 1 안정화 후)

- `report_qa_results` DB 테이블 — QA 결과 이력 저장
- 주간 QA에 "이번 주 일간 QA 불일치 건수" 섹션 추가
- 누적 mismatch 패턴 감지 → 자동 GitHub 이슈 생성
- `full_content` 저장 후 텍스트 파싱 기반 수치 검증 확장

## 파이프라인 구조 (Phase 1 후)

```
[run-daily-agent.ts]
  │
  ├─ [1~5/8] 기존 단계 유지
  │
  ├─ [6/8] agentLoop 실행 → reportDrafts 캡처
  │
  ├─ [7/8] saveReportLog → DB에 reportedSymbols/marketSummary 저장
  │         ↓
  │    [신규] runDailyQA(targetDate, { reportedSymbols, marketSummary })
  │         │
  │         ├─ DB: sector_rs_daily, stock_phases 조회
  │         ├─ factChecker.ts: 기계적 대조
  │         └─ severity 판정 → 로그 기록
  │                   │
  │                   └─ block → reportDrafts 앞에 경고 블록 삽입
  │
  └─ [8/8] runReviewPipeline → Discord 발송
```

## 테스트 전략

### 단위 테스트 (필수)

`src/agent/lib/__tests__/factChecker.test.ts`:
- `compareSectors`: 완전 일치, 부분 일치(50% 이상), 불일치(50% 미만) 케이스
- `comparePhase2Ratio`: ±2% 이내 pass, 초과 warn
- `compareSymbolPhase`: 일치 pass, 불일치 warn
- `compareSymbolRs`: ±2 이내 pass, 초과 warn
- `aggregateSeverity`: 0개 ok, 1개 warn, 2개 이상 block

커버리지 목표: 90% 이상

### 통합 테스트 (권장)

`dailyQA.ts`의 DB 쿼리 실패 시 graceful degradation 확인 — mock DB로 테스트.

### 수동 검증

1. `npx tsx src/agent/run-daily-agent.ts` (또는 `SKIP_DAILY_GATE=true`)
2. 로그에서 `[DailyQA]` 항목 확인
3. 의도적 불일치 주입 후 경고 블록 Discord 수신 확인

## 리스크

1. **reportedSymbols가 에이전트 선택 결과**: 에이전트가 DB 조회 후 "관심 종목"만 선택하여 `reportedSymbols`에 저장. DB의 전체 종목 집합과 1:1 비교 불가. 비교 대상은 "에이전트가 보고한 종목의 실제 phase/rs가 맞는지"로 한정. 이 설계가 현재 구조에 맞다.

2. **Phase 2 비율 계산 기준**: `getMarketBreadth`는 `is_actively_trading = true AND is_etf = false AND is_fund = false` 필터 적용. `dailyQA`에서 동일 필터 사용 필수. 필터 불일치 시 항상 mismatch 발생.

3. **saveReportLog 타이밍**: 현재 에이전트가 `save_report_log` 도구를 호출하는 시점과 QA 실행 시점 조율 필요. `run-daily-agent.ts`에서 reportLog를 직접 읽는 방식으로 처리.

4. **QA 지연**: DB 쿼리 추가로 일간 파이프라인이 약 2~5초 늘어남. 무시 가능한 수준.

5. **False positive**: ±2% 허용 오차가 너무 좁으면 매일 warn. 초기 2주 운영 후 임계값 조정 필요.

## 의사결정 (자율 판단 완료)

1. **발송 차단 vs 경고 삽입**: `block` severity 시 완전 차단 대신 경고 문구 삽입 채택. 근거: 팩트 체커 자체에 false positive 리스크가 있고, Phase 1에서 임계값 캘리브레이션 전에 차단 방식은 운영 리스크. 경고 삽입으로 시작하고 신뢰도 확보 후 차단으로 격상.

2. **검증 타이밍**: reviewAgent 이전 삽입 채택. 근거: QA 경고 문구가 있는 draft를 reviewAgent가 함께 확인하면 일관성 있음. 발송 후 감사보다 발송 전 경고 삽입이 더 적시성 있음.

3. **텍스트 파싱 포함 여부**: Phase 1에서 제외. 근거: 마크다운 자유 서술에서 수치를 정규식으로 파싱하는 것은 오류 가능성이 높고 유지보수 비용이 크다. `reportedSymbols`/`marketSummary` 구조화 데이터만으로 핵심 팩트 체크 가능.
