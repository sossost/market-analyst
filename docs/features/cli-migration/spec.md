# 토론 엔진 Claude Code CLI 전환

## 선행 맥락

**agent-core 결정 기록 (2026-03-04)**에서 "Claude Code CLI" 옵션을 검토했으나 "CLI 의존성, 프로그래마틱 제어 어려움"을 이유로 기각하고 Anthropic SDK를 채택했다. 당시 기각 사유는 tool_use 제어와 세밀한 에러 핸들링 때문이었다.

이번 전환 대상인 Round 1/2/3는 **모두 `disableTools: true`로 호출**된다. 즉, 원래 기각 사유가 적용되지 않는 범위다. 전환 범위가 명확히 제한되어 있으므로 과거 결정과 충돌하지 않는다.

- Round 1/2: `callAgent(client, prompt, msg, { disableTools: true })` — tool_use 없음
- Round 3: `callAgent(client, prompt, msg, { maxTokens: 8192, disableTools: true })` — tool_use 없음
- 토론 엔진 외 agentLoop(메인 에이전트), thesisVerifier, fundamentalAgent 등은 tool_use 사용 → **전환 대상 외**

## 골 정렬

**SUPPORT** — 직접 알파 형성에 기여하지 않으나, 프로젝트 지속 가능성을 확보한다.

- 토론 엔진은 Phase 2 주도섹터/주도주 포착의 핵심 분석 레이어다. 월 $7.88 비용이 누적되면 장기 운영에 부담이 된다.
- 분석 품질에 영향 없는 순수 인프라 최적화다. CLI로 전환해도 같은 모델(claude-sonnet-4-20250514)을 사용하므로 출력 품질은 동일하다.
- 맥미니 Max 구독 내에서 처리하므로 추가 과금이 없다.
- 우선순위: SUPPORT이므로 알파 형성에 직접 기여하는 기능 개발 뒤에 위치하나, 이슈 #74로 이미 명시적 우선순위가 부여되어 있다.

## 문제

토론 엔진(Round 1~3)이 Anthropic SDK를 통해 API를 직접 호출하며 월 $7.88의 비용을 발생시킨다. 모든 호출이 tool_use 없는 단순 text-in/text-out 패턴이어서, 맥미니의 Claude Code CLI(`claude -p`)로 대체하면 Max 구독 내 무과금 처리가 가능하다.

## Before → After

**Before**: `callAgent()` → Anthropic SDK → API 직접 호출 → 월 $7.88 과금

**After**: `execClaude()` 래퍼 → `claude -p` CLI 프로세스 → Max 구독 내 처리 → 월 $0 (토론 엔진 분)

토큰 추적 불가(CLI는 usage 미제공)는 허용 범위 내 trade-off다.

## 변경 사항

### 핵심 변경

1. **`src/agent/debate/execClaude.ts` 신규 생성**
   - `execClaude(systemPrompt: string, userMessage: string, options?: { maxTokens?: number }): Promise<string>` 함수
   - 내부 구현: `child_process.execFile('claude', ['--print', '--output-format', 'text', '--max-turns', '1', '-p', systemPrompt])` 형태로 stdin에 userMessage 전달
   - 타임아웃: 120초 (CLI는 내부 retry 없으므로 넉넉하게)
   - 폴백: CLI 실패(ENOENT, 타임아웃, exit code != 0) 시 기존 Anthropic SDK `callAgent()` 호출
   - 반환: `AgentCallResult` 형태로 래핑 (tokensUsed는 `{ input: 0, output: 0 }` 반환)

2. **`src/agent/debate/callAgent.ts` 수정**
   - `disableTools: true` 경로에서 `execClaude()` 우선 시도
   - CLI 실패 시 기존 SDK 경로로 폴백
   - 변경 최소화: `callAgent()` 시그니처와 반환 타입 유지

3. **debateEngine, round1, round2, round3는 변경 없음**
   - `callAgent()` 인터페이스가 유지되므로 상위 레이어는 무변경

### 영향 범위 분석

| 파일 | 변경 | 사유 |
|------|------|------|
| `src/agent/debate/execClaude.ts` | 신규 | CLI 래퍼 |
| `src/agent/debate/callAgent.ts` | 수정 | disableTools 경로에 CLI 우선 시도 |
| 나머지 debate/*.ts | 변경 없음 | 인터페이스 유지 |
| agentLoop.ts, fundamentalAgent.ts 등 | 변경 없음 | tool_use 사용 → 전환 대상 외 |

## 작업 계획

### 0단계 — 선행 확인 (병렬 수행 가능)

**목적**: 구현 전 맥미니 환경이 실제로 동작하는지 검증

**0-A. 맥미니 Claude Code CLI 설치 및 인증 확인**
- 담당: 탐색 에이전트
- 방법: `ssh <MAC_MINI_HOST> "which claude && claude --version"`
- 합격 기준: claude 바이너리 존재 + 버전 출력 성공

**0-B. `claude -p` 단일 호출 동작 검증**
- 담당: 탐색 에이전트
- 방법: `ssh mini@... "echo 'hello' | claude --print --output-format text"` 또는 `claude -p "ping"`
- 합격 기준: 텍스트 응답 반환, 비정상 종료 없음
- 확인 사항: `--print` vs `-p` 플래그 동작, `--output-format` 지원 여부

**0-C. Max 플랜 rate limit 확인**
- 담당: 탐색 에이전트
- 방법: `ssh mini@... "claude --help"` 후 실제 연속 호출 2~3회 테스트
- 합격 기준: 12회/일 자동 호출(Round 1×4 + Round 2×4 + Round 3×1 = 9회/실행) 허용 여부 확인
- 참고: Max 플랜 기준 대화 길이 제한이 단순 -p 호출에도 적용되는지 확인

**완료 기준**: 0-A, 0-B, 0-C 모두 합격. 실패 시 이슈 업데이트 후 구현 중단.

### 1단계 — `execClaude.ts` 구현

**담당**: 구현 에이전트

**구현 내용**:
```typescript
// 인터페이스 스케치 (구현 에이전트가 구체화)
export async function execClaude(
  systemPrompt: string,
  userMessage: string,
  options?: { maxTokens?: number; timeoutMs?: number },
): Promise<string>
```

- `child_process.execFile` 또는 `spawn` 사용 (stdin으로 userMessage 전달)
- 시스템 프롬프트 전달 방식 결정: `-p systemPrompt\n\nuserMessage` 형태 또는 `--system-prompt` 플래그 확인 필요
- 에러 처리: ENOENT(CLI 없음), 타임아웃, exit code != 0

**완료 기준**: 단위 테스트 통과 (mock execFile 사용)

### 2단계 — `callAgent.ts` 수정 + 폴백 로직

**담당**: 구현 에이전트

**구현 내용**:
- `disableTools: true` 분기에서 `execClaude()` 우선 시도
- CLI 실패 시 기존 SDK 경로로 투명한 폴백
- 폴백 발생 시 `logger.warn` 출력

**완료 기준**: 기존 단위 테스트 통과 + 폴백 경로 테스트 추가

### 3단계 — 통합 테스트 및 맥미니 검증

**담당**: 검증 에이전트

**검증 내용**:
- 맥미니에서 `npm run agent:debate`를 dry-run 수준으로 실행
- Round 1→2→3 전체 플로우 완주 확인
- 타임아웃/에러 없이 synthesis + thesis 추출 성공 여부

**완료 기준**: 맥미니에서 전체 토론 1회 성공 완주

### 4단계 — 코드 리뷰 + PR

**담당**: code-reviewer → pr-manager

## 리스크

### HIGH: CLI 인증 방식 불명확

`claude -p` 호출이 Max 플랜 인증을 사용하는지, API 키를 사용하는지 불명확하다. 맥미니에서 `claude auth login`이 되어 있다면 Max 구독으로 처리되나, 환경변수 `ANTHROPIC_API_KEY`가 설정된 경우 API 과금이 될 수 있다. 0단계에서 반드시 확인해야 한다.

### MEDIUM: 프롬프트 전달 방식

`claude -p` 가 system prompt를 별도 플래그로 받는지, 아니면 user message에 합쳐서 받아야 하는지 CLI 문서 확인 필요. 잘못 전달하면 persona가 손실되어 분석 품질 저하.

### MEDIUM: 토큰 추적 사각지대

CLI는 usage 메타데이터를 반환하지 않는다. 현재 `debateEngine.ts`가 `totalTokens`를 집계하고 로깅하는데, CLI 전환 후 이 값이 0으로 표시된다. 운영 모니터링 정보 손실이지만 분석 품질에는 무영향이다. 허용 trade-off.

### LOW: 병렬 CLI 프로세스 부하

Round 1/2에서 배치당 2개 CLI 프로세스가 동시 spawn된다. 맥미니(Mac mini) 환경에서 문제 없을 것으로 예상되나, 실제 검증 필요.

### LOW: `claude -p` 플래그 미지원 가능성

Claude Code CLI 버전에 따라 `-p` 또는 `--print` 플래그가 없을 수 있다. 0단계에서 `claude --help` 출력으로 사전 확인.

## 의사결정 필요

**없음 — 바로 구현 가능** (단, 0단계 선행 확인 통과 후)

단, 0단계에서 아래 중 하나라도 실패하면 구현 중단:
1. 맥미니에 CLI 미설치 → 설치 선행
2. Max 플랜이 아닌 API 키 인증으로 작동 → 인증 방식 전환 후 재시도
3. `claude -p` 플래그 미지원 → CLI 버전 업그레이드 후 재시도
