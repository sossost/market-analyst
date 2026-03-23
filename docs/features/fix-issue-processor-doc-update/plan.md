# Plan: fix-issue-processor-doc-update

## 문제 정의

이슈 프로세서가 feat 이슈 처리 시 README.md / docs/ROADMAP.md 업데이트를 수행하지 않아,
PR 리뷰어의 Strategic Review가 "feat PR인데 문서 누락"으로 HOLD 판정 → 재작업 루프 발생.

**근본 원인**: `buildClaudePrompt()` 실행 순서에 문서 업데이트 지시가 없었음.
PR 리뷰어는 "feat이면 문서 업데이트 필수"를 체크하지만, 프롬프트에는 해당 지시 부재.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| `buildClaudePrompt()` step 7 | 없음 | feat/아키텍처 변경 시 README.md + ROADMAP.md 업데이트 지시 포함 |
| 테스트 커버리지 | step 7 관련 테스트 없음 | feat/fix 양쪽 케이스 테스트 추가 |
| 이슈 #408 상태 | open (auto:in-progress) | closed |

## 현재 상태

- **코드 수정은 PR #409 (bce7483)에서 이미 반영됨** — step 7이 이미 존재
- **누락된 부분**: step 7에 대한 테스트 커버리지 + 이슈 #408 미클로즈

## 변경 사항

1. `src/issue-processor/__tests__/executeIssue.test.ts`:
   - feat 이슈일 때 문서 업데이트 지시 포함 검증 테스트 추가
   - fix 이슈일 때도 문서 업데이트 불필요 명시 확인 테스트 추가

## 작업 계획

1. 테스트 추가 — buildClaudePrompt 문서 업데이트 지시 검증
2. 테스트 실행 및 커버리지 확인
3. 커밋 + PR 생성으로 #408 클로즈

## 골 정렬

**SUPPORT** — Phase 2 주도섹터/주도주 초입 포착 목표에 직접적이진 않으나,
이슈 프로세서의 자율 처리 안정성을 높여 재작업 루프를 방지하므로 운영 효율성 지원.

## 무효 판정

해당 없음. LLM 백테스트/무효 패턴 아님. 단순 프로세스 버그픽스 + 테스트 보강.

## 리스크

- **낮음**: 테스트 추가만 수행. 프로덕션 코드 변경 없음.
