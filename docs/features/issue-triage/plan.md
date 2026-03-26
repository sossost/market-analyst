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
**After**: 이슈 생성 -> 사전 트리아지(~3분) -> PROCEED만 90분 실행 / SKIP은 코멘트만 남기고 종료

## 변경 사항

### 1. 새 파일: `src/issue-processor/triageIssue.ts`

트리아지 전담 모듈. Claude CLI `--print` 모드로 이슈를 분석한다.

**입력**: `GitHubIssue`
**출력**: `TriageResult` (verdict: PROCEED | SKIP | ESCALATE, comment: string)
**실행 방식**: `claude --print` (도구 호출 없음, 텍스트 분석만)
**타임아웃**: 5분 (분석만 하므로 충분)

트리아지 프롬프트가 평가하는 항목:
- 골 정렬: Phase 2 포착 목표와의 관계
- 무효 판정: LLM 백테스트, 자기검증 루프 등
- 실행 가능성: 이슈 본문만으로 구현 가능한 수준인지
- 원인 분석 + 수정 방향 + 영향 범위 + 주의사항 코멘트 생성

**판정 기준:**
- PROCEED: 골 정렬 ALIGNED 또는 SUPPORT + 무효 판정 없음 + 실행 가능
- SKIP: 골 정렬 NEUTRAL/MISALIGNED, 또는 무효 판정 해당, 또는 정보 부족으로 실행 불가
- ESCALATE: 판단 불가능한 경우 (예외적)

**CEO 이슈 처리 규칙:**
- CEO 수동 이슈(라벨에 `strategic-review`도 `report-feedback`도 없는 이슈)는 SKIP 판정하지 않는다.
- 이유: ALLOWED_AUTHORS가 `sossost` 하나이므로 모든 이슈가 CEO 작성이지만, 자동 시스템이 생성하는 이슈에는 반드시 `strategic-review` 또는 `report-feedback` 라벨이 붙어 있다.
- 라벨로 "자동 생성 이슈"를 식별하고, 이 이슈들만 SKIP 판정 대상으로 삼는다.
- CEO가 수동으로 만든 이슈(위 두 라벨 없음)는 트리아지 분석 코멘트는 남기되, 판정은 항상 PROCEED로 강제한다.

### 2. `src/issue-processor/index.ts` 수정

`processIssues()` 함수에 트리아지 단계 삽입:

```
기존: fetchUnprocessedIssues -> executeIssue
변경: fetchUnprocessedIssues -> triageIssue -> (PROCEED만) executeIssue
```

- PROCEED: 트리아지 코멘트를 이슈에 남기고 executeIssue로 진행
- SKIP: 트리아지 코멘트를 이슈에 남기고 `auto:blocked` 라벨 부착. executeIssue 건너뜀
- ESCALATE: 트리아지 코멘트를 이슈에 남기고 `auto:needs-ceo` 라벨 부착. executeIssue 건너뜀
- 트리아지 실패(타임아웃/에러): PROCEED로 폴백 (기존 동작 보존). 로그에 경고만 남김.

### 3. `src/issue-processor/types.ts` 수정

새 타입 추가:

```typescript
export type TriageVerdict = 'PROCEED' | 'SKIP' | 'ESCALATE'

export interface TriageResult {
  verdict: TriageVerdict
  comment: string  // 이슈에 남길 분석 코멘트
}

export type AutoLabel = 'auto:in-progress' | 'auto:done' | 'auto:blocked' | 'auto:needs-ceo' | 'auto:queued'
```

`auto:needs-ceo`와 `auto:queued`는 기존 라벨에 이미 존재. `AutoLabel` 타입에 추가만 하면 된다.

### 4. `src/issue-processor/executeIssue.ts` 프롬프트 조건부 전환

`buildClaudePrompt` 시그니처에 `triageComment?: string` 파라미터를 추가한다.

**triageComment가 있을 때** (정상 트리아지 통과):
- 프롬프트 상단에 "사전 트리아지 분석" 섹션을 추가하여 구현 방향 가이드로 전달
- 기획서 자체 검증 단계(3번)의 골 정렬/무효 판정 지시를 "사전 트리아지에서 검증 완료. 아래 분석을 참고하라"로 대체

**triageComment가 없을 때** (트리아지 폴백):
- 기존 프롬프트를 그대로 유지 (골 정렬 + 무효 판정 자체 검증 포함)
- 트리아지 실패 시에도 검증 공백이 발생하지 않도록 보장

변경 범위:
- `buildClaudePrompt` 시그니처에 `triageComment?: string` 파라미터 추가
- 3번 단계를 triageComment 유무에 따라 조건부 렌더링

### 5. PR 리뷰어 strategic 부분과의 역할 분담

사전 트리아지와 사후 strategic review의 중복을 정리한다.

| 검토 항목 | 사전 트리아지 | 사후 Strategic Review |
|-----------|-------------|---------------------|
| 골 정렬 | O (사전 판단) | O (구현 결과 기준 재확인) |
| 무효 판정 | O (사전 차단) | O (구현에서 드러난 무효 패턴) |
| 이슈 충족 여부 | X (구현 전이므로 불가) | O (diff 기반 확인) |
| 문서 업데이트 | X | O |
| 수정 방향 가이드 | O | X (이미 구현됨) |

**변경 없음**: Strategic reviewer 프롬프트는 그대로 유지한다. 사전 트리아지가 있어도 구현 결과를 기준으로 다시 확인하는 것은 가치가 있다. 다만 사전 트리아지가 잘 작동하면 HOLD/REJECT 빈도가 자연스럽게 줄어들 것이다.

### 6. 라벨 변경

신규 라벨 생성 불필요. 기존 라벨로 모두 커버:
- `auto:blocked` -- SKIP 판정 시 부착 (기존 라벨)
- `auto:needs-ceo` -- ESCALATE 판정 시 부착 (기존 라벨)
- `auto:in-progress` -- executeIssue 시작 시 부착 (기존 동작)

`scripts/hooks/validate-issue-labels.sh` 변경 불필요.

## 작업 계획

### Phase 1: 트리아지 모듈 구현

1. `src/issue-processor/types.ts`에 `TriageVerdict`, `TriageResult` 타입 추가
2. `src/issue-processor/triageIssue.ts` 신규 생성
   - `triageIssue(issue: GitHubIssue): Promise<TriageResult>` 함수
   - Claude CLI `--print` 모드 호출
   - 프롬프트: 골 정렬 + 무효 판정 + 실행 가능성 분석
   - 출력 파싱: verdict + comment 추출
   - CEO 이슈 강제 PROCEED 로직
   - 타임아웃 5분, 에러 시 PROCEED 폴백
   - 완료 기준: 단위 테스트 통과 (프롬프트 생성, 출력 파싱, CEO 이슈 폴백)

### Phase 2: 이슈 처리 흐름에 삽입

3. `src/issue-processor/index.ts` 수정
   - `processIssues()` 내 executeIssue 호출 전에 triageIssue 호출 삽입
   - 판정에 따른 분기 처리 (PROCEED/SKIP/ESCALATE)
   - 완료 기준: 통합 테스트 -- SKIP 시 executeIssue 미호출 확인

4. `src/issue-processor/executeIssue.ts` 프롬프트 조건부 전환
   - `buildClaudePrompt`에 triageComment 전달
   - triageComment 있으면: 사전 분석 섹션 추가 + 골 정렬 자체 검증 생략
   - triageComment 없으면(폴백): 기존 프롬프트 유지 (검증 공백 방지)
   - 완료 기준: 프롬프트 스냅샷 테스트 갱신

### Phase 3: 테스트

5. `src/issue-processor/__tests__/triageIssue.test.ts` 작성
   - 프롬프트 빌드 테스트
   - 출력 파싱 테스트 (PROCEED/SKIP/ESCALATE 각각)
   - CEO 수동 이슈 강제 PROCEED 테스트
   - 타임아웃/에러 시 PROCEED 폴백 테스트
   - 완료 기준: 커버리지 80%+

6. 기존 테스트 갱신
   - executeIssue 프롬프트 변경에 따른 스냅샷/단위 테스트 수정
   - 완료 기준: 전체 테스트 스위트 통과

## 리스크

1. **트리아지 프롬프트 품질**: 트리아지가 너무 보수적이면 유효 이슈도 SKIP. 너무 관대하면 무의미. 초기에는 관대하게 시작하고 SKIP 로그를 모니터링하여 조정.

2. **타이밍 충돌**: 트리아지(~3분) + executeIssue(~90분) = ~93분. 현재 루프가 1시간 간격이므로 다음 루프와 겹칠 수 있다. 하지만 이건 기존에도 동일한 상황(90분 > 60분)이고, loopOrchestrator가 "머지 가능한 PR 있으면 이슈 처리 스킵"으로 이미 충돌을 방지하고 있다. 트리아지 3분 추가는 실질적 영향 없음.

3. **폴백 안전성**: 트리아지 실패 시 PROCEED로 폴백하므로 기존 동작은 보존된다. 최악의 경우 "트리아지 없이 기존처럼 동작"이므로 회귀 리스크 없음.

## 의사결정 필요

없음 -- 바로 구현 가능.

CEO 이슈 처리 규칙(라벨 기반 자동/수동 식별, 수동 이슈는 항상 PROCEED)은 매니저-플래너 자율 판단으로 결정했다. 이유: CEO가 직접 만든 이슈를 에이전트가 거부하는 것은 프로토콜 위반이며, 라벨 기반 식별이 가장 안정적인 구분 방법이다.
