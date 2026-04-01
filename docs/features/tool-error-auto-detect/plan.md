# Plan: 에이전트 도구 에러 자동 감지 파이프라인

## 문제 정의

`executeTool`이 도구 에러를 catch해서 `{ error: "..." }` JSON으로 리턴하면, 에이전트 루프는 이를 정상 응답으로 처리한다. LLM은 "데이터 없음"으로 우회하고, QA는 데이터 부재 시 검증을 스킵한다. 결과적으로 도구 에러가 어디에서도 감지되지 않는 사각지대가 존재한다.

**실제 사례:** `findNewHighLow` 타입 불일치(#541)가 이 경로로 수주간 방치되어 모든 일간 리포트에서 브레드스 데이터가 누락되었다.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| 도구 에러 인지 | 로그에만 남음, 아무도 모름 | Discord 즉시 알림 → 당일 인지 |
| 에러 추적 | 없음 | GitHub 이슈 자동 생성 → 추적/관리 |
| 리포트 품질 | 핵심 데이터 누락돼도 발송 | 핵심 도구 실패 시 AgentResult에 경고 포함 |
| 중복 알림 | N/A | 세션 내 dedup(Discord) + 제목 기반 dedup(GitHub) |

## 골 정렬

- **ALIGNED**: 브레드스 데이터(A/D ratio, Phase 2 비율)는 시장 레짐 판정의 핵심 입력. 도구 에러 방치는 프로젝트의 1번 KPI(thesis 적중률)에 직접적 영향.

## 변경 사항

### 1. 새 파일: `src/tools/toolErrorReporter.ts`

도구 에러 보고 전담 모듈:
- `reportToolError(toolName, errorMessage, input)` — 메인 진입점
- Discord 알림: `sendDiscordError` 활용, 세션 내 dedup (toolName+error Set)
- GitHub 이슈 생성: GitHub REST API(fetch), 제목 기반 dedup
- 모두 fire-and-forget — 실패해도 에이전트 루프 블로킹 안 함

### 2. 수정: `src/tools/index.ts`

`executeTool` catch 블록에서 `reportToolError` 호출 (fire-and-forget).

### 3. 수정: `src/tools/types.ts`

`ToolError` 타입 추가, `AgentResult`에 `toolErrors?: ToolError[]` 필드 추가.

### 4. 수정: `src/agent/agentLoop.ts`

- 도구 결과에서 `{ error: ... }` 패턴 파싱
- 에러 목록 수집 → `AgentResult.toolErrors`에 포함
- 핵심 도구 실패 시 로그 경고

## 핵심 도구 목록

실패 시 리포트 품질에 직접 영향을 주는 도구:
- `get_market_breadth`
- `get_leading_sectors`
- `get_index_returns`

## 작업 계획

| 순서 | 작업 | 파일 |
|------|------|------|
| 1 | ToolError 타입 + AgentResult 확장 | `src/tools/types.ts` |
| 2 | toolErrorReporter 구현 | `src/tools/toolErrorReporter.ts` |
| 3 | executeTool에 reporter 연결 | `src/tools/index.ts` |
| 4 | agentLoop에 에러 파싱/수집 추가 | `src/agent/agentLoop.ts` |
| 5 | 테스트 작성 | `src/tools/__tests__/` |

## 리스크

| 리스크 | 대응 |
|--------|------|
| Discord/GitHub API 실패가 루프 블로킹 | fire-and-forget + try-catch. 실패 시 logger.error만 |
| 에러 메시지에 민감 정보 포함 | 기존 `sanitizeErrorForDiscord` 활용 |
| GitHub 이슈 폭주 | 제목 기반 dedup으로 동일 에러 중복 방지 |
| GITHUB_TOKEN 미설정 | 토큰 없으면 이슈 생성 스킵 + 경고 로그 |

## 무효 판정

없음. 도구 에러 사각지대는 실제로 수주간 방치된 사례(#541)가 증명하며, 프로젝트 골에 직접적 영향.
