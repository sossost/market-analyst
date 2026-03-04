# Decisions: 일간/주간 리포트 분리 + 카탈리스트 분석

**Created:** 2026-03-04

## Technical Decisions

### 1. 리포트 주기 분리

| Option | Pros | Cons |
|--------|------|------|
| A: 일간 브리핑 + 주간 심층 | 노이즈 최소화, 주간에 집중 분석 가능 | 평일 급등 종목 심층 분석 지연 |
| B: 매일 전체 리포트 (현행) | 매일 종목 추천 | 리포트 피로도, 중복 많음 |
| C: 이벤트 기반 (특이사항 시만) | 가장 깔끔 | 시장 온도 파악 어려움, 발송 불규칙 |

**Chosen:** A: 일간 브리핑 + 주간 심층
**Reason:** Phase 2 종목은 매일 바뀌지 않으므로 주간 분석이 적절. 일간은 시장 온도와 급변 이벤트만 전달하여 신호 대 잡음 비율 극대화.

---

### 2. 특이종목 스크리닝 기준

| Option | Pros | Cons |
|--------|------|------|
| A: 복합 조건 (등락률 + 거래량 + Phase) | 테마주/노이즈 필터링, 정확도 높음 | 구현 복잡도 약간 증가 |
| B: 등락률 단일 기준 | 단순, 빠른 구현 | 테마주 급등 노이즈 다수 포함 |
| C: 거래량 단일 기준 | 기관 움직임 포착 | 등락률 낮은 종목도 포함 |
| D: Phase 전환만 | 기존 로직 재활용 | 급등/급락 이벤트 누락 |

**Chosen:** A: 복합 조건
**Reason:** 단일 조건은 테마주/작전주 같은 노이즈를 걸러내지 못함. 2개 이상 조건 충족 시 특이종목으로 판단하여 신뢰도 확보.

---

### 3. 카탈리스트 분석 깊이

| Option | Pros | Cons |
|--------|------|------|
| A: 뉴스 요약 수준 (1~3건) | API 호출 적음, 비용 절약, 빠름 | 심층 맥락 부족할 수 있음 |
| B: 심층 분석 (뉴스 + 실적 + 섹터 연관) | 풍부한 정보 | API 비용/시간 증가, 구현 복잡 |

**Chosen:** A: 뉴스 요약 수준
**Reason:** v1에서는 빠르게 카탈리스트를 파악하는 게 목적. Brave Search 무료 티어 내에서 충분히 운영 가능. 추후 필요 시 심층 분석으로 확장.

---

### 4. 카탈리스트 데이터 소스

| Option | Pros | Cons |
|--------|------|------|
| A: Brave Search API | 무료 2,000건/월, 뉴스 검색 지원, 간단한 REST API | 검색 품질이 전문 금융 뉴스 API보다 낮을 수 있음 |
| B: FMP News API | 이미 FMP 키 보유, 금융 특화 | 뉴스 범위 제한적, 추가 API 호출 비용 |
| C: Benzinga / Polygon News | 금융 뉴스 전문, 정확도 높음 | 유료, 추가 의존성 |
| D: Claude 자체 지식 | 추가 API 불필요 | 실시간성 부족, 최신 뉴스 반영 불가 |

**Chosen:** A: Brave Search API
**Reason:** 무료 티어로 예상 사용량(월 100건 이하) 충분히 커버. 금융 전문 API는 현 단계에서 과도투자. 검색 품질이 부족하면 추후 전환.

---

### 5. 주간 리포트 발송 시점

| Option | Pros | Cons |
|--------|------|------|
| A: 토요일 오전 | 금요일 장 마감 데이터 반영, 주말에 여유롭게 분석 | 토요일까지 대기 |
| B: 월요일 오전 | 새 주 시작 전 브리핑 | 장 전 읽을 시간 부족할 수 있음 |
| C: 금요일 장 마감 후 | 가장 빠른 주간 요약 | 데이터 처리 시간 여유 적음 |

**Chosen:** A: 토요일 오전
**Reason:** 금요일 장 마감 데이터가 완전히 처리된 후 실행. 주말에 여유 있게 리포트를 읽고 다음 주 전략 수립 가능.

---

### 6. Discord 글자 제한 대응

| Option | Pros | Cons |
|--------|------|------|
| A: 여러 메시지 분할 + MD 파일 첨부 | 요약은 메시지로, 상세는 파일로. 표/포맷 보존. | Discord Webhook multipart 구현 필요 |
| B: 2000자 내 압축 | 단일 메시지, 구현 간단 | 내용 손실, 표 사용 불가 |
| C: Discord Embed (6000자) | 디자인 예쁨 | 구현 복잡, 마크다운 표 미지원 |

**Chosen:** A: 여러 메시지 분할 + MD 파일 첨부
**Reason:** Discord 메시지에서는 표가 제대로 렌더링되지 않음. MD 파일 첨부로 표/포맷 완벽 보존. 메시지는 요약용, 파일은 상세 분석용으로 역할 분리.

---

### 7. 특이사항 없는 날 처리

| Option | Pros | Cons |
|--------|------|------|
| A: 간단 요약 1~2줄 전송 | 시스템 정상 동작 확인 가능, 시장 온도 파악 | 매일 메시지 발생 |
| B: 미발송 | 가장 깔끔 | "에이전트 살아있나?" 불안감 |
| C: 이모지 한 줄 | 초미니멀 | 정보량 부족 |

**Chosen:** A: 간단 요약 1~2줄
**Reason:** 매일 시장 온도를 확인하는 것 자체가 가치 있음. 에이전트 정상 동작 확인 겸 최소한의 정보 제공.

---

### 8. 거래량 기준값 계산 방식

| Option | Pros | Cons |
|--------|------|------|
| A: daily_ma.vol_ma30 재활용 | screener가 이미 계산, 추가 쿼리 불필요 | 30일 기준 (20일이 아님) |
| B: 20일 평균 직접 계산 | 정확한 20일 기준 | 서브쿼리 필요, 성능 부담 |

**Chosen:** A: daily_ma.vol_ma30 재활용
**Reason:** screener ETL이 이미 매일 계산하는 vol_ma30이 있음. 30일 vs 20일 차이는 실질적으로 무시 가능. JOIN 한 번으로 해결.

---

### 9. 주간 에이전트 엔트리포인트 구조

| Option | Pros | Cons |
|--------|------|------|
| A: 별도 파일 (run-weekly-agent.ts) | 관심사 분리, 독립 배포 가능 | 코드 중복 약간 |
| B: 단일 파일에서 모드 분기 | 한 곳에서 관리 | 조건 분기 복잡, 테스트 어려움 |

**Chosen:** A: 별도 파일
**Reason:** 일간/주간은 도구 세트, 시스템 프롬프트, 스케줄이 모두 다름. 공통 로직(agentLoop, discord)은 이미 모듈화되어 있으므로 중복 최소.

---

### 10. Discord 파일 첨부 구현

| Option | Pros | Cons |
|--------|------|------|
| A: Native FormData (Node 18+) | 외부 의존성 없음, 프로젝트 Node 20 타겟 | Blob API 미묘한 차이 있을 수 있음 |
| B: form-data 패키지 | 안정적, 널리 사용 | 추가 의존성 |

**Chosen:** A: Native FormData
**Reason:** Node 20에서 FormData/Blob 완전 지원. 추가 패키지 없이 구현 가능.

---

## Architecture

### Structure

```
src/agent/
├── discord.ts                    # sendDiscordMessage, sendDiscordError, sendDiscordFile (신규)
├── systemPrompt.ts               # buildDailySystemPrompt (기존 변경), buildWeeklySystemPrompt (신규)
├── run-daily-agent.ts            # 일간 에이전트 (도구 세트 변경)
├── run-weekly-agent.ts           # 주간 에이전트 (신규)
├── agentLoop.ts                  # 변경 없음
├── reportLog.ts                  # 변경 없음
├── logger.ts                     # 변경 없음
└── tools/
    ├── types.ts                  # 변경 없음
    ├── validation.ts             # 변경 없음
    ├── getMarketBreadth.ts       # 변경 없음
    ├── getLeadingSectors.ts      # 변경 없음
    ├── getPhase2Stocks.ts        # 변경 없음
    ├── getStockDetail.ts         # 변경 없음
    ├── getUnusualStocks.ts       # 신규 — 특이종목 스크리닝
    ├── searchCatalyst.ts         # 신규 — Brave Search 카탈리스트
    ├── sendDiscordReport.ts      # 수정 — MD 파일 첨부 지원
    ├── readReportHistory.ts      # 변경 없음
    └── saveReportLog.ts          # 변경 없음

.github/workflows/
├── etl-daily.yml                 # 수정 — BRAVE_API_KEY 추가
└── agent-weekly.yml              # 신규 — 토요일 주간 에이전트
```

### Core Flow (Pseudo-code)

#### 일간 에이전트 (월~금)

```
run-daily-agent.ts:
  validate env (DATABASE_URL, ANTHROPIC_API_KEY, DISCORD_WEBHOOK_URL, BRAVE_API_KEY)
  targetDate = getLatestTradeDate()
  if no trade date → "거래일이 아닙니다" → exit

  tools = [
    getMarketBreadth,      # 시장 온도
    getLeadingSectors,     # 주도 섹터
    getUnusualStocks,      # 특이종목 스크리닝 (신규)
    searchCatalyst,        # 카탈리스트 검색 (신규)
    getStockDetail,        # 필요시 상세
    sendDiscordReport,     # 요약 메시지 + MD 파일
    readReportHistory,     # 이력 확인
    saveReportLog,         # 이력 저장
  ]

  runAgentLoop({ systemPrompt: buildDailySystemPrompt(), tools, ... })
```

#### 주간 에이전트 (토요일)

```
run-weekly-agent.ts:
  validate env (same as daily)
  targetDate = getLatestTradeDate()  # 금요일 데이터

  tools = [
    getMarketBreadth,
    getLeadingSectors,
    getPhase2Stocks,       # Phase 2 종목 발굴
    getStockDetail,
    searchCatalyst,        # 주도주 카탈리스트
    sendDiscordReport,     # 분할 메시지 + MD 파일
    readReportHistory,
    saveReportLog,
  ]

  runAgentLoop({ systemPrompt: buildWeeklySystemPrompt(), tools, ... })
```

#### 특이종목 스크리닝 (getUnusualStocks)

```sql
-- 1개라도 조건 충족하는 종목 조회
SELECT symbol, close, prev_close, daily_return, volume, vol_ma30, vol_ratio,
       phase, prev_phase, rs_score, sector, industry
FROM (
  dp JOIN dp_prev ON prev_date
  JOIN daily_ma ON vol_ma30
  JOIN stock_phases ON phase
  JOIN symbols ON actively_trading, not ETF
)
WHERE |daily_return| >= 0.05 OR vol_ratio >= 2.0 OR phase != prev_phase

-- TypeScript에서 2개 이상 조건 충족 필터링
conditions = [bigMove, highVolume, phaseChange]
unusual = results.filter(r => conditions.filter(c => c(r)).length >= 2)
```

#### Discord 파일 첨부 (sendDiscordFile)

```
sendDiscordFile(message, filename, mdContent):
  formData = new FormData()
  formData.append("payload_json", JSON.stringify({ content: message }))
  formData.append("files[0]", new Blob([mdContent], {type: "text/markdown"}), filename)
  fetch(webhookUrl, { method: "POST", body: formData })
```

### Key Interfaces

```typescript
// 특이종목 결과
interface UnusualStock {
  symbol: string;
  close: number;
  dailyReturn: number;       // 등락률 (소수)
  volRatio: number;           // 거래량 배수
  phase: Phase;
  prevPhase: Phase | null;
  rsScore: number;
  sector: string;
  industry: string;
  conditions: UnusualCondition[];  // 충족 조건 목록
}

type UnusualCondition = "big_move" | "high_volume" | "phase_change";

// Brave Search 결과
interface CatalystResult {
  ticker: string;
  results: CatalystNews[];
}

interface CatalystNews {
  title: string;
  source: string;
  url: string;
  publishedAt: string;
}
```
