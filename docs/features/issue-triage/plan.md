# 이슈 사전 트리아지 시스템

## 선행 맥락

`auto-issue-processor` Decision 2에서 **트리아지를 제거**한 이력이 있다.
- 당시 판단: "CEO가 PR 리뷰에서 최종 판단하므로 LLM 트리아지 단계가 불필요한 오버헤드"
- 이번에 다시 도입하는 이유: 90분 Claude CLI 세션이 HOLD/REJECT PR을 만들고 나서야 사후 판정되는 문제가 실증됨. 사전에 5분짜리 트리아지로 걸러내면 90분 절약.
- 당시와의 차이: 당시에는 트리아지가 "분류"만 하고 CEO가 착수 판단을 해야 했음. 이번에는 트리아지가 분석 코멘트를 남기고 자동으로 PROCEED/SKIP 판정까지 하므로 CEO 개입 없이 파이프라인이 계속 흐른다.

## 골 정렬

**SUPPORT** -- 직접적으로 Phase 2 포착 기능은 아니지만, 자율 이슈 처리 파이프라인의 품질을 높여 불필요한 리소스(90분 세션) 낭비를 제거하고, 구현 품질을 사전 가이드하는 인프라 개선이다.

## 문제

이슈 프로세서가 가치 판단 없이 바로 90분 Claude CLI 세션을 실행한다. PR 리뷰어가 사후에 HOLD/REJECT를 내려도 이미 90분이 소모된 후다.

## Before -> After

**Before**: 이슈 생성 -> 즉시 90분 Claude CLI 실행 -> PR 생성 -> 사후 리뷰에서 HOLD/REJECT 가능

**After (최종 구조)**:
```
09:00 KST  배치 트리아지(triageBatch) — 미처리 이슈 전체 분석
              PROCEED → 코멘트만 남기고 대기
              SKIP    → 코멘트 + auto:blocked 라벨 부착
              ESCALATE→ 코멘트 + auto:needs-ceo 라벨 부착
10:00~ KST 이슈 프로세서(loopOrchestrator) — 매 정시 실행
              fetchUnprocessedIssues() → SKIP/ESCALATE 이슈는 auto: 라벨로 이미 필터링됨
              fetchTriageComment() → 배치가 남긴 분석 코멘트 읽기
              executeIssue(issue, triageComment) → 구현 실행
```

**설계 근거**: 트리아지(3분)와 구현(90분)을 별도 cron으로 분리하면
- 트리아지가 실패해도 구현 파이프라인에 영향 없음
- 이슈 프로세서가 단순 읽기 폴백으로 동작 (triageComment 없으면 기존 방식대로)

## 변경 사항

### 1. 신규: `src/issue-processor/triageIssue.ts`

트리아지 전담 모듈. Claude CLI `--print` 모드로 이슈를 분석한다.

**입력**: `GitHubIssue`
**출력**: `TriageResult` (verdict: PROCEED | SKIP | ESCALATE, comment: string)
**실행 방식**: `claude --print` (도구 호출 없음, 텍스트 분석만)
**타임아웃**: 5분

**판정 기준:**
- PROCEED: 골 정렬 ALIGNED 또는 SUPPORT + 무효 판정 없음 + 실행 가능
- SKIP: 골 정렬 NEUTRAL/MISALIGNED, 또는 무효 판정 해당, 또는 정보 부족
- ESCALATE: 판단 불가능한 경우 (예외적)

**CEO 수동 이슈**: `strategic-review`/`report-feedback` 라벨 없는 이슈는 항상 PROCEED 강제

### 2. 신규: `src/issue-processor/triageBatch.ts`

배치 트리아지 진입점. 09:00 KST cron에 의해 실행됨.

```
fetchUnprocessedIssues() → 미처리 이슈 전체 (최대 20건)
for each issue:
  triageIssue(issue)
  PROCEED  → 코멘트만 남기고 라벨 안 붙임
  SKIP     → 코멘트 + auto:blocked 라벨
  ESCALATE → 코멘트 + auto:needs-ceo 라벨
```

### 3. 수정: `src/issue-processor/index.ts`

triageIssue 인라인 호출 제거. 배치가 남긴 코멘트를 읽어 executeIssue에 전달.

```
기존: fetchUnprocessedIssues -> triageIssue -> executeIssue
변경: fetchUnprocessedIssues -> fetchTriageComment -> executeIssue(issue, triageComment)
```

SKIP/ESCALATE 이슈는 auto: 라벨로 이미 필터링되어 fetchUnprocessedIssues에서 제외됨.

### 4. 수정: `src/issue-processor/githubClient.ts`

`fetchTriageComment(issueNumber)` 추가:
이슈 코멘트 중 `[사전 트리아지]` 마커가 있는 가장 최근 코멘트 본문 반환.

### 5. 수정: `src/issue-processor/executeIssue.ts`

`buildClaudePrompt`에 `triageComment?: string` 파라미터 추가.
- triageComment 있음: `<triage-analysis>` 태그로 감싸 프롬프트에 삽입, 골 정렬 자체 검증 대체
- triageComment 없음(폴백): 기존 프롬프트 그대로 유지

### 6. 신규: 공유 유틸 `src/issue-processor/cliUtils.ts`

`buildSandboxedEnv()` + `classifyCliError(error, stderr, timeoutMs)` 추출.
executeIssue, triageIssue, feedbackProcessor 3곳에서 import.

### 7. 신규: cron/launchd 설정
- `scripts/cron/triage-issues.sh` — 배치 트리아지 실행 스크립트
- `scripts/launchd/com.market-analyst.issue-triage.plist` — 09:00 KST 1회 실행
- `scripts/launchd/com.market-analyst.issue-processor.plist` — 09시 항목 제거, 10시부터 시작 (17회)

### 8. 타입: `src/issue-processor/types.ts`

`TriageVerdict`, `TriageResult` 타입 추가.
`AutoLabel`에 `auto:needs-ceo`, `auto:queued` 추가.

## 작업 계획 (완료)

- Phase 1: triageIssue.ts + types.ts — 완료
- Phase 2: triageBatch.ts 신규 + index.ts 배치 분리 + githubClient.ts fetchTriageComment — 완료
- Phase 3: cron/launchd 설정 — 완료
- Phase 4: 테스트 (triageIssue.test.ts, triageBatch.test.ts, index.test.ts) — 완료

## 리스크

1. **트리아지 프롬프트 품질**: 트리아지가 너무 보수적이면 유효 이슈도 SKIP. 너무 관대하면 무의미. 초기에는 관대하게 시작하고 SKIP 로그를 모니터링하여 조정.

2. **타이밍 충돌**: 트리아지(~3분) + executeIssue(~90분) = ~93분. 현재 루프가 1시간 간격이므로 다음 루프와 겹칠 수 있다. 하지만 이건 기존에도 동일한 상황(90분 > 60분)이고, loopOrchestrator가 "머지 가능한 PR 있으면 이슈 처리 스킵"으로 이미 충돌을 방지하고 있다. 트리아지 3분 추가는 실질적 영향 없음.

3. **폴백 안전성**: 트리아지 실패 시 PROCEED로 폴백하므로 기존 동작은 보존된다. 최악의 경우 "트리아지 없이 기존처럼 동작"이므로 회귀 리스크 없음.

## 의사결정 필요

없음 -- 바로 구현 가능.

CEO 이슈 처리 규칙(라벨 기반 자동/수동 식별, 수동 이슈는 항상 PROCEED)은 매니저-플래너 자율 판단으로 결정했다. 이유: CEO가 직접 만든 이슈를 에이전트가 거부하는 것은 프로토콜 위반이며, 라벨 기반 식별이 가장 안정적인 구분 방법이다.
