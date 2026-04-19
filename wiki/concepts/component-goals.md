# Component Sub-Goals

**확정일:** 2026-04-16  
**배경:** 메인 골("Phase 2 초입 포착")은 정의됐지만, 각 컴포넌트의 세부 골이 부재한 채로 운영되면서  
설계 오류(불필요한 게이트 추가, 방향 불일치)가 반복되고 있었음.  
이 문서는 9개 컴포넌트 각각의 세부 골과 설계 원칙을 기록한다.

---

## 설계 원칙

**느슨한 진입 + 내부 필터링**

- etl_auto, thesis_aligned는 진입 게이트를 최소화한다 (광망)
- 소비자 노출(리포트, 추천)은 `tier=featured` 필터로 제어한다
- 진입 후 이탈은 Phase Exit 자동화(#836)가 처리한다
- "0건이 나오면 기준 완화" 반사는 금물 — 시장에 기회가 없는 것일 수 있다

---

## 1. etl_auto

**세부 골:** Phase 2 정량 광망. 최소 품질 기준만 통과하면 등록.

- 역할: 전체 유니버스에서 Phase 2 진입 종목을 빠짐없이 수집
- 소비자 노출은 이 단계에서 결정하지 않는다 → tier 필터링으로 분리
- 기준 완화 금지: 시장 환경에 따라 0건도 정상 결과
- 기준 완화의 유일한 근거: 특정 조건이 구조적으로 유효한 종목을 차단하고 있음이 데이터로 증명될 때

**파일:** `src/etl/jobs/scan-recommendation-candidates.ts`

---

## 2. agent (주간 에이전트)

**세부 골:** etl_auto 결과에서 featured 격상 판단 전담. 신규 종목을 직접 발굴하는 역할이 아님.

- etl_auto → agent는 "발굴"이 아니라 "심사"
- 격상 기준: 서사 정합성 + SEPA S/A 등급
- source=agent 신규 등록은 etl_auto가 놓친 특수 케이스(비정형 진입)에 한정
- 주봉(weekly chart) 관점이 기본 — 일봉 노이즈에 흔들리지 않음

**파일:** `src/agent/run-weekly-agent.ts`, `src/agent/prompts/weekly.ts`

---

## 3. thesis_aligned

**세부 골:** narrative_chains의 수혜주가 Phase 2 진입 시 자동으로 tracked_stocks에 등록.

- source=thesis_aligned, tier는 LLM 인증 여부로 standard/featured 분기
- 진입 게이트: Phase 2 (단일 조건) — 복잡한 추가 게이트 불필요
- 진입 후 이탈: Phase Exit 자동화가 처리 (RS > 95 같은 pre-entry 게이트 불필요)
- **닫힌 이슈:** #832 RS > 95 게이트 → Phase Exit으로 대체 (PR #839 closed)

**파일:** `src/etl/jobs/scan-thesis-aligned-candidates.ts`

---

## 4. narrative_chains

**세부 골:** thesis에서 식별된 수혜주를 Phase 무관하게 등록하고, 주기적으로 동기화.

**현재 문제:**
1. `round3-synthesis.ts` 프롬프트가 "Phase 2 미진입 종목 우선"을 요구해서 ETL 필터(Phase 2 only)와 충돌 → #843
2. beneficiary_tickers가 정적 목록 — Phase 1에 있다가 Phase 2 진입한 종목이 자동 반영 안 됨 → #842

**설계 방향:**
- 프롬프트: Phase 무관 수혜주 등록 (Phase 2 게이트는 ETL에서 처리)
- ETL: 주기적으로 beneficiary_tickers Phase 상태 동기화

**파일:** `src/debate/narrativeChainService.ts`, `src/debate/round3-synthesis.ts`

---

## 5. tracked_stocks 트래킹

**세부 골:** 포착 선행성(detection_lag) 측정 + 성과 검증 + 학습 루프 제공.

**현재 KPI:**
- winRate (가격 기준 수익률)
- avgPnl
- exitReasons 분포

**부재 KPI:**
- **detection_lag** = `entry_date - phase2_since` — Phase 2 초입을 얼마나 빠르게 잡았는가
  → 이것이 메인 골의 핵심 측정값 (#844)

**설계 방향:**
- `readTrackedStocksPerformance` 도구에 detection_lag 통계 추가
- source별로 분리 — etl_auto vs thesis_aligned 선행성 비교

**파일:** `src/tools/readTrackedStocksPerformance.ts`, `src/etl/jobs/update-tracked-stocks.ts`

---

## 6. thesis/debate

**세부 골:** structural_narrative + sector_rotation 중심 중장기 인사이트 생성.

**현재 문제:**
- `short_term_outlook` 카테고리: hit rate 46.4% ≈ 동전 던지기, 11건 EXPIRED 결론 없음
- 30일 단위 예측은 investing/swing 철학과 불일치

**설계 방향:**
- structural_narrative (구조적 변화 포착) 중심
- sector_rotation (섹터 로테이션 예측) 강화
- short_term_outlook 카테고리 제거 (#845)

**파일:** `src/debate/debateEngine.ts`, `src/debate/thesisVerifier.ts`

---

## 7. 일간 리포트

**세부 골:** 컨디션 체크 + 변화 감지. 관심종목 섹션 없음.

- 매일 아침 시장 온도 파악 전용
- 멀티게이트(S&P 500 MA200/MA50, 신고가>신저가, A/D>1.0) 기반 컨디션 체크
- 전일 대비 눈에 띄는 변화 감지
- 관심종목(tracked_stocks)은 일간에서 노출하지 않음 — 주간이 담당
- 데이터 렌더링은 프로그래밍, LLM은 해석만

**파일:** `src/agent/run-daily-agent.ts`, `src/lib/daily-html-builder.ts`

---

## 8. 주간 리포트

**세부 골:** 한 주간 시장 종합 + 주봉 기준 Phase 2 유지 종목 선별(Top 5~7) + 다음 주 관전 포인트.

- 전체 나열이 아닌 선별된 인사이트
- 선별 기준(우선순위): ① featured tier ② 2주 이상 Phase 2 유지 ③ detection_lag 작음(초입 포착)
- 주봉(weekly chart) 관점이 기본
- 섹터/매크로 흐름 맥락을 종목 선별에 반영 (#846)

**파일:** `src/agent/run-weekly-agent.ts`, `src/agent/prompts/weekly.ts`, `src/lib/weekly-html-builder.ts`

---

## 9. 기업 분석 리포트

**세부 골:** featured tier 종목에만 심층 분석 생성. standard는 제외.

**현재 문제:**
- `scan-recommendation-candidates.ts`에서 모든 진입 종목에 `runCorporateAnalyst` fire-and-forget
- 30일 기준 etl_auto standard 739개 대상 → 낭비
- featured(21개) 커버리지 14.3%에 불과

**설계 방향:**
- tier=featured 확인 후 리포트 생성 (#847)
- thesis_aligned featured도 포함

**파일:** `src/etl/jobs/scan-recommendation-candidates.ts`, `src/agent/corporateAnalyst/`

---

## 관련 이슈

| 이슈 | 컴포넌트 | 내용 |
|------|---------|------|
| #842 | narrative_chains | beneficiary_tickers 주기적 자동 동기화 |
| #843 | narrative_chains | round3-synthesis 프롬프트 Phase 무관 수혜주 등록 |
| #844 | tracked_stocks | 포착 선행성 KPI (detection_lag) 구현 |
| #845 | thesis/debate | short_term_outlook 카테고리 제거 |
| #846 | 주간 리포트 | 관심종목 선별 기준 + 주봉 관점 강화 |
| #847 | 기업 분석 리포트 | featured tier 한정 생성 |
