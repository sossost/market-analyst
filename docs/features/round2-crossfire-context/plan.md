# Plan: Round 2 교차검증에 조기포착/펀더멘탈 context 전달

**이슈**: #428
**트랙**: Lite (버그성 누락 수정)
**날짜**: 2026-03-25

## 문제 정의

Round 1에는 `earlyDetectionContext`와 `fundamentalContext`가 주입되지만, Round 2 교차검증에는 둘 다 전달되지 않는다. 이로 인해 전문가들이 서로의 조기포착 후보 평가를 실적 데이터 기반으로 반박/보완할 수 없다.

## 골 정렬

**ALIGNED** — Phase 2 주도섹터/주도주 초입 포착 목표와 직결. 교차검증에서 펀더멘탈 기반 반론이 가능해야 추천 종목의 Phase 2→3 전환(avg loss -15%)을 줄일 수 있다.

## 무효 판정

해당 없음. LLM 백테스트, 시뮬레이션 등 무효 패턴에 해당하지 않는다. 순수 데이터 파이프라인 수정.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| Round 2 `earlyDetectionContext` | 미전달 | 전달 |
| Round 2 `fundamentalContext` | 미전달 | 전달 |
| `buildCrossfirePrompt`에 펀더멘탈/조기포착 섹션 | 없음 | 조건부 포함 |
| 교차검증 시 펀더멘탈 기반 반박 | 불가 | 가능 |

## 변경 사항

### 1. `src/debate/round2-crossfire.ts`

- `Round2Input` 인터페이스에 `fundamentalContext?: string`, `earlyDetectionContext?: string` 추가
- `buildCrossfirePrompt`에 두 파라미터 추가, 프롬프트 하단에 조건부 섹션 생성
- `runRound2` 함수에서 두 값을 `buildCrossfirePrompt`에 전달

### 2. `src/debate/debateEngine.ts`

- `runRound2` 호출 시 `fundamentalContext`, `earlyDetectionContext` 전달

### 3. `src/debate/__tests__/round2-crossfire.test.ts` (신규)

- `buildCrossfirePrompt`에 fundamentalContext/earlyDetectionContext 주입 여부 테스트
- 빈 값일 때 섹션 미포함 확인
- `runRound2`에 context 전달 확인

## 리스크

- **토큰 증가**: Round 2에 fundamentalContext + earlyDetectionContext 추가로 토큰 소비 증가. 단, Round 1에도 동일 데이터를 주입하고 있으므로 허용 범위.
- **프롬프트 길이**: 기존 교차검증 프롬프트에 섹션 추가. 데이터가 없으면 추가 안 되므로 영향 최소.
