# fix-issue-processor-cleanup

## 선행 맥락

없음. 신규 버그 보고 (#306).

## 골 정렬

SUPPORT — 인프라 안정성 버그픽스. issue-processor가 피처 브랜치에 잔류하면 이후 모든 cron 작업(토론, ETL)이 피처 브랜치에서 실행되어 DB 스키마 불일치 장애가 발생한다. 핵심 파이프라인(토론 에이전트, ETL)의 정상 동작을 보장하는 방어 인프라 수정이다.

## 문제

`issue-processor`가 PR 생성 후 `main` 브랜치로 복귀하지 않아 로컬 working tree가 피처 브랜치에 잔류. 이후 실행되는 cron 작업(debate-daily, etl-daily 등)이 해당 피처 브랜치 코드로 실행되어 DB 스키마 불일치 등 연쇄 장애 유발.

## Before → After

**Before**: issue-processor 실행 완료 → 브랜치 `feat/issue-XXX`에 잔류 → 다음 cron 작업이 피처 브랜치에서 실행 → 장애

**After**:
- issue-processor 실행 완료 → `git checkout main` 수행 → 항상 main으로 복귀
- Claude CLI 프롬프트에도 cleanup 지시 명시 (이중 방어)
- 주요 cron 스크립트 진입 시 브랜치 가드 → main 아니면 자동 전환 (3중 방어)

## 변경 사항

### 1. `scripts/cron/issue-processor.sh`
- 성공/실패 경로 모두에서 `git checkout main` 실행
- `trap` 활용하여 비정상 종료 시에도 복귀 보장

### 2. `src/issue-processor/executeIssue.ts`
- `buildClaudePrompt()` 실행 순서에 PR 생성 후 `git checkout main` 단계 추가
- 이중 방어: Claude CLI 내부에서도 브랜치 복귀 수행

### 3. `scripts/cron/common.sh`
- `ensure_main_branch()` 유틸 함수 추가

### 4. `scripts/cron/debate-daily.sh`, `etl-daily.sh`, `agent-weekly.sh`, `strategic-review.sh`
- 스크립트 시작 직후 `ensure_main_branch` 호출 (3중 방어)

## 작업 계획

| 단계 | 대상 | 완료 기준 |
|------|------|----------|
| 1 | `common.sh` — `ensure_main_branch()` 추가 | 함수 정의 완료 |
| 2 | `issue-processor.sh` — main 복귀 + trap 강화 | 성공/실패 모두 복귀 |
| 3 | `executeIssue.ts` — 프롬프트 cleanup 지시 추가 | 단계 7 명시 |
| 4 | `debate-daily.sh`, `etl-daily.sh`, `agent-weekly.sh`, `strategic-review.sh` — 브랜치 가드 추가 | 각 스크립트 상단에 가드 호출 |

## 리스크

- `git checkout main` 실행 시 uncommitted changes 충돌 가능 → `git status` 확인 후 stash 또는 force checkout 처리 필요. 단, cron 환경에서 uncommitted changes는 비정상 상태이므로 경고 로그 후 강제 복귀 채택.
- `strategic-review.sh`는 이미 `git pull --rebase origin main`을 수행하므로 브랜치 가드가 선행 필요.

## 의사결정 필요

없음 — 바로 구현 가능
