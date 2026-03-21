# 자동 PR 리뷰 에이전트

이슈 프로세서가 생성한 PR을 자동으로 검토하는 병렬 리뷰 시스템.

## 선행 맥락

없음 — 이 기능은 신규 도입.

단, 다음 기존 시스템을 베이스로 패턴을 재사용한다:
- `src/issue-processor/executeIssue.ts` — Claude Code CLI execFile 패턴 (stdin 프롬프트, ANTHROPIC_API_KEY unset, timeout, maxBuffer)
- `scripts/cron/strategic-review.sh` — launchd에 의해 호출되는 cron 스크립트 구조 (lock file, ensure_main_branch, run_claude_p)
- `scripts/cron/common.sh` — log(), send_error(), load_env(), ensure_main_branch() 공유 유틸리티
- `scripts/launchd/com.market-analyst.strategic-review.plist` — plist 구조 (StartCalendarInterval, StandardOutPath)

## 골 정렬

SUPPORT — 간접 기여.

이 기능은 이슈 프로세서가 생성한 PR의 품질을 자동 검증하여 CEO의 코드 리뷰 부담을 줄인다. 주도섹터/주도주 포착 기능 자체를 만드는 것이 아니라, 그 기능을 만드는 파이프라인(이슈 처리 → PR → 머지)의 품질 게이트를 강화한다. 구현 오류를 조기 탐지하면 분석 신뢰도가 유지되므로 간접적으로 프로젝트 골에 기여한다.

## 문제

이슈 프로세서가 자동으로 PR을 생성하지만, CEO가 매 PR을 직접 리뷰해야 하는 부담이 있다. 코드 품질 이슈나 골 정렬 문제를 사람이 발견하기 전 자동 리뷰가 먼저 잡아주면 CEO는 최종 판단에만 집중할 수 있다.

## Before → After

**Before**: 이슈 프로세서 → PR 생성 → CEO 직접 리뷰 → 승인/피드백

**After**: 이슈 프로세서 → PR 생성 → (자동) Strategic Reviewer + Code Reviewer 병렬 실행 → GitHub PR 코멘트 부착 → CEO 최종 판단

## 변경 사항

### 신규 파일

```
scripts/cron/pr-reviewer.sh                          — 리뷰 오케스트레이터 쉘 스크립트
scripts/launchd/com.market-analyst.pr-reviewer.plist — launchd 스케줄 정의
src/pr-reviewer/index.ts                             — PR 탐색 + 리뷰 실행 오케스트레이터
src/pr-reviewer/findReviewablePrs.ts                 — 리뷰 대상 PR 탐색 (gh CLI)
src/pr-reviewer/postReviewComment.ts                 — GitHub PR 코멘트 작성 (gh CLI)
src/pr-reviewer/runReviewer.ts                       — Claude Code CLI 호출 래퍼
src/pr-reviewer/types.ts                             — 타입 정의
src/pr-reviewer/__tests__/findReviewablePrs.test.ts  — 단위 테스트
src/pr-reviewer/__tests__/postReviewComment.test.ts  — 단위 테스트
```

### 수정 파일

```
scripts/launchd/setup-launchd.sh — PLISTS 배열에 com.market-analyst.pr-reviewer 추가
```

## 아키텍처 설계

### 타이밍 전략

이슈 프로세서는 매 정시(:00)에 실행된다. PR 생성에는 5~15분 소요된다. PR 리뷰어는 매 정시 :15에 실행하면 이슈 프로세서 결과를 안정적으로 수신할 수 있다.

```
:00  이슈 프로세서 실행 → PR 생성 (5~15분)
:15  PR 리뷰어 실행 → 대기 중인 PR 탐색 → Strategic + Code 병렬 리뷰
```

launchd `StartCalendarInterval`의 `Minute` 키로 :15를 지정한다. 이슈 프로세서와 동일한 18개 시간대(KST 09:00~02:00)에 맞춰 등록한다.

### PR 탐색 로직

`findReviewablePrs.ts`가 담당한다. 다음 조건을 모두 만족하는 PR만 리뷰 대상으로 선정한다:

1. **상태 OPEN** — 이미 머지/클로즈된 PR은 스킵
2. **자동 생성 PR** — 이슈 프로세서가 만든 PR만 대상. 브랜치명이 `fix/issue-*`, `feat/issue-*`, `refactor/issue-*`, `chore/issue-*` 패턴과 일치해야 함
3. **미리뷰 PR** — 이미 리뷰어 코멘트가 달린 PR은 재실행 방지. gh CLI로 PR 코멘트를 조회하여 `[자동 PR 리뷰]` 마커가 없는 PR만 선정

```typescript
// gh 호출 패턴 (githubClient.ts 재사용)
gh pr list --state open --json number,title,headRefName,url
// 브랜치명 패턴 필터링
// PR 코멘트 조회로 이미 리뷰된 PR 제외
```

리뷰 대상은 한 번에 최대 2건으로 제한한다(이슈 프로세서와 동일한 보수적 상한).

### 병렬 리뷰 실행

`index.ts`가 각 PR에 대해 Strategic Reviewer와 Code Reviewer를 `Promise.all()`로 병렬 실행한다. 리뷰어 하나가 실패해도 다른 리뷰어는 계속 진행하며, 부분 결과로 코멘트를 작성한다.

```typescript
const [strategicResult, codeResult] = await Promise.allSettled([
  runStrategicReviewer(pr),
  runCodeReviewer(pr),
])
```

### Claude Code CLI 호출 방식

`executeIssue.ts`의 패턴을 그대로 따른다:

```typescript
// execFile 직접 호출 (bash 경유 X)
// stdin으로 프롬프트 전달 (임시 파일 X)
// ANTHROPIC_API_KEY unset (Max 구독 우선)
// timeout: 30분 (리뷰는 구현보다 빠름)

const child = execFile('claude',
  ['--print', '--dangerously-skip-permissions', '--output-format', 'text'],
  { timeout: 30 * 60 * 1_000, env: buildSandboxedEnv() },
  callback
)
child.stdin?.end(prompt, 'utf-8')
```

### 코멘트 작성

두 리뷰어의 결과를 하나의 PR 코멘트로 합산하여 게시한다. `gh pr comment` CLI를 사용한다(GitHub API 직접 호출 불필요). 코멘트 상단에 `[자동 PR 리뷰]` 마커를 포함하여 중복 실행 방지용 식별자로 활용한다.

## 프롬프트 설계 방향

### Strategic Reviewer 프롬프트

역할: 골 정렬, 이슈 요구사항 충족 여부, 아키텍처 적합성 검토.

프롬프트에 포함할 컨텍스트:
- PR 번호, 제목, 연결된 이슈 번호
- PR body 전문 (요구사항 기술 포함)
- 변경된 파일 목록 (`gh pr diff --name-only`)
- 프로젝트 골 정의

검토 항목:
1. **골 정렬**: 이 PR이 "Phase 2 주도섹터/주도주 초입 포착" 골에 ALIGNED / SUPPORT / NEUTRAL / MISALIGNED 중 어디에 해당하는가
2. **이슈 충족**: 이슈에서 요구한 기능이 PR body 및 변경 목록에 구현되었는가
3. **무효 판정**: LLM 백테스트 패턴, 같은 LLM 생성+검증 루프에 해당하는가
4. **종합**: PROCEED / HOLD / REJECT + 사유 한 줄

출력 형식 (구조화된 텍스트):
```
### Strategic Review

골 정렬: ALIGNED | SUPPORT | NEUTRAL | MISALIGNED
이슈 충족: YES | PARTIAL | NO
무효 판정: CLEAR | FLAGGED
종합: PROCEED | HOLD | REJECT

**사유**
(2~4줄)
```

### Code Reviewer 프롬프트

역할: 코드 품질, 보안, 테스트 커버리지, 프로젝트 패턴 준수 검토.

프롬프트에 포함할 컨텍스트:
- PR 번호, 제목
- `gh pr diff` 전문 (변경 코드)
- 코딩 스타일 기준 요약 (CLAUDE.md의 코딩 원칙)

검토 항목:
1. **타입 안전성**: null 체크 명시적 (`== null`), any 금지
2. **Guard clause**: early return 패턴 준수
3. **SRP**: 함수/모듈 단일 책임
4. **보안**: 하드코딩 시크릿, 환경변수 직접 접근 여부
5. **테스트**: 비즈니스 로직 테스트 존재 여부
6. **패턴 일관성**: 기존 코드베이스 패턴(execFile, logger, Guard clause) 준수

각 이슈는 심각도로 분류한다: CRITICAL / HIGH / MEDIUM / LOW

출력 형식 (구조화된 텍스트):
```
### Code Review

**이슈 목록**
- [CRITICAL] (파일명:라인) 설명
- [HIGH] (파일명:라인) 설명
- [MEDIUM] (파일명:라인) 설명

**종합**
PASS | REVIEW_NEEDED | BLOCK

CRITICAL/HIGH 이슈 수: N개
```

## 에지케이스 처리

| 상황 | 처리 방식 |
|------|-----------|
| 리뷰 대상 PR 없음 | 로그만 남기고 정상 종료 (`exit 0`) |
| PR에 이미 `[자동 PR 리뷰]` 코멘트 있음 | 해당 PR 스킵 (중복 리뷰 방지) |
| Strategic Reviewer 실패 | Code Reviewer 결과만으로 코멘트 작성. 실패 사유 명시 |
| Code Reviewer 실패 | Strategic Reviewer 결과만으로 코멘트 작성. 실패 사유 명시 |
| 두 리뷰어 모두 실패 | Discord send_error 알림 후 종료 |
| Claude CLI 타임아웃 (30분) | 에러 코멘트 작성 + Discord 알림 |
| 이슈 프로세서와 동시 실행 | 별도 lock file로 독립적 관리. 충돌 없음 (읽기 전용 작업이 대부분) |
| PR이 리뷰 도중 클로즈/머지됨 | gh 코멘트 API 실패 → 에러 로그만 남기고 계속 진행 |

## launchd 스케줄 설정

**plist 파일**: `scripts/launchd/com.market-analyst.pr-reviewer.plist`

이슈 프로세서 plist 구조를 그대로 복사하되 다음을 변경:
- Label: `com.market-analyst.pr-reviewer`
- ProgramArguments: `scripts/cron/pr-reviewer.sh`
- StartCalendarInterval: 이슈 프로세서와 동일한 18개 시간대, 단 Minute는 `15`
- StandardOutPath/ErrorPath: `logs/launchd-pr-reviewer.log`

```xml
<!-- KST 09:15~02:15 매시 :15분 18개 트리거 -->
<dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>15</integer></dict>
<dict><key>Hour</key><integer>10</integer><key>Minute</key><integer>15</integer></dict>
<!-- ... 동일하게 02:15까지 -->
```

**setup-launchd.sh 수정**: PLISTS 배열에 `com.market-analyst.pr-reviewer` 추가. 에코 출력에 스케줄 설명 추가.

## 작업 계획

### Phase 1: 코어 모듈 구현

담당: backend-engineer

1. `src/pr-reviewer/types.ts` 작성
   - 완료 기준: `ReviewablePr`, `ReviewResult`, `ReviewerOutput` 타입 정의 완료

2. `src/pr-reviewer/findReviewablePrs.ts` 작성
   - 완료 기준: OPEN + 브랜치 패턴 + 미리뷰 조건 필터링 동작 확인. 단위 테스트 작성 (gh CLI mock).

3. `src/pr-reviewer/runReviewer.ts` 작성
   - 완료 기준: executeIssue.ts 패턴으로 Claude Code CLI 호출. Strategic/Code 두 프롬프트 지원. 타임아웃 30분.

4. `src/pr-reviewer/postReviewComment.ts` 작성
   - 완료 기준: `gh pr comment` 호출로 PR에 코멘트 작성. `[자동 PR 리뷰]` 마커 포함. 단위 테스트 작성.

5. `src/pr-reviewer/index.ts` 작성
   - 완료 기준: findReviewablePrs → Promise.allSettled 병렬 리뷰 → postReviewComment 흐름 완성. CLI 직접 실행 지원.

### Phase 2: 쉘 스크립트 + launchd

담당: backend-engineer

6. `scripts/cron/pr-reviewer.sh` 작성
   - 완료 기준: strategic-review.sh 구조 재사용. lock file, ensure_main_branch, load_env, send_error 포함. `npx tsx src/pr-reviewer/index.ts` 실행.

7. `scripts/launchd/com.market-analyst.pr-reviewer.plist` 작성
   - 완료 기준: issue-processor.plist 구조 재사용. Minute=15으로 18개 StartCalendarInterval 정의.

8. `scripts/launchd/setup-launchd.sh` 수정
   - 완료 기준: PLISTS 배열에 추가, 에코 출력에 설명 추가.

### Phase 3: 테스트 + 맥미니 배포

담당: backend-engineer 구현 완료 후, 매니저가 배포 지시

9. 로컬 테스트
   - `npx tsx src/pr-reviewer/index.ts` 직접 실행하여 실제 PR에 코멘트 작성 확인

10. 맥미니 배포
    - `ssh mini@100.77.162.69`로 접속
    - `git pull` 최신화
    - `./scripts/launchd/setup-launchd.sh` 실행 (기존 등록 해제 후 재등록)
    - `launchctl list | grep pr-reviewer`로 등록 확인
    - 완료 기준: `com.market-analyst.pr-reviewer`가 launchctl list에 나타남

## 리스크

- **Claude CLI 부하**: 이슈 프로세서와 :15 간격으로 실행되므로 동시에 두 개의 Claude CLI 프로세스가 뜰 수 있음. 이슈 프로세서 타임아웃이 90분이므로 이론상 겹칠 수 있으나, 맥미니 리소스 여유가 있으면 문제없음. 모니터링 필요.
- **PR 코멘트 중복**: `[자동 PR 리뷰]` 마커 기반 필터링이 핵심 보호 장치. 마커 검사가 실패하면 중복 코멘트 발생 가능. PR 코멘트 조회 실패 시 해당 PR을 스킵하는 방어 로직 추가 필요.
- **브랜치 패턴 오매칭**: `fix/issue-*` 패턴이 이슈 프로세서 외의 수동 브랜치와 겹칠 수 있음. 허용 가능한 수준의 오분류이므로 허용.

## 의사결정 필요

없음 — 바로 구현 가능.

단, 다음 사항은 구현 시 backend-engineer가 판단하여 처리:
- PR diff가 너무 큰 경우(예: 1,000줄 초과) Code Reviewer 프롬프트에 포함할 diff를 상위 N줄로 자를지 여부 (권고: 1,500줄 상한, 초과 시 `--name-only` 목록만 전달하고 이유 명시)
- GitHub 코멘트 길이 제한(65,536자) 초과 시 코멘트 분할 또는 요약 여부 (권고: 분할 없이 요약, 상한 도달 시 마지막에 "이하 생략" 처리)
