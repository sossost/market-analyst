# Plan: 토론 애널리스트 실패 시 Discord 경고 알림

## 문제 정의

토론 엔진에서 개별 애널리스트 실패, thesis 검증 실패, 촉매 데이터 로드 실패가 발생해도
로그에만 기록되고 Discord 알림이 없다. 운영자가 품질 저하를 인지하지 못한 채
불완전한 토론 결과가 리포트에 반영될 수 있다.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| 애널리스트 실패 | `logger.warn`만 출력 | Discord 경고 발송 |
| Thesis 검증 실패 | `logger.warn`만 출력 | Discord 경고 발송 |
| 촉매 데이터 로드 실패 | `logger.warn`만 출력 | Discord 경고 발송 |

## 변경 사항

### 1. `src/agent/run-debate-agent.ts` — 애널리스트 실패 경고

**수정 지점**: 648-652행 (agentErrors 로깅 후)

- `agentErrors.length > 0`이면 Discord 경고 메시지 1회 발송
- 메시지 포맷: `⚠️ **[토론 품질 경고]** {date}: 애널리스트 N명 실패`
- 각 실패 에이전트를 줄별로 나열
- `sendDiscordMessage().catch()` 패턴 (fire-and-forget, 기존 706행 패턴과 동일)
- 메시지 빌더 함수 `buildAgentErrorWarning` 추출하여 export (테스트 가능성)

### 2. `src/agent/run-debate-agent.ts` — Thesis 검증 실패 경고

**수정 지점**: 477-479행 (catch 블록)

- catch 블록에서 `sendDiscordMessage().catch()` 추가
- 메시지 포맷: `⚠️ **[Thesis 검증 경고]** {date}: {에러 요약}`

### 3. `src/debate/catalystLoader.ts` — 촉매 데이터 로드 실패 경고

**수정 지점**: 364-370행 (catch 블록)

- catch 블록에서 `sendDiscordMessage().catch()` 추가
- 메시지 포맷: `⚠️ **[촉매 데이터 경고]** {date}: {에러 요약}`
- `sendDiscordMessage` import 추가

### 4. 테스트

- `src/agent/__tests__/debateWarning.test.ts` — `buildAgentErrorWarning` 단위 테스트
- `src/debate/__tests__/catalystLoader.test.ts` — 기존 테스트에 Discord 호출 검증 추가

## 설계 결정

| 결정 | 선택 | 근거 |
|------|------|------|
| Discord 발송 방식 | `sendDiscordMessage().catch()` | 기존 패턴(706행) 준수. 발송 실패가 토론을 중단시키면 안됨 |
| 발송 타이밍 | 토론 완료 후 1회 | Round별 발송은 노이즈. 한 번에 모아서 발송 |
| QA 점수 차감 | 스코프 아웃 | 별도 이슈로 분리 (이슈 본문 언급대로) |
| 에러 메시지 sanitize | 불필요 | agentErrors는 내부 생성 문자열, 외부 입력 아님 |

## 리스크

- **Discord Rate Limit**: 동시다발 실패 시에도 메시지를 모아 1회만 발송하므로 rate limit 위험 낮음
- **발송 실패**: `.catch()` 패턴으로 격리. fallback 파일 저장은 `sendDiscordMessage` 내부에서 처리됨

## 골 정렬

- **ALIGNED**: 운영 가시성 향상은 시스템 건강도 모니터링의 핵심. Layer 12(도구 에러 감지)의 확장.

## 무효 판정

- **VALID**: 실제 운영에서 애널리스트 실패가 발생하고 있으며, 이를 감지하지 못하는 것은 명확한 갭.
