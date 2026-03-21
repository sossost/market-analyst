# PR Review Hold Gate

## 선행 맥락

**auto-blocked-label-filter (PR #355)**
이슈에 `auto:blocked` 라벨이 붙으면 이슈 프로세서가 스킵하는 기능을 구현함.
`types.ts`의 `AUTO_LABELS`에 `'auto:blocked'` 추가로 완료.
GitHub 라벨도 이미 존재(`#D93F0B`, "이슈 프로세서 스킵 — 실행 불가능한 이슈").

**현재 loopOrchestrator의 이슈 처리 진입 조건 (loopOrchestrator.ts L173)**
```typescript
const activeMappings = loadAllMappings()
if (activeMappings.length > 0) {
  // 이슈 처리 스킵
}
```
prThreadStore(파일 기반 JSON)에 PR 매핑이 있으면 이슈 처리를 건너뜀.
GitHub의 실제 PR 상태(Draft 여부, 라벨)를 직접 조회하지 않음.

**Strategic Reviewer 출력 파싱 현황**
`buildStrategicPrompt`에서 "종합: PROCEED | HOLD | REJECT" 형식을 명시하지만,
`index.ts`에서 raw output 전체를 코멘트로만 게시하고 판정 파싱은 전혀 없음.
파싱 로직을 신규 추가해야 한다.

## 골 정렬

SUPPORT — 이슈 처리 파이프라인 병목 제거. HOLD/REJECT PR이 prThreadStore에 남아 있으면 새 이슈 처리가 영구 차단됨. 자율 운영 지속성을 유지하는 인프라 개선.

## 문제

Strategic Reviewer가 HOLD 또는 REJECT 판정을 내려도 현재 시스템은 아무 후처리도 하지 않는다.
두 가지 부작용이 발생한다:

1. **PR이 리뷰 가능 상태로 방치됨**: Draft 전환 없이 Open 상태를 유지하여, CEO가 HOLD/REJECT PR을 실수로 머지할 위험이 있다.
2. **이슈 처리 파이프라인 차단**: prThreadStore에 HOLD/REJECT PR 매핑이 남아 있으면 `activeMappings.length > 0` 조건을 충족하여 새 이슈 처리가 영구 스킵된다.

## Before → After

**Before**
- Strategic Reviewer가 HOLD 판정 → PR 코멘트 게시 후 종료
- PR은 Open 상태 유지, prThreadStore에 매핑 잔존
- 다음 루프: `activeMappings.length > 0` → 새 이슈 처리 스킵
- 새 이슈가 쌓여도 파이프라인 멈춤

**After**
- Strategic Reviewer가 HOLD 판정 → PR Draft 전환 + `auto:blocked` PR 라벨 부착 + 사유 코멘트
- prThreadStore에서 해당 PR 매핑 제거
- 다음 루프: `activeMappings.length === 0` → 새 이슈 처리 진행
- 파이프라인 자동 재개

## 변경 사항

### 신규 파일

**`src/pr-reviewer/holdGate.ts`**
Strategic Reviewer 판정 파싱 + HOLD/REJECT 시 후처리를 담당하는 모듈.
- `parseStrategicVerdict(output: string): StrategicVerdict | null`
  정규식으로 "종합: PROCEED | HOLD | REJECT" 라인을 추출.
- `applyHoldGate(prNumber: number, verdict: StrategicVerdict): Promise<void>`
  HOLD/REJECT 시 Draft 전환 → PR 라벨 부착 → 매핑 제거 순으로 실행.

### 수정 파일

**`src/pr-reviewer/index.ts`**
`postReviewComment` 호출 후 strategic 판정을 파싱하여 HOLD/REJECT면 `applyHoldGate` 호출.

**`src/pr-reviewer/postReviewComment.ts`** (선택적)
HOLD/REJECT 시 코멘트 본문에 "이 PR은 Draft로 전환되었습니다. 사유: ..." 문구를 포함할 경우 수정.
단, `applyHoldGate`에서 별도 코멘트를 추가하면 수정 불필요.

**`src/issue-processor/loopOrchestrator.ts`**
Step 3의 이슈 처리 진입 조건 변경:

```typescript
// Before
const activeMappings = loadAllMappings()
if (activeMappings.length > 0) { ... }

// After
const activeMappings = loadAllMappings()
const mergeableMappings = await filterMergeableMappings(activeMappings)
if (mergeableMappings.length > 0) { ... }
```

`filterMergeableMappings`는 각 매핑의 PR이 "Open + non-Draft + `auto:blocked` 라벨 없음"인지
GitHub API로 확인하여 머지 가능한 PR만 반환한다.

## 아키텍처 설계

### 1. 판정 파싱 — `parseStrategicVerdict`

Strategic Reviewer 출력 형식(buildStrategicPrompt 기준):
```
종합: PROCEED | HOLD | REJECT (하나만 선택)
```

파싱 전략:
```typescript
const VERDICT_PATTERN = /^종합:\s*(PROCEED|HOLD|REJECT)/m

export function parseStrategicVerdict(output: string): StrategicVerdict | null {
  const match = VERDICT_PATTERN.exec(output)
  if (match == null) return null
  return match[1] as StrategicVerdict
}
```

파싱 실패 시(null) PROCEED로 처리하여 안전 측으로 폴백.
근거: 파싱 오류로 멀쩡한 PR이 Draft 전환되는 것이 더 위험하다.

### 2. HOLD/REJECT 후처리 — `applyHoldGate`

실행 순서 (순차 — 각 단계가 이전 성공에 의존):
1. `gh pr ready {prNumber} --undo` — Draft 전환
2. `gh pr edit {prNumber} --add-label "auto:blocked"` — PR에 라벨 부착
3. `removePrThreadMapping(prNumber)` — prThreadStore에서 매핑 제거

각 단계 실패 시: 에러 로그 후 다음 단계 시도.
근거: 라벨 부착 실패가 Draft 전환 롤백 사유가 될 만큼 중요하지 않음.

코멘트 추가 여부: `postReviewComment`가 이미 전체 리뷰 내용을 코멘트로 게시하므로,
별도 "Draft 전환됨" 코멘트는 추가하지 않는다.
리뷰 코멘트의 "종합: HOLD" 문구로 충분히 사유가 전달됨.

### 3. 이슈 처리 진입 조건 — `filterMergeableMappings`

```typescript
// loopOrchestrator.ts 내 신규 함수
async function filterMergeableMappings(
  mappings: PrThreadMapping[],
): Promise<PrThreadMapping[]> {
  const results = await Promise.allSettled(
    mappings.map(async (mapping) => {
      const raw = await ghCheck([
        'pr', 'view', String(mapping.prNumber),
        '--json', 'isDraft,labels,state',
      ])
      const data = JSON.parse(raw) as {
        isDraft: boolean
        labels: Array<{ name: string }>
        state: string
      }
      const isOpen = data.state === 'OPEN'
      const isNotDraft = data.isDraft === false
      const isNotBlocked = !data.labels.some((l) => l.name === 'auto:blocked')
      return isOpen && isNotDraft && isNotBlocked ? mapping : null
    }),
  )

  return results
    .filter((r) => r.status === 'fulfilled' && r.value != null)
    .map((r) => (r as PromiseFulfilledResult<PrThreadMapping>).value)
}
```

GitHub API 조회 실패 시: 해당 매핑을 머지 가능으로 간주(보수적).
근거: 조회 실패로 이슈 처리가 멈추는 것이 더 나쁨.

## 에지케이스 처리

| 케이스 | 처리 방식 |
|--------|----------|
| Strategic 리뷰 실패(`success: false`) | 판정 파싱 스킵. 후처리 없이 현행 유지. |
| 판정 파싱 실패(regex 미매칭) | PROCEED로 폴백. 후처리 없음. |
| Draft 전환 실패(이미 Draft거나 권한 오류) | 에러 로그 후 라벨 부착과 매핑 제거는 계속 진행. |
| PR 라벨 부착 실패 | 에러 로그 후 매핑 제거는 계속 진행. |
| `filterMergeableMappings` 조회 실패 | 해당 PR을 머지 가능으로 간주(보수적 처리). |
| REJECT 판정 | HOLD와 동일하게 Draft 전환 + 라벨 부착 + 매핑 제거. |
| Code Review BLOCK이지만 Strategic PROCEED | Code 판정은 Draft 전환 트리거 아님. Strategic 판정만 기준. |

Strategic 판정만 Draft 전환 기준으로 삼는 이유:
Code Review BLOCK은 CEO와 개발자가 코드 수준에서 해결할 사항이고,
골 정렬 위반(HOLD/REJECT)은 시스템 차원의 게이트가 필요한 사항이다.

## 작업 계획

| 단계 | 작업 | 에이전트 | 완료 기준 | 병렬 가능 |
|------|------|----------|----------|----------|
| 1 | `holdGate.ts` 신규 작성 — 판정 파싱 + Draft 전환 + 라벨 부착 + 매핑 제거 | 실행팀 | 유닛 테스트 통과 |  |
| 2 | `index.ts` 수정 — `postReviewComment` 후 `applyHoldGate` 호출 | 실행팀 | 기존 테스트 통과 | 1 완료 후 |
| 3 | `loopOrchestrator.ts` 수정 — `filterMergeableMappings` 추가 + 진입 조건 변경 | 실행팀 | 유닛 테스트 통과 | 1과 병렬 |
| 4 | `holdGate.test.ts` 신규 작성 — 판정 파싱 케이스 + Draft 전환 mock | 실행팀 | 80% 커버리지 | 1과 병렬 |
| 5 | `loopOrchestrator.test.ts` 수정 — filterMergeableMappings 케이스 추가 | 실행팀 | 테스트 통과 | 3 완료 후 |

단계 1, 3, 4는 병렬 시작 가능. 단계 2는 1 완료 후, 단계 5는 3 완료 후.

## 리스크

**PR 라벨 vs 이슈 라벨 혼용**
`auto:blocked`는 이슈 라벨로 설계되어 있으나 PR에도 동일 라벨을 부착한다.
GitHub은 이슈/PR 라벨을 구분하지 않으므로 기술적으로 문제없다.
단, `filterMergeableMappings`에서 PR의 `auto:blocked` 라벨을 체크할 때
이슈에서 연결된 라벨과 혼동할 수 있으나, prThreadStore는 PR 번호 기반이므로 간섭 없음.

**타이밍 경합**
PR 리뷰어(:15 실행)가 Draft 전환 중에 루프 오케스트레이터(:00 실행)가 동시 실행될 가능성.
현재 스케줄: 리뷰어 :15, 오케스트레이터 :00 — 45분 간격으로 경합 없음.
단, 수동 실행 시 경합 가능. `filterMergeableMappings`의 실시간 GitHub 조회가 이를 방어함.

**Strategic 리뷰 실패 시 파이프라인 영구 차단**
Strategic 리뷰가 계속 실패하면 prThreadStore에 매핑이 쌓여 이슈 처리 차단.
이 문제는 현재도 존재하며 이번 기획 범위 밖. (`filterMergeableMappings`가 일부 완화함.)

## 의사결정 필요

없음 — 바로 구현 가능.
