# Issue Processor Protocol Unification

## 선행 맥락

없음. 이슈 프로세서 관련 메모리에서 프롬프트 변경 이력 없음.

## 골 정렬

SUPPORT — 이슈 프로세서가 생성하는 PR의 품질(기획→검증→구현 일관성)을 높여 자율 구현 사이클 전반의 신뢰도를 강화한다. Phase 2 포착 직접 기여는 아니나, 시스템 자율성의 품질 기반을 강화한다.

## 문제

이슈 프로세서(`executeIssue.ts`)의 자율 구현 프로세스가 기획 없이 바로 코드로 진입한다. 매니저 미션 프로토콜(기획 → 검증 → 구현)과 불일치하여, 자율 구현 PR의 구조적 품질이 낮다.

## Before → After

**Before**: 7단계 — 브랜치 생성 후 즉시 구현. 기획서 없음, 셀프 리뷰 없음.

**After**: 10단계 — 이슈 분석 후 plan.md 작성 → 자체 검증(골 정렬/무효 판정/구현 범위) → 구현 → 셀프 리뷰 → PR body에 기획서 내용 반영.

## 변경 사항

`src/issue-processor/executeIssue.ts`의 `buildClaudePrompt()` 함수 내 "실행 순서" 섹션만 변경.

### 변경 후 실행 순서 (프롬프트 텍스트)

```
1. `git checkout -b ${branchName}` 브랜치 생성
2. 이슈 분석 후 `docs/features/[feature-name]/plan.md` 기획서 작성:
   - feature-name은 이슈 타이틀에서 kebab-case로 도출
   - 포함 항목: 문제 정의, Before→After, 변경 사항, 작업 계획, 리스크
3. 기획서 자체 검증:
   - 골 정렬: "Phase 2 주도섹터/주도주 초입 포착" 목표와의 관계 (ALIGNED/SUPPORT/NEUTRAL/MISALIGNED)
   - 무효 판정: LLM 백테스트 등 무효 패턴 해당 여부
   - 구현 범위: 불필요한 제약 조건 없는지 확인. MISALIGNED이면 구현 중단 후 PR body에 이유 기재.
4. 기획서 기반 구현
5. 테스트가 통과하는지 확인 (커버리지 80%+)
6. 코드 셀프 리뷰: CRITICAL/HIGH 이슈 있으면 수정 후 재확인
7. 변경사항 커밋 (메시지에 "Closes #${issue.number}" 포함, 기획서도 함께 커밋)
8. `git push -u origin ${branchName}`
9. PR 생성:
   - `.github/PULL_REQUEST_TEMPLATE.md` 파일을 읽고 그 형식에 맞춰 PR body를 작성하라
   - body 첫 줄에 반드시 `Closes #${issue.number}` 포함
   - "전략비서 체크" 섹션은 기획서 검증 결과를 그대로 반영:
     - 골 정렬: 기획서의 골 정렬 판정 (ALIGNED/SUPPORT/NEUTRAL/MISALIGNED)
     - 무기 품질: 구현 품질 (타입 안전성, 테스트 커버리지, 에러 핸들링)
     - 무효 판정: 기획서의 무효 판정 결과
     - 종합: PROCEED / HOLD / REJECT
   - `gh pr create --title "..." --body "..."` 로 PR 생성
10. **반드시** `git checkout main`을 실행하여 main 브랜치로 복귀하라. PR 생성 후 피처 브랜치에 잔류하면 이후 cron 작업 전체가 장애 난다.
```

### 변경하지 않는 것

- 함수 시그니처, 반환 타입
- 호출 방식 (--print + --dangerously-skip-permissions + stdin)
- `<untrusted-issue>` 보안 블록
- `## 규칙` 섹션
- `## 금지 사항` 섹션

## 작업 계획

| 단계 | 내용 | 완료 기준 |
|------|------|----------|
| 1 | `buildClaudePrompt()` 내 "실행 순서" 텍스트 교체 | 10단계 프롬프트로 변경, 기존 보안 블록 유지 |
| 2 | `buildClaudePrompt` export 추가 + 프롬프트 내용 검증 테스트 추가 | `__tests__/executeIssue.test.ts`에 plan.md 지시, 셀프 리뷰 지시, main 복귀 지시 포함 여부 검증 3건 추가 |

순서 의존성: 단계 1 완료 후 단계 2.

## 리스크

- 프롬프트가 길어져 CLI 컨텍스트 소모 증가 — plan.md 작성이 추가되므로 실행 시간 소폭 증가 가능. 90분 타임아웃 내에서 허용 범위.
- plan.md 생성 실패 시 구현이 멈추는 경우 — 기획서 작성을 "필수 단계"로 지시하므로 CLI가 스킵할 가능성 낮음. 단, 이슈 본문이 매우 빈약할 경우 기획서 품질이 낮을 수 있으나, 이는 기존 구현 품질과 동일한 제약.

## 의사결정 필요

없음 — 바로 구현 가능.
