# Implementation Plan: Agent Core

**Status:** Approved
**Created:** 2026-03-04
**Spec:** ./01-spec.md

---

## Spec Summary

**Goal:** Claude Opus 4.6 Tool-use Agent가 매일 ETL 완료 후 자율적으로 시장 데이터를 분석하여 Phase 2 초입 주도주를 발굴하고, 슬랙으로 리포트를 전달하는 시스템

**Key Behaviors:**
- Agent가 7개 전용 도구로 DB 조회 → 이력 확인 → 중복 필터링 → 리포트 작성 → 슬랙 전달 → 이력 저장
- Manual agentic loop으로 토큰 사용량, 반복 횟수 등 세밀하게 제어
- 실패 시 슬랙 에러 알림 + 로컬 파일 fallback

---

## Implementation Phases

### Phase 1: Foundation [Estimated: M]

타입 정의, 도구 프레임워크, Agent 루프 스켈레톤 구축

- [ ] `@anthropic-ai/sdk` 설치
- [ ] `src/agent/tools/types.ts` — AgentTool, AgentConfig, AgentResult 타입 정의
- [ ] `src/types/index.ts` — DailyReportLog, ReportedStock 타입 추가
- [ ] `src/agent/tools/index.ts` — 도구 레지스트리 (등록 + executeTool 함수)
- [ ] `src/agent/agentLoop.ts` — Agent 루프 스켈레톤 (messages.create → tool_use 처리 → 반복)
- [ ] `src/agent/agentLoop.test.ts` — Agent 루프 단위 테스트 (Claude API mock)

**Verify:** `npx tsc --noEmit` 통과, 테스트 통과

---

### Phase 2: DB Tools [Estimated: L]

4개 DB 조회 도구 구현. 기존 `pool` + `retryDatabaseOperation` 패턴 활용.

- [ ] `src/agent/tools/getMarketBreadth.ts`
  - stock_phases에서 Phase 분포, Phase 2 비율, 전일 대비 변화
  - sector_rs_daily에서 시장 전반 RS 평균
  - 파라미터: `{ date: string }`

- [ ] `src/agent/tools/getLeadingSectors.ts`
  - sector_rs_daily + industry_rs_daily에서 RS 상위 섹터/업종
  - change4w, phase2Ratio, groupPhase 포함
  - 파라미터: `{ date: string, limit?: number }`

- [ ] `src/agent/tools/getPhase2Stocks.ts`
  - stock_phases에서 Phase 2 + RS 필터링
  - prevPhase (전환 감지), conditionsMet 포함
  - 파라미터: `{ date: string, min_rs?: number, limit?: number }`

- [ ] `src/agent/tools/getStockDetail.ts`
  - stock_phases + daily_prices + sector/industry RS 조합
  - MA50/150/200, 52w high/low, RS rank 등 상세 정보
  - 파라미터: `{ symbol: string, date: string }`

- [ ] DB 도구 단위 테스트 (SQL 결과 mock)

**Verify:** `npx tsc --noEmit` 통과, 각 도구가 올바른 JSON string 반환, 테스트 통과

---

### Phase 3: IO Tools + Slack [Estimated: M]

3개 IO 도구 구현 + 슬랙 Webhook 전송

- [ ] `src/agent/reportLog.ts` — JSON 파일 읽기/쓰기 헬퍼
  - readReportLogs(daysBack): 최근 N일 리포트 파일 읽기
  - saveReportLog(data): JSON 파일 저장
  - data/reports/ 디렉토리 자동 생성

- [ ] `src/agent/tools/readReportHistory.ts`
  - reportLog.readReportLogs 호출
  - 파라미터: `{ days_back?: number }` (기본 7)

- [ ] `src/agent/slack.ts` — 슬랙 Webhook POST 함수
  - fetch() 사용 (Node 18+ native)
  - 에러 시 로컬 파일 fallback 저장

- [ ] `src/agent/tools/sendSlackReport.ts`
  - slack.sendSlackMessage 호출
  - 파라미터: `{ message: string }`

- [ ] `src/agent/tools/saveReportLog.ts`
  - reportLog.saveReportLog 호출
  - 파라미터: `{ report_data: DailyReportLog }`

- [ ] IO 도구 단위 테스트 (파일시스템 + fetch mock)

**Verify:** `npx tsc --noEmit` 통과, 테스트 통과

---

### Phase 4: System Prompt + Entry Point [Estimated: M]

시스템 프롬프트 설계, Agent 진입점 구현

- [ ] `src/agent/systemPrompt.ts` — 시스템 프롬프트 빌더
  - 역할 정의: 시장 분석 전문가
  - 분석 워크플로우 가이드 (강제 아닌 가이드)
  - 중복 필터링 가이드라인
  - 리포트 포맷 지침 (슬랙 마크다운)
  - 종목 수 제한 가이드 (핵심만, 4000자 이내)

- [ ] `src/agent/run-daily-agent.ts` — 진입점
  - 환경변수 검증 (ANTHROPIC_API_KEY, SLACK_WEBHOOK_URL, DATABASE_URL)
  - getLatestTradeDate()로 거래일 확인
  - 비거래일 처리 (슬랙 알림 or 스킵)
  - agentLoop(config) 실행
  - 성공/실패 로깅
  - pool.end() 정리

- [ ] `src/etl/utils/validation.ts` — F2 환경변수 검증 추가
  - ANTHROPIC_API_KEY 존재 확인
  - SLACK_WEBHOOK_URL 존재 확인

- [ ] `package.json` — 스크립트 추가
  - `"agent:daily": "tsx src/agent/run-daily-agent.ts"`

**Verify:** `npx tsc --noEmit` 통과, `npm run agent:daily` 실행 시 환경변수 없으면 명확한 에러

---

### Phase 5: GitHub Actions + Error Handling [Estimated: S]

CI 통합, 에러 알림

- [ ] `.github/workflows/etl-daily.yml` — Agent 잡 추가
  - `run-agent` job: `needs: validate` 의존
  - 환경변수: DATABASE_URL, ANTHROPIC_API_KEY, SLACK_WEBHOOK_URL
  - 실패 시 슬랙 에러 알림 (별도 step)

- [ ] `src/agent/run-daily-agent.ts` — 에러 핸들링 강화
  - Claude API 에러 (401: 키 문제, 429: 한도 초과, 500: 서버 오류) 처리
  - 슬랙 에러 알림 전송
  - 슬랙 전달 실패 시 로컬 파일 fallback

- [ ] `.env.example` 업데이트
  - ANTHROPIC_API_KEY, SLACK_WEBHOOK_URL 추가

**Verify:** GitHub Actions YAML 문법 유효, 에러 시 슬랙 알림 동작

---

### Phase 6: Testing + Polish [Estimated: M]

통합 테스트, 엣지 케이스 처리

- [ ] Agent 루프 통합 테스트 (mock Claude API + mock DB)
  - Happy path: 도구 호출 → 리포트 생성 → 슬랙 전달 흐름
  - 에러 케이스: API 실패, DB 연결 실패
  - 엣지 케이스: Phase 2 종목 0개, 전체 중복, 첫 실행

- [ ] 거래일 감지 로직 테스트
  - 주말/공휴일 스킵 동작 확인

- [ ] 토큰 사용량 로깅
  - 실행 완료 시 토큰 사용량 콘솔 출력
  - JSON 이력에 metadata로 저장

**Verify:** `npm test` 전체 통과, 80%+ 커버리지

---

## Dependencies

```
Phase 1 (Foundation)
  ↓
Phase 2 (DB Tools) + Phase 3 (IO Tools) ← 병렬 가능
  ↓
Phase 4 (System Prompt + Entry Point) ← Phase 2, 3 모두 필요
  ↓
Phase 5 (GitHub Actions) ← Phase 4 필요
  ↓
Phase 6 (Testing) ← Phase 5 이후
```

## Risk Assessment

| Risk | Level | Mitigation |
|------|-------|------------|
| Claude API 비용 초과 | MEDIUM | MAX_ITERATIONS=15 + max_tokens=8192로 상한선 설정. 토큰 추적으로 모니터링 |
| Agent가 도구를 비효율적으로 사용 | MEDIUM | 시스템 프롬프트에서 명확한 워크플로우 가이드. 실행 로그로 패턴 분석 후 개선 |
| 슬랙 Webhook 실패 | LOW | 로컬 파일 fallback. data/reports/에 항상 저장 |
| GitHub Actions 타임아웃 | LOW | Agent 실행은 2-3분 예상. Actions 기본 6시간 타임아웃 충분 |
| DB 연결 풀 고갈 | LOW | Agent 도구는 순차 실행. 동시 연결 1-2개만 사용. 기존 pool.max=10 충분 |

## Estimated Complexity: M (Medium)

핵심 로직(Agent 루프)은 단순하나, 7개 도구 + 시스템 프롬프트 설계 + CI 통합까지 범위가 넓음.
