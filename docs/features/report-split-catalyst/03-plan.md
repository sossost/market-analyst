# Implementation Plan: 일간/주간 리포트 분리 + 카탈리스트 분석

**Status:** Draft
**Created:** 2026-03-04
**Spec:** ./01-spec.md

---

## Phase 1: Discord 파일 첨부 [Estimated: S]

Discord Webhook으로 MD 파일을 첨부 전송하는 기능 추가.

- [ ] `src/agent/discord.ts` — `sendDiscordFile(message, filename, mdContent)` 함수 추가
  - Native FormData + Blob 사용 (Node 20)
  - 실패 시 텍스트 메시지 폴백 + 로컬 파일 저장
- [ ] `src/agent/tools/sendDiscordReport.ts` — input_schema에 `markdownContent`, `filename` 옵션 추가
  - markdownContent 있으면 → `sendDiscordFile()` 호출
  - 없으면 → 기존 `sendDiscordMessage()` 호출 (하위 호환)
- [ ] 단위 테스트: `sendDiscordFile` mock fetch 테스트

**Verify:** `npx tsc --noEmit` 통과, 테스트 통과, 실제 Discord에 MD 파일 전송 확인

---

## Phase 2: 특이종목 스크리닝 도구 [Estimated: M]

복합 조건으로 특이종목을 찾는 에이전트 도구 추가.

- [ ] `src/agent/tools/getUnusualStocks.ts` — 신규
  - daily_prices (등락률) + daily_ma.vol_ma30 (거래량 비율) + stock_phases (Phase 전환) JOIN
  - SQL에서 1개 이상 조건 충족 종목 조회
  - TypeScript에서 2개 이상 조건 충족 필터링
  - 반환: symbol, dailyReturn, volRatio, phase, prevPhase, rsScore, sector, industry, conditions
- [ ] `src/agent/tools/validation.ts` — `validateNumber` 활용 (기존)
- [ ] 단위 테스트: mock pool.query, 복합 조건 필터링 로직 테스트

**Verify:** 테스트 통과, 실제 DB 데이터로 특이종목 조회 확인

---

## Phase 3: Brave Search 카탈리스트 도구 [Estimated: M]

Brave Search News API로 종목 관련 뉴스를 검색하는 에이전트 도구 추가.

- [ ] `src/agent/tools/searchCatalyst.ts` — 신규
  - Brave News Search API: `GET https://api.search.brave.com/res/v1/news/search`
  - Header: `X-Subscription-Token: BRAVE_API_KEY`
  - Query: `"{ticker} {companyName} stock"`, freshness: `pw` (past week)
  - 상위 3건 반환: title, source, url, publishedAt
  - API 실패 시 빈 배열 반환 + 로그 (에이전트 중단 방지)
- [ ] `.env.example` — `BRAVE_API_KEY` 추가
- [ ] 단위 테스트: mock fetch, 성공/실패/빈 결과 케이스

**Verify:** 테스트 통과, 실제 Brave API 호출로 뉴스 반환 확인

---

## Phase 4: 시스템 프롬프트 분리 [Estimated: S]

일간/주간용 시스템 프롬프트 분리.

- [ ] `src/agent/systemPrompt.ts` 수정
  - `buildSystemPrompt()` → `buildDailySystemPrompt()` 리네임
  - 일간: 시장 온도 + 특이종목 카탈리스트 중심. `get_unusual_stocks`, `search_catalyst` 워크플로우 추가
  - 특이사항 없는 날 처리 가이드라인 추가
  - MD 파일 생성 지시사항 추가 (표 포함 상세 리포트는 markdownContent로)
- [ ] `buildWeeklySystemPrompt()` 신규 추가
  - Phase 2 종목 발굴 + 카탈리스트 + 인사이트 중심
  - 섹션별 분할 메시지 + MD 파일 첨부 지시
  - 주간 포맷 정의

**Verify:** 타입 체크 통과

---

## Phase 5: 에이전트 엔트리포인트 분리 [Estimated: M]

일간/주간 에이전트 실행 파일 분리 및 도구 세트 조정.

- [ ] `src/agent/run-daily-agent.ts` 수정
  - 시스템 프롬프트: `buildDailySystemPrompt()`
  - 도구 세트: `getMarketBreadth`, `getLeadingSectors`, `getUnusualStocks`, `searchCatalyst`, `getStockDetail`, `sendDiscordReport`, `readReportHistory`, `saveReportLog`
  - `validateAgentEnvironment()`에 `BRAVE_API_KEY` 추가
- [ ] `src/agent/run-weekly-agent.ts` 신규
  - `run-daily-agent.ts` 구조 미러링
  - 시스템 프롬프트: `buildWeeklySystemPrompt()`
  - 도구 세트: `getMarketBreadth`, `getLeadingSectors`, `getPhase2Stocks`, `getStockDetail`, `searchCatalyst`, `sendDiscordReport`, `readReportHistory`, `saveReportLog`
- [ ] `package.json` — `agent:weekly` 스크립트 추가

**Verify:** `npx tsc --noEmit` 통과, 일간/주간 각각 로컬 실행 테스트

---

## Phase 6: GitHub Actions 스케줄 분리 [Estimated: S]

주간 에이전트용 워크플로우 추가 및 기존 워크플로우 조정.

- [ ] `.github/workflows/etl-daily.yml` 수정
  - `run-agent` job에 `BRAVE_API_KEY` secret 추가
- [ ] `.github/workflows/agent-weekly.yml` 신규
  - cron: `0 1 * * 6` (토요일 UTC 01:00 = KST 10:00)
  - ETL 불필요 (금요일 데이터 이미 존재)
  - checkout → install → `npx tsx src/agent/run-weekly-agent.ts`
  - secrets: DATABASE_URL, ANTHROPIC_API_KEY, DISCORD_WEBHOOK_URL, DISCORD_ERROR_WEBHOOK_URL, BRAVE_API_KEY
  - workflow_dispatch 추가 (수동 트리거)

**Verify:** 워크플로우 문법 검증, 수동 트리거 테스트

---

## Dependencies

```
Phase 1 (Discord 파일)  ← 독립
Phase 2 (특이종목)       ← 독립
Phase 3 (Brave Search)  ← 독립
Phase 4 (프롬프트)       ← Phase 2, 3 (도구명 참조)
Phase 5 (엔트리포인트)   ← Phase 1, 2, 3, 4
Phase 6 (Actions)        ← Phase 5
```

Phase 1, 2, 3은 서로 독립 → **병렬 구현 가능**

---

## Risk Assessment

| Risk | Level | Mitigation |
|------|-------|------------|
| Discord multipart/form-data 동작 차이 | MEDIUM | Node 20 Native FormData 테스트. 실패 시 텍스트 폴백 |
| Brave Search 뉴스 품질 부족 | LOW | 쿼리 튜닝 (`stock news` 키워드). 최악의 경우 빈 결과 → 카탈리스트 없이 진행 |
| 특이종목 SQL 성능 | LOW | 기존 인덱스(symbol+date) 활용. daily_prices 조인 2회로 제한 |
| 일간 프롬프트 변경으로 기존 리포트 품질 저하 | MEDIUM | 기존 주간 프롬프트에 현행 로직 보존. 일간은 단순화 |
| Brave API 무료 한도 초과 | LOW | 월 100건 미만 예상. 한도 도달 시 로그 경고 + 카탈리스트 스킵 |

---

## Estimated Complexity: M

총 6개 Phase. Phase 1~3 병렬 가능하므로 실질 작업량은 Phase 4개 분량.
