# 인사이트 브리핑 중심 전환 — 추천 시스템 → 관심종목 + 장기 트래킹 재설계

**GitHub Issue**: #390
**작성일**: 2026-03-22
**트랙**: Full (기획서 단독 — 이슈 본문이 spec)

---

## 선행 맥락

**프로젝트 종합 리뷰 (2026-03-22):**
- thesis 적중률 50% — 분석 합격
- 추천 승률 17% — 실행 낙제

**원인 진단:**
- 시스템 강점 = 구조적 인사이트 생산
- 성공 기준 = 추천 수익률 → 왜곡
- 주도주는 이미 고점 근처라 진입 타이밍에 따라 수익률 편차가 극심함
- "추천일 매수 가정" 자체가 부적절한 평가 모델

**관련 의사결정:**
- 교집합 필터가 단독 도구보다 강력함 (PR #61 검증)
- Phase 2 지속성 기준 강화로 불안정 Phase 진입 차단 진행 중 (MIN_PHASE2_PERSISTENCE_COUNT=3)
- 추천 승률 17%에서 지속성 차단 로직을 이미 투입했음에도 개선 미비

---

## 골 정렬

**ALIGNED** — Phase 2(상승 초입) 주도섹터/주도주를 남들보다 먼저 포착하여 알파를 형성하는 것이 핵심 골이다.

추천 → 관심종목 전환은 "알파 형성"의 정의를 "단기 매매 수익"에서 "구조적 변화의 초기 신호 포착"으로 재정렬하는 조치다. 이는 골과 정확히 일치한다. 시스템이 진짜 잘 하는 것(인사이트)을 KPI로 삼는 것.

---

## 문제

분석 엔진은 thesis 적중률 50%로 제 기능을 하고 있으나, 성과 지표가 "추천 승률"로 설정되어 있어 시스템 가치가 왜곡된다. 리포트 4개가 서로 다른 목적으로 발송되지만 수신자 입장에서 중복·혼선이 발생하고, 트래킹 기준(Phase Exit 청산)이 시스템 목표와 맞지 않는다.

---

## Before → After

### Before

| 구분 | 현재 상태 |
|------|----------|
| 리포트 수 | 4개 (일간보고서, 투자브리핑(토론), 주간보고서, 종목리포트) |
| 성과 지표 | 추천 승률 (17%), 단기 수익률 |
| 트래킹 단위 | recommendations 테이블, Phase Exit 청산 |
| 종목 선정 기준 | Phase 2 + RS 기준 (단순 교집합) |
| 토론 발송 | 조건부 (checkAlertConditions) 개별 발송 |
| 일간 에이전트 | 시장 온도 + 특이종목 (토론 결과 미반영) |

### After

| 구분 | 목표 상태 |
|------|----------|
| 리포트 수 | 3개 (일간 브리핑, 주간 리포트, 종목 심층) |
| 성과 지표 | thesis 적중률 (1번 KPI), 포착 선행성 (2번 KPI) |
| 트래킹 단위 | watchlist 테이블, 90일 고정 윈도우 |
| 종목 선정 기준 | 5중 교집합 게이트 (Phase 2 + 섹터RS + 개별RS + 서사 근거 + SEPA S/A) |
| 토론 발송 | 별도 발송 폐지, 일간 브리핑에 인사이트 통합 |
| 일간 에이전트 | 시장 온도 + 토론 핵심 발견 + 관심종목 현황 |

---

## 변경 사항

### A. 신규 생성

| 파일 | 역할 |
|------|------|
| `src/db/schema/analyst.ts` 내 `watchlist_stocks` 테이블 추가 | 관심종목 등록/해제/이력 |
| `src/tools/getWatchlistStatus.ts` | 관심종목 현황 조회 (일간/주간 에이전트용) |
| `src/tools/saveWatchlist.ts` | 관심종목 등록/해제 저장 |
| `src/lib/watchlistGate.ts` | 5중 교집합 게이트 평가 로직 |
| `src/lib/watchlistTracker.ts` | 90일 윈도우 Phase 궤적 추적 |
| `drizzle/migrations/NNNN_add_watchlist_stocks.sql` | DB 마이그레이션 |

### B. 수정

| 파일 | 변경 내용 |
|------|----------|
| `src/agent/run-daily-agent.ts` | 토론 핵심 발견 로드 + 관심종목 현황 도구 추가. systemPrompt 구조 변경. |
| `src/agent/systemPrompt.ts` (`buildDailySystemPrompt`) | 3단 구조로 재설계: 시장 온도 → 오늘의 인사이트 → 관심종목 현황 |
| `src/agent/run-weekly-agent.ts` | saveRecommendations 도구 제거. saveWatchlist, getWatchlistStatus 추가. recommendationPerformance 로드 제거. |
| `src/agent/systemPrompt.ts` (`buildWeeklySystemPrompt`) | 5섹션 구조로 재설계: 주간 구조 변화 → 관심종목 궤적 → 신규 등록/해제 → thesis 적중률 → 시스템 성과 |
| `src/agent/run-debate-agent.ts` | `checkAlertConditions` 조건부 발송 제거. thesis 저장 유지. Discord 발송 로직 제거 (일간 에이전트에서 인사이트 소비). |
| `scripts/cron/etl-daily.sh` | Phase 6 순서 조정: 토론 → 일간 브리핑 (기존 구조 유지, 발송 통합만 변경) |
| `src/fundamental/runFundamentalValidation.ts` | 관심종목 등록 시 트리거로 변경 (기존 주간 에이전트 직접 호출 방식 유지 가능) |
| `src/agent/run-corporate-analyst.ts` | 트리거: `saveRecommendations` → `saveWatchlist` 등록 시 |

### C. 삭제 또는 비활성화

| 항목 | 처리 방법 |
|------|----------|
| `src/tools/saveRecommendations.ts` | 주간 에이전트 도구 목록에서 제거. 코드는 유지 (ETL 업데이트 스크립트 의존). |
| `src/tools/readRecommendationPerformance.ts` | 주간 에이전트 도구 목록에서 제거. 코드 유지. |
| `run-debate-agent.ts`의 Discord 발송 블록 | 조건부 발송 로직 제거. thesis 저장, 세션 저장, 레짐 저장은 유지. |

### D. ETL 파이프라인 영향

| 스크립트 | 영향 |
|----------|------|
| `etl/jobs/update-recommendation-status.ts` | 기존 recommendations 테이블 갱신 — watchlist_stocks 신규 테이블도 갱신 필요 (Phase 궤적 업데이트) |
| ETL Phase 3.8 (`update-recommendation-status`) | watchlist 90일 Phase 궤적 업데이트 로직 추가 |

---

## DB 마이그레이션 계획

### 신규 테이블: `watchlist_stocks`

```sql
CREATE TABLE watchlist_stocks (
  id          SERIAL PRIMARY KEY,
  symbol      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'ACTIVE',    -- 'ACTIVE' | 'EXITED'
  entry_date  TEXT NOT NULL,                      -- 등록일 (YYYY-MM-DD)
  exit_date   TEXT,                               -- 해제일 (null이면 활성)
  exit_reason TEXT,                               -- 해제 사유

  -- 등록 시점 팩터 스냅샷
  entry_phase        SMALLINT NOT NULL,
  entry_rs_score     INTEGER,
  entry_sector_rs    NUMERIC,
  entry_sepa_grade   TEXT,                        -- 'S' | 'A' | 'B' | 'C' | 'F'
  entry_thesis_id    INTEGER,                     -- 연결된 thesis (nullable)
  entry_sector       TEXT,
  entry_industry     TEXT,
  entry_reason       TEXT,                        -- 서사적 등록 근거 (자유 텍스트)

  -- 90일 윈도우 트래킹
  tracking_end_date  TEXT,                        -- entry_date + 90일
  current_phase      SMALLINT,
  current_rs_score   INTEGER,
  phase_trajectory   JSONB,                       -- [{date, phase, rsScore}] — 매일 ETL 누적
  sector_relative_perf NUMERIC,                   -- 섹터 대비 상대 성과 (%)
  price_at_entry     NUMERIC,
  current_price      NUMERIC,
  pnl_percent        NUMERIC,                     -- 참고 지표만
  max_pnl_percent    NUMERIC,
  days_tracked       INTEGER DEFAULT 0,
  last_updated       TEXT,

  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,

  UNIQUE (symbol, entry_date)
);

CREATE INDEX idx_watchlist_stocks_status ON watchlist_stocks (status);
CREATE INDEX idx_watchlist_stocks_entry_date ON watchlist_stocks (entry_date);
CREATE INDEX idx_watchlist_stocks_symbol ON watchlist_stocks (symbol);
```

### 기존 테이블 변경 없음

- `recommendations` 테이블: 보존. 기존 ETL(update-recommendation-status) 계속 운영.
- 신규 watchlist와 기존 recommendations는 독립 운영. 점진적 전환.
- 마이그레이션 전략: 기존 ACTIVE recommendations를 watchlist에 일괄 삽입하지 않음. 클린 슬레이트로 시작. (과거 데이터가 새 KPI 체계를 오염시키는 것 방지)

---

## 작업 계획

### Phase 1: DB + 핵심 라이브러리 (기반 공사)

**완료 기준:** watchlist_stocks 테이블 생성, 게이트/트래커 로직 테스트 통과

| 작업 | 에이전트 | 완료 기준 |
|------|---------|----------|
| 1-1. `watchlist_stocks` 마이그레이션 SQL 작성 | 구현팀 | `yarn db:generate` 통과, 테이블 생성 확인 |
| 1-2. `src/lib/watchlistGate.ts` — 5중 교집합 게이트 | 구현팀 | 단위 테스트: 5가지 조건 각각 미달 시 거부 확인 |
| 1-3. `src/lib/watchlistTracker.ts` — 90일 Phase 궤적 추적 | 구현팀 | 단위 테스트: phase_trajectory 누적, 섹터 대비 성과 계산 확인 |
| 1-4. `src/tools/saveWatchlist.ts` — 등록/해제 도구 | 구현팀 | 통합 테스트: 중복 등록 방지, 해제 처리 확인 |
| 1-5. `src/tools/getWatchlistStatus.ts` — 현황 조회 도구 | 구현팀 | 통합 테스트: ACTIVE 목록 반환, Phase 궤적 포맷 확인 |

### Phase 2: 토론 에이전트 발송 분리

**완료 기준:** run-debate-agent.ts가 Discord 발송 없이 thesis/regime/session 저장만 수행

**의존성:** Phase 1 불필요 (독립)

| 작업 | 에이전트 | 완료 기준 |
|------|---------|----------|
| 2-1. `run-debate-agent.ts` — checkAlertConditions 블록 제거 | 구현팀 | Discord 발송 코드 제거. thesis 저장, 레짐 저장, 세션 저장 동작 확인. |
| 2-2. `run-debate-agent.ts` — 일간 에이전트에 전달할 "핵심 인사이트" 추출 함수 추가 | 구현팀 | `extractDailyInsight(result): string` — round3 report에서 핵심 발견 1-2개 추출. 없으면 빈 문자열 반환. |
| 2-3. 토론 인사이트 임시 저장 경로 결정 | 구현팀 | debate_sessions.synthesisReport에서 일간 에이전트가 직접 조회 가능하도록 쿼리 함수 작성 (`loadTodayDebateInsight(date): string`) |

### Phase 3: 일간 에이전트 통합 브리핑

**완료 기준:** 일간 에이전트가 3단 구조(시장 온도 + 인사이트 + 관심종목) 브리핑 생성

**의존성:** Phase 1(getWatchlistStatus), Phase 2(토론 인사이트 조회)

| 작업 | 에이전트 | 완료 기준 |
|------|---------|----------|
| 3-1. `buildDailySystemPrompt` 재설계 | 구현팀 | 3단 구조 프롬프트 적용. 기존 "특이종목 카탈리스트" 섹션은 [하단]으로 이동 또는 제거 결정. |
| 3-2. `run-daily-agent.ts` — 토론 인사이트 로드 추가 | 구현팀 | `loadTodayDebateInsight` 호출, thesesContext 대체 또는 병행. |
| 3-3. `run-daily-agent.ts` — getWatchlistStatus 도구 추가 | 구현팀 | 에이전트가 관심종목 현황을 조회하여 브리핑 [하단]에 반영. |
| 3-4. 발송 게이트 재검토 | 구현팀 | `evaluateDailySendGate` — 관심종목 변동(Phase 전이, 이탈 후보)도 발송 트리거로 추가. |

### Phase 4: 주간 에이전트 재설계

**완료 기준:** 주간 에이전트가 5섹션 구조(구조 변화 + 관심종목 궤적 + 등록/해제 + thesis 적중률 + 시스템 성과) 리포트 생성

**의존성:** Phase 1(saveWatchlist, getWatchlistStatus)

| 작업 | 에이전트 | 완료 기준 |
|------|---------|----------|
| 4-1. `buildWeeklySystemPrompt` 재설계 | 구현팀 | 5섹션 프롬프트. 기존 "추천 후보 선정" 지시 제거. 관심종목 등록 기준 명시. |
| 4-2. `run-weekly-agent.ts` — saveRecommendations 제거, saveWatchlist 추가 | 구현팀 | readRecommendationPerformance 도구도 제거. getWatchlistStatus 추가. |
| 4-3. `run-weekly-agent.ts` — watchlist 게이트 컨텍스트 주입 | 구현팀 | 펀더멘탈 스코어(SEPA), 섹터 RS, 서사 체인이 에이전트에 제공되어 게이트 판단 가능. |
| 4-4. 종목 심층 트리거 변경 | 구현팀 | saveWatchlist 성공 시 runCorporateAnalyst fire-and-forget 실행. |

### Phase 5: ETL 파이프라인 업데이트

**완료 기준:** watchlist_stocks의 Phase 궤적이 매일 자동 갱신됨

**의존성:** Phase 1(watchlist_stocks 테이블)

| 작업 | 에이전트 | 완료 기준 |
|------|---------|----------|
| 5-1. `etl/jobs/update-watchlist-tracking.ts` 신규 생성 | 구현팀 | ACTIVE watchlist의 phase, rs_score, phase_trajectory, sector_relative_perf 매일 갱신. 90일 초과 시 EXITED 처리. |
| 5-2. `scripts/cron/etl-daily.sh` — Phase 3.8에 추가 | 구현팀 | `update-recommendation-status`와 병렬 또는 후속 실행. |
| 5-3. `package.json` 스크립트 추가 | 구현팀 | `"etl:update-watchlist": "tsx src/etl/jobs/update-watchlist-tracking.ts"` |

### Phase 6: 테스트 + 문서

**완료 기준:** 전체 테스트 통과, README/ROADMAP 갱신

**의존성:** Phase 1~5 완료

| 작업 | 에이전트 | 완료 기준 |
|------|---------|----------|
| 6-1. 통합 테스트 — 일간 브리핑 구조 검증 | 검증팀 | 3단 구조가 Discord 발송 형태로 올바르게 구성되는지 확인 |
| 6-2. 통합 테스트 — 주간 리포트 구조 검증 | 검증팀 | 5섹션 구조 + watchlist 등록 결과 확인 |
| 6-3. README.md + docs/ROADMAP.md 갱신 | 구현팀 | Feature Map F11 추가. 기존 추천 시스템 설명 수정. |

---

## 의존성 그래프

```
Phase 1 (DB + 라이브러리)
├── Phase 2 (토론 발송 분리) — 독립 병렬 가능
├── Phase 3 (일간 통합) — Phase 1, 2 완료 후
├── Phase 4 (주간 재설계) — Phase 1 완료 후
└── Phase 5 (ETL) — Phase 1 완료 후

Phase 6 (테스트 + 문서) — Phase 1~5 완료 후
```

Phase 2는 Phase 1과 독립. Phase 3, 4, 5는 Phase 1 완료 후 병렬 착수 가능.

---

## 리스크

### R1: 운영 중단 리스크 (HIGH)

**내용:** 토론 발송 폐지 시 Discord에서 기존 투자브리핑 채널 메시지가 사라짐. 수신자가 혼란을 느낄 수 있음.

**대응:** Phase 2 (토론 발송 분리)를 먼저 배포. Phase 3 (일간 통합)이 안정화된 이후 실제로 토론 발송이 "통합되었음"을 확인.

**롤백:** run-debate-agent.ts의 checkAlertConditions 블록은 별도 분기로 분리하여 환경변수 플래그(`DEBATE_SEND_MODE=legacy`)로 복구 가능하게 구현.

### R2: recommendations ETL 간섭 (MEDIUM)

**내용:** 기존 `update-recommendation-status.ts`가 여전히 추천 종목 기준으로 실행됨. watchlist로 이행한 종목들이 recommendations에도 존재하면 이중 트래킹이 발생할 수 있음.

**대응:** recommendations 테이블은 그대로 유지하되, 주간 에이전트에서 신규 추가를 중단. 기존 ACTIVE 추천들은 90일 기간이나 Phase Exit로 자연 소멸 대기. ETL은 두 테이블 모두 갱신.

### R3: 토론 인사이트 조회 타이밍 (MEDIUM)

**내용:** etl-daily.sh 실행 순서상 토론 에이전트(Phase 5)가 완료된 후 일간 에이전트(Phase 6)가 실행되므로 타이밍 문제는 없음. 단, 토론이 실패하면 일간 에이전트도 스킵되는 현재 로직(Phase 5 실패 → Phase 6 스킵)을 검토해야 함.

**대응:** 토론 인사이트 없이도 일간 브리핑이 발송 가능하도록 일간 에이전트 로직을 fail-open으로 구현. 인사이트가 없으면 [중단] 섹션을 생략하고 시장 온도만 발송.

### R4: watchlist 게이트 미달로 인한 빈 주간 리포트 (LOW)

**내용:** 5중 교집합 게이트를 모두 통과하는 종목이 없을 경우 주간 리포트의 [신규 관심 등록] 섹션이 비어버림.

**대응:** 프롬프트에 "후보 없음" 케이스 명시. 게이트를 통과한 종목이 0개면 "이번 주 신규 등록 없음 — 진입 게이트 미충족" 문구 포함. 정상 운영으로 간주.

### R5: 기존 대시보드(F8) 영향 (LOW)

**내용:** frontend에서 recommendations 테이블 기반의 추천 성과 페이지가 존재할 수 있음.

**대응:** recommendations 테이블 보존으로 기존 대시보드 영향 없음. 추후 watchlist 기반 트래킹 페이지는 별도 피처로 분리.

---

## 의사결정 필요

없음 — CEO 방향 합의 완료 (이슈 #390). 아래 사항은 구현 시 자율 결정.

| 항목 | 결정 기준 |
|------|----------|
| 토론 인사이트 저장 방식 | debate_sessions.synthesisReport에서 직접 읽는 것으로 결정 (신규 컬럼 불필요) |
| watchlist vs recommendations 이중 트래킹 기간 | recommendations 자연 소멸 대기. 강제 마이그레이션 없음. |
| 발송 게이트 임계값 | 기존 5개 OR 조건 유지 + 관심종목 Phase 전이 추가. 수치 튜닝은 운영 후 결정. |
