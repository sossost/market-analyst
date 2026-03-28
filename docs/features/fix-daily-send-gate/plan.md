# fix: 일간 리포트 send gate 제거

## 선행 맥락

- **#162**: 투자 브리핑 시절 `evaluateDailySendGate` 최초 추가. 6개 OR 조건 미충족 시 간소 발송으로 fallback.
- **#390 (F11, 인사이트 브리핑 전환)**: 리포트 체계 전환. 이 시점에 send gate를 제거했어야 하나 누락됨.
- **3/28 첫 SKIP 발생**: 게이트가 작동하여 일간 리포트가 3줄짜리 간소 리포트로 발송됨. 실제 피해 확인.

## 골 정렬

ALIGNED — send gate 제거는 "매일 Phase 2 초입 신호를 빠짐없이 보고"하는 핵심 목표에 직결. 조용한 날도 thesis 추적/Phase 분포/관심종목 모니터링이 필요하다. 게이트는 알파 형성의 신뢰성을 훼손한다.

## 문제

`run-daily-agent.ts`에 `evaluateDailySendGate()`가 잔존하여, 6개 OR 조건을 모두 미충족하면 풀 인사이트 브리핑 대신 간소 발송(`sendMarketTempOnly`)으로 조기 종료된다. 이 게이트는 #162(투자 브리핑 시절)에 추가됐고, #390(인사이트 브리핑 전환) 때 제거됐어야 하나 누락된 데드코드다.

## Before → After

**Before**: `run-daily-agent.ts` L179-191에서 SKIP_DAILY_GATE 환경변수 또는 게이트 통과 여부에 따라 분기. SKIP 시 `sendMarketTempOnly` → 조기 return. 조용한 장세에서 매일 발송 리포트가 간소 버전으로 대체될 수 있음.

**After**: 분기 없음. `targetDate`가 영업일이면 항상 풀 인사이트 브리핑 생성 및 발송. 간소 발송 경로 자체가 존재하지 않음.

## 변경 사항

### 삭제 대상 파일 (2개)

| 파일 | 판단 근거 |
|------|----------|
| `src/agent/dailySendGate.ts` | `run-daily-agent.ts`에서만 import. 다른 소비자 없음. |
| `src/agent/marketTempBlock.ts` | `run-daily-agent.ts`(via `sendMarketTempOnly`)와 `__tests__/agent/marketTempBlock.test.ts`에서만 사용. 프로덕션 소비자가 이 함수 하나뿐이며, 해당 함수도 삭제 대상. |

### 삭제 대상 테스트 파일 (2개)

| 파일 | 판단 근거 |
|------|----------|
| `__tests__/agent/dailySendGate.test.ts` | 삭제되는 `dailySendGate.ts`에 대한 테스트. |
| `src/agent/__tests__/marketTempBlock.test.ts` | 경로 확인 결과 `src/__tests__/agent/marketTempBlock.test.ts`. 삭제되는 `marketTempBlock.ts`에 대한 테스트. |

### `run-daily-agent.ts` 수정 (1개)

**제거 대상 코드:**
- L37: `import { evaluateDailySendGate } from "./dailySendGate";`
- L39: `import { buildMarketTempBlock } from "./marketTempBlock";`
- L179-191: `SKIP_DAILY_GATE` 환경변수 체크 + `evaluateDailySendGate()` 호출 + `sendMarketTempOnly()` 호출 분기 전체
- L323-332: `sendMarketTempOnly` private 함수 정의

### Repository 함수 처리 (유지)

소비자 grep 결과, 아래 5개 함수는 `dailySendGate.ts`만이 소비자다:

| 함수 | 정의 위치 | 다른 소비자 |
|------|----------|------------|
| `findSectorsWithPhaseTransition` | `sectorRepository.ts` | 없음 |
| `findRsNewEntrants` | `sectorRepository.ts` | 없음 |
| `findPhase1to2SurgeSectors` | `sectorRepository.ts` | 없음 |
| `findRecentRegimes` | `sectorRepository.ts` | 없음 |
| `countUnusualPhaseStocks` | `stockPhaseRepository.ts` | 없음 |

단, repository 함수는 별도의 유용한 데이터 접근자로 향후 재사용될 가능성이 있다. 이번 작업 범위에서는 **유지**한다. 데드코드 정리가 필요하면 별도 이슈로 분리한다.

`findActiveWatchlist`는 `getWatchlistStatus.ts`, `watchlistTracker.ts` 등 다수의 다른 소비자가 있으므로 건드리지 않는다.

## 작업 계획

### Step 1 — `run-daily-agent.ts` 수정
**담당**: 구현팀
**작업**: import 2개 제거, L179-191 분기 블록 제거, L323-332 `sendMarketTempOnly` 함수 제거
**완료 기준**: TypeScript 컴파일 오류 없음, `dailySendGate`·`marketTempBlock` 참조 0건

### Step 2 — 파일 삭제 4개
**담당**: 구현팀
**작업**:
1. `src/agent/dailySendGate.ts` 삭제
2. `src/agent/marketTempBlock.ts` 삭제
3. `__tests__/agent/dailySendGate.test.ts` 삭제
4. `src/__tests__/agent/marketTempBlock.test.ts` 삭제

**완료 기준**: `git status`에서 4개 파일 `deleted` 상태 확인

### Step 3 — 빌드 + 테스트 검증
**담당**: 구현팀
**작업**: `yarn build` 성공, `yarn test` 전체 통과 확인
**완료 기준**: 컴파일 에러 0, 테스트 실패 0

## 리스크

- **없음**: repository 함수는 유지하므로 DB 쿼리 레이어에 변경 없음. 삭제 대상은 모두 단방향 소비(send gate → repository)라 역방향 의존성이 없다.
- **환경변수 `SKIP_DAILY_GATE`**: 맥미니 launchd plist에 이 환경변수가 설정돼 있을 가능성 낮지만, 삭제 후 영향 없음(분기 자체가 사라지므로).

## 의사결정 필요

없음 — 바로 구현 가능
