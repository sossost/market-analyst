# fix: 트리아지 배치 재실행 시 중복 처리 방지 — triaged 라벨 도입

## 선행 맥락

없음.

## 골 정렬

SUPPORT — 자율 이슈 처리 시스템의 안정성 개선. 인프라 품질에 해당하지만 이슈 프로세서가 이 프로젝트의 구현 파이프라인이므로 직접 기여에 준한다.

## 문제

`triageBatch.ts`가 PROCEED 판정 이슈에 아무 라벨도 붙이지 않는다. 배치를 재실행하면 `fetchUnprocessedIssues()`가 동일 이슈를 다시 반환하고, 트리아지를 중복 수행한다. 이슈에 트리아지 코멘트가 두 번 이상 달리고 LLM 호출이 낭비된다.

## Before → After

**Before**
- PROCEED 이슈: 라벨 없음 → 배치 재실행 시 동일 이슈 재트리아지
- `fetchUnprocessedIssues()`: auto: 라벨 없는 이슈 전부 반환
- 트리아지 배치와 이슈 프로세서가 동일 함수 공유 → 필터 기준 충돌 불가피

**After**
- PROCEED 이슈: `triaged` 라벨 부착 → 재실행 시 트리아지 스킵
- 트리아지 배치: `triaged` 라벨 있으면 제외하는 전용 쿼리 사용
- 이슈 프로세서: `triaged` 라벨이 있어도 PROCEED 이슈를 정상 처리 (auto: 라벨 없는 이슈를 잡는 기존 로직 유지)

## 핵심 분석 — fetchUnprocessedIssues 분리 필요성

현재 `fetchUnprocessedIssues()`의 필터링:
```
auto:in-progress | auto:done | auto:blocked | auto:needs-ceo | auto:queued 중 하나라도 있으면 제외
```

`triaged` 라벨을 `AUTO_LABELS`에 추가하면:
- 트리아지 배치: PROCEED 이슈를 중복 처리하지 않음 (의도한 효과)
- 이슈 프로세서: `triaged` 라벨이 붙은 PROCEED 이슈도 제외됨 (의도하지 않은 부작용 — 처리 불가)

따라서 `triaged` 라벨은 `AUTO_LABELS`에 추가하지 않는다.
대신 함수를 목적별로 분리한다.

## 변경 사항

### 1. GitHub 라벨 생성
- `triaged` 라벨: GitHub repo에 생성 (색상 예: `#0075ca`)
- 이 라벨은 트리아지 배치 전용 — 이슈 프로세서 필터링에 사용되지 않음

### 2. types.ts — TriagedLabel 타입 추가
```typescript
export type TriagedLabel = 'triaged'
export const TRIAGED_LABEL: TriagedLabel = 'triaged'
```
`AutoLabel` 유니온에는 포함하지 않는다. `addLabel()`의 타입 파라미터는 `AutoLabel | TriagedLabel`로 확장하거나, 별도 `addTriagedLabel()` 함수로 분리한다.

### 3. githubClient.ts — fetchUnprocessedIssues 분리

기존 `fetchUnprocessedIssues()`: 이슈 프로세서용으로 유지.
- 필터: auto: 라벨 없는 이슈 (현재와 동일)
- `triaged` 라벨이 있어도 포함됨 → PROCEED 이슈 정상 처리

신규 `fetchUntriagedIssues()`: 트리아지 배치 전용.
- 필터: auto: 라벨 없음 AND `triaged` 라벨 없음
- 배치 재실행 시 이미 처리된 이슈 재트리아지 방지

```typescript
// 트리아지 배치 전용
export async function fetchUntriagedIssues(): Promise<GitHubIssue[]> {
  // fetchUnprocessedIssues와 동일한 조회 후
  // triaged 라벨이 있는 이슈도 추가 필터링
  const issues = await fetchUnprocessedIssues()
  return issues.filter(
    (issue) => !issue.labels.includes('triaged'),
  )
}
```

### 4. githubClient.ts — addLabel 타입 확장
```typescript
export async function addLabel(
  issueNumber: number,
  label: AutoLabel | TriagedLabel,
): Promise<void>
```

### 5. triageBatch.ts — fetchUntriagedIssues 사용 + PROCEED 라벨 부착
```typescript
import { fetchUntriagedIssues, addComment, addLabel } from './githubClient.js'

// 기존: const issues = await fetchUnprocessedIssues()
const issues = await fetchUntriagedIssues()

// PROCEED 처리 시 triaged 라벨 부착
// SKIP/ESCALATE는 auto:blocked/auto:needs-ceo가 auto: 라벨로 필터링하므로 triaged 중복 불필요.
// 단, 일관성을 위해 모든 판정에 triaged 부착 — 재실행 방어를 완전히 막는 효과.
if (result.verdict === 'PROCEED') {
  await addLabel(issue.number, 'triaged')
  log(`  ✓ PROCEED — triaged 라벨 부착, 이슈 프로세서 대기`)
}
if (result.verdict === 'SKIP') {
  await addLabel(issue.number, 'auto:blocked')
  await addLabel(issue.number, 'triaged')  // 선택적: 재실행 방어
  log(`  ✗ SKIP — auto:blocked + triaged 라벨 부착`)
}
if (result.verdict === 'ESCALATE') {
  await addLabel(issue.number, 'auto:needs-ceo')
  await addLabel(issue.number, 'triaged')  // 선택적: 재실행 방어
  log(`  ⚠ ESCALATE — auto:needs-ceo + triaged 라벨 부착`)
}
```

> SKIP/ESCALATE는 auto: 라벨이 이미 중복 처리를 막지만 `triaged`도 함께 붙이는 것이 일관성 면에서 낫다. 의사결정 필요 항목 참조.

### 6. 테스트 업데이트

**triageBatch.test.ts 수정:**
- PROCEED: `addLabel(number, 'triaged')` 호출 검증으로 변경
- 기존 "라벨을 붙이지 않는다" 테스트 → "triaged 라벨을 붙인다" 테스트로 교체
- SKIP/ESCALATE: triaged 라벨도 함께 붙이는지 검증 (의사결정 결과 반영)

**githubClient.test.ts 추가:**
- `fetchUntriagedIssues()`: triaged 라벨이 있는 이슈가 제외되는지 검증
- `fetchUnprocessedIssues()`: triaged 라벨이 있어도 포함되는지 검증 (기존 동작 보존)

## 작업 계획

| 단계 | 내용 | 완료 기준 |
|------|------|----------|
| 1 | GitHub 라벨 `triaged` 생성 | `gh label create triaged` 성공, 리포에서 확인 가능 |
| 2 | `types.ts` — `TriagedLabel` 타입 추가 | 타입 에러 없음 |
| 3 | `githubClient.ts` — `addLabel` 타입 확장 + `fetchUntriagedIssues()` 추가 | 기존 `fetchUnprocessedIssues()` 동작 보존, 신규 함수는 `triaged` 제외 |
| 4 | `triageBatch.ts` — `fetchUntriagedIssues()` 사용 + 판정별 `triaged` 라벨 부착 | PROCEED/SKIP/ESCALATE 모두 triaged 라벨 부착 |
| 5 | 테스트 업데이트 | 기존 통과 테스트 + 신규 케이스 추가, 전체 통과 |

## 리스크

- **기존 triaged 이슈 없음**: 현재 리포에 `triaged` 라벨이 없으므로 하위 호환 이슈 없음
- **이슈 프로세서 동작 무변화**: `fetchUnprocessedIssues()`를 수정하지 않으므로 이슈 프로세서 동작은 변경 없음
- **fetchTriageComment 의존**: 이슈 프로세서는 `triaged` 라벨이 붙은 이슈를 처리할 때 `fetchTriageComment()`로 코멘트를 조회한다. 트리아지 배치가 코멘트를 붙이고 `triaged` 라벨을 부착하므로 순서 문제 없음.

## 의사결정 필요

**SKIP/ESCALATE 이슈에도 `triaged` 라벨을 붙일 것인가?**

- auto:blocked/auto:needs-ceo가 이미 중복 처리를 막으므로 기능적으로 필요하지 않음
- 붙이면 일관성이 생기고 "triaged = 트리아지를 완료했다"는 의미가 명확해짐
- 붙이지 않아도 현재 버그는 해결됨

권장: 붙인다. 일관성이 더 중요하고 부작용이 없다.
CEO 판단이 필요하면 주석으로 이유를 기록하고 진행한다.
