# triage-json-parse-fix

## 골 정렬

SUPPORT — 트리아지 파싱 버그 수정. 트리아지가 실패하면 PROCEED 폴백으로 처리되어 이슈가 누락되지는 않지만, comment(구현 가이드)가 전달되지 않아 구현 품질이 저하된다. 시스템 신뢰성 보강.

## 문제

`parseTriageOutput`의 regex `/```json\s*([\s\S]*?)```/`가 JSON string value 내부의
triple backtick(예: comment 필드 안의 `` ```sql ``` ``)에서 non-greedy 매칭으로 먼저 끊긴다.
결과적으로 불완전한 JSON이 `extractJsonObject`에 전달되어 파싱 실패 → PROCEED 폴백 + comment 소실.

## Before → After

**Before**
- `parseTriageOutput`이 regex로 `` ```json ``` `` 블록을 먼저 잘라낸 뒤 `extractJsonObject`에 전달
- comment 안에 triple backtick이 있으면 regex가 중간에서 끊겨 파싱 실패

**After**
- regex 단계를 제거하고, `extractJsonObject`를 stdout 전체에 직접 적용
- `extractJsonObject`가 문자열(`"..."`) 내부의 `{`/`}`를 bracket counting에서 제외하도록 개선
- escape 시퀀스(`\\`, `\"`) 정확히 처리하여 `\"` 뒤 문자가 닫힘 따옴표로 오해받지 않도록 처리

## 변경 사항

### `src/issue-processor/triageIssue.ts`

1. **`extractJsonObject` 개선** — 현재 단순 bracket counting에서 문자열 인식 방식으로 교체
   - 문자열 내부 진입/탈출 상태를 추적 (`inString: boolean`)
   - `"` 문자 만나면 inString 토글. 단, 직전 문자가 `\`이면 escape 처리
   - `inString === true`인 동안 `{`/`}` 카운팅 무시
   - escape 처리: `\\`(이중 백슬래시)를 올바르게 핸들링하여 `\\"`가 문자열 닫힘으로 처리되지 않도록 주의

2. **`parseTriageOutput` 단순화** — regex 단계 제거
   - `` ```json ``` `` regex 및 `codeBlockMatch` 분기 삭제
   - `extractJsonObject(stdout.trim())`를 직접 호출

### `src/issue-processor/__tests__/triageIssue.test.ts`

기존 테스트 유지 + 다음 케이스 추가:

- comment에 `` ```sql\nSELECT * FROM t\n``` `` 포함된 `` ```json ``` `` 블록 파싱 성공
- comment에 `` ```typescript\nconst x = {}\n``` `` 포함된 `` ```json ``` `` 블록 파싱 성공
- comment에 `\"`(escaped quote) 포함된 JSON 파싱 성공
- comment에 `\\` 포함된 JSON 파싱 성공

## 작업 계획

| 단계 | 내용 | 에이전트 | 완료 기준 |
|------|------|---------|---------|
| 1 | `extractJsonObject` 문자열 인식 방식으로 교체 | 구현팀 | 기존 테스트 전체 통과 |
| 2 | `parseTriageOutput` regex 단계 제거 | 구현팀 | 기존 테스트 전체 통과 |
| 3 | 신규 테스트 케이스 추가 (코드블록 포함 4종) | 구현팀 | 신규 테스트 모두 통과 |
| 4 | 전체 테스트 수트 실행 확인 | 구현팀 | `pnpm test` 실패 0건 |

단계 1, 2는 의존 관계이므로 순차 실행. 단계 3은 단계 2 이후 순차.

## 리스크

- `extractJsonObject` 로직 교체 시 기존에 통과하던 중괄호 포함 comment 케이스(현재 테스트에 있음)가 깨질 수 있음 → 구현 후 즉시 전체 테스트 확인
- escape 처리(`\\\"`) 엣지 케이스 누락 가능 — 연속 백슬래시 짝수/홀수 판별 로직 필요

## 의사결정 필요

없음 — 바로 구현 가능
