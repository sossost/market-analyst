# auto:blocked 라벨 필터링

## 선행 맥락

PR #353 — 이슈 프로세서가 이슈 #249 (Unusual Whales API 연동)를 자동 처리하여 1707라인 PR 생성.
해당 이슈는 외부 API 구독(월 $125) 미완료 상태라 실행 불가능한 상태였으나, 이슈 프로세서가 차단 여부를 인지하지 못하고 구현을 진행한 것.

## 골 정렬

SUPPORT — 이슈 프로세서의 신뢰도를 높이는 인프라 개선. 직접 알파 기여는 아니나, 잘못된 자동화가 노이즈를 만들어내는 것을 막는다.

## 문제

이슈 프로세서의 필터가 `auto:in-progress`와 `auto:done`만 체크한다.
외부 의존(API 구독, 팀 결정 대기 등)으로 실행 불가능한 이슈에 붙이는 `auto:blocked` 라벨을 인식하지 못해 무조건 구현을 시도한다.

## Before → After

**Before**: `AUTO_LABELS = ['auto:in-progress', 'auto:done']` — blocked 이슈도 구현 시도
**After**: `AUTO_LABELS = ['auto:in-progress', 'auto:done', 'auto:blocked']` — blocked 이슈 스킵

## 변경 사항

### 1. `src/issue-processor/types.ts`
- `AutoLabel` 타입에 `'auto:blocked'` 추가
- `AUTO_LABELS` 배열에 `'auto:blocked'` 추가

### 2. 테스트 — `src/issue-processor/__tests__/githubClient.test.ts` (신규)
- `fetchUnprocessedIssues`가 `auto:blocked` 라벨 이슈를 스킵하는지 검증
- 기존 `auto:in-progress`, `auto:done` 스킵 케이스도 함께 커버

### 3. GitHub 라벨 생성
- 라벨명: `auto:blocked`
- 색상: `#e11d48` (빨간 계열 — 차단 의미)
- 설명: `이슈 프로세서가 처리를 건너뜁니다`

### 4. 이슈 #249에 `auto:blocked` 라벨 부착
- Unusual Whales API 구독 미완료 → 실행 불가능 상태

### 5. PR #353 클로즈
- 코멘트: "이슈 #249는 외부 API 구독이 완료되지 않은 상태에서 이슈 프로세서가 자동 처리한 것. `auto:blocked` 라벨 필터링 추가 후 재처리 예정."

## 작업 계획

| 단계 | 작업 | 에이전트 | 완료 기준 |
|------|------|----------|----------|
| 1 | `types.ts` 수정 — `AutoLabel`, `AUTO_LABELS`에 `'auto:blocked'` 추가 | 실행팀 | 타입 체크 통과 |
| 2 | `githubClient.test.ts` 신규 작성 — blocked 이슈 스킵 검증 | 실행팀 | 테스트 통과 |
| 3 | GitHub 라벨 `auto:blocked` 생성 | 실행팀 | gh label list 확인 |
| 4 | 이슈 #249에 `auto:blocked` 부착 | 실행팀 | 이슈 라벨 확인 |
| 5 | PR #353에 클로즈 코멘트 + 클로즈 | 실행팀 | PR closed 확인 |

단계 1~2는 병렬 가능 (코드 + 테스트). 3~5는 1 완료 후 순서 무관.

## 리스크

- `addLabel` / `removeLabel` 함수 시그니처가 `AutoLabel` 타입을 받으므로, `'auto:blocked'`를 `AutoLabel`에 추가하면 해당 라벨도 부착/제거 가능해진다. 의도된 동작이나, blocked 상태 전환 로직이 나중에 필요할 경우 별도 설계 필요.
- githubClient.test.ts가 없으므로 신규 작성 필요 (커버리지 게이트 80% 유지 확인).

## 의사결정 필요

없음 — 바로 구현 가능
