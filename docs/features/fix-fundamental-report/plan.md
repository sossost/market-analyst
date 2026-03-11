# fix-fundamental-report

## 선행 맥락

- 펀더멘탈 검증 시스템 (F7) 완료 — `runFundamentalValidation.ts`, `loadExistingScores()`, `canSkipScoring()` 이미 구현됨
- 리포트 사후 검증 파이프라인 완비 (PR #180) — 발행된 리포트를 `validate-fundamental-report.sh`로 자동 감사
- 사후 검증 시스템이 "리포트 미발행"을 캐치하지 못하는 구조임 — 발행 자체가 안 되므로 검증 대상 파일이 없음
- 관련 GitHub 이슈: **#189**

## 골 정렬

**SUPPORT** — 주도주 발굴 파이프라인의 핵심 산출물(S등급 리포트)이 주간 단위로 발행되지 않는 버그 수정. 직접 알파 기여는 아니지만, S등급 리포트는 매주 Discord로 발송되는 투자 판단 인풋이므로 빈 출력은 운영 품질 저하에 해당.

## 문제

`canSkipScoring()`이 true를 반환할 때 `loadExistingScores()`를 즉시 반환하여 6단계(LLM 분석)와 7단계(리포트 발행)를 통째로 건너뜀. 스코어 재계산 스킵은 의도된 최적화이나, S등급 리포트는 매주 새로 발행해야 하는 주간 산출물임.

## Before → After

**Before**: `canSkipScoring()` true → `loadExistingScores()` early return → `reportsPublished: []` → S등급 Discord 리포트 미발행

**After**: `canSkipScoring()` true → DB에서 스코어 로드 → S등급 종목만 LLM 분석 재실행 → 리포트 발행 → `reportsPublished: [symbols...]` 반환

## 설계 판단

### LLM 분석(analyzeFundamentals) 재실행 필요 여부

스코어가 동일해도 narrative(LLM 서사)는 DB에 저장되지 않고 메모리에만 존재. `loadExistingScores()`는 `FundamentalScore[]`만 반환하며 narrative를 포함하지 않음.

따라서 canSkip 경로에서도 S등급에 한해 LLM 분석을 재실행해야 함. S등급은 통상 2~4개 수준이므로 토큰 소모 미미.

### 리팩토링 방향

`runFundamentalValidation()` 내부를 세 단계로 분리:
1. **스코어 획득** — 재계산 or DB 로드 (canSkip 분기)
2. **S등급 LLM 분석 + 리포트 발행** — 항상 실행 (skipPublish 옵션 반영)
3. **결과 반환**

canSkip 분기는 스코어 획득 단계에만 영향을 주고, 이후 단계는 공통 경로로 흐름.

## 변경 사항

### `src/agent/fundamental/runFundamentalValidation.ts`

1. `canSkipScoring()` true 블록에서 early return 제거
2. 스코어를 로컬 변수 `scores`에 할당하는 분기로 변경
3. 6~7단계(LLM 분석, 리포트 발행)는 공통 경로로 이동 — canSkip 여부와 무관하게 실행
4. canSkip 시 `loadFundamentalData()`를 S등급 종목에 한해 선택적 로드 (LLM 분석에 `input` 필요)

### `__tests__/agent/fundamental/runFundamentalValidation.test.ts` (신규)

- `canSkipScoring` true 시 S등급 리포트가 발행되는지 검증
- `canSkipScoring` false 시 기존 전체 흐름 유지 검증
- `skipPublish: true` 옵션이 canSkip 경로에서도 동작하는지 검증

## 작업 계획

### 단계 1 — 구현 [backend-engineer]
- `runFundamentalValidation.ts` 리팩토링
  - early return 제거 및 scores 획득 분기 재구성
  - canSkip 시 S등급 심볼 기반으로 `loadFundamentalData()` 선택적 호출
  - 6~7단계 공통 경로 확보
- 완료 기준: `reportsPublished`가 canSkip 경로에서도 S등급 심볼을 포함하여 반환

### 단계 2 — 테스트 [backend-engineer]
- `__tests__/agent/fundamental/runFundamentalValidation.test.ts` 신규 작성
  - DB/LLM 의존성 모킹
  - canSkip true 시나리오: reportsPublished에 S등급 심볼 존재 확인
  - canSkip false 시나리오: 기존 동작 보장
  - skipPublish 옵션 우선 적용 확인
- 완료 기준: 신규 테스트 통과, 기존 테스트 회귀 없음

## 리스크

- **`loadFundamentalData()` 추가 호출 비용**: canSkip 시 전체 종목 대신 S등급 종목만 로드 — 수십 개 쿼리로 제한되어 무시 가능
- **S등급 0개인 경우**: 정상 처리 — sGradeScores 빈 배열이면 LLM 분석 루프 미진입, reportsPublished: [] 반환
- **기존 `symbols` 옵션 동작**: `options.symbols != null`이면 canSkip 자체를 건너뛰므로 영향 없음

## 의사결정 필요

없음 — 바로 구현 가능
