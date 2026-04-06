# 특이종목 저유동성 노이즈 필터링

## 선행 맥락

없음 — 특이종목 스크리닝 관련 선행 결정 없음.

## 골 정렬

ALIGNED — 특이종목 리포트의 노이즈(거래량 부족 종목, corporate action 왜곡 종목)를 제거하면
에이전트가 실질적인 시장 이벤트에 집중할 수 있다. Phase 2 포착의 정확도 직접 기여.

## 문제

일간 리포트 특이종목 15건 중 11건이 `volRatio 0.1~0.5x`인 저유동성 종목으로 채워지고 있다.
`splitSuspect` 종목(±90%/−60% 극단 수익률)도 플래그만 설정되고 필터링되지 않아
corporate action 노이즈가 섞여 들어온다.

## Before → After

**Before**: `volRatio` 하한 없음 + `splitSuspect` 미필터 → 15건 중 11건이 거래량 부족 노이즈.

**After**: `volRatio >= 1.0` 하한 + `splitSuspect === true` 제외 → 실질적 거래량 동반 이벤트만 잔류.

## 변경 사항

### `src/tools/getUnusualStocks.ts`

1. 상수 추가:
   ```ts
   const MIN_VOL_RATIO = 1.0;
   ```

2. `.filter()` 조건에 두 조건 AND 추가:
   ```ts
   .filter(
     (s) =>
       (s.conditions.length >= MIN_CONDITIONS || s.phase2WithDrop === true) &&
       s.rsScore >= MIN_RS_SCORE &&
       s.volRatio >= MIN_VOL_RATIO &&
       s.splitSuspect === false,
   )
   ```

3. 변경 범위: 상수 1행 추가, filter 조건 2행 추가. 매핑 로직·DB 쿼리·정렬 로직 무변경.

### `src/tools/__tests__/getUnusualStocks.test.ts`

새 describe 블록 `getUnusualStocks — 저유동성/splitSuspect 필터` 추가:

| 케이스 | 입력 | 기대 결과 |
|--------|------|-----------|
| volRatio 0.3 종목 | conditions 2개 충족, rsScore 60, volRatio 0.3 | `stocks` 길이 0 (탈락) |
| volRatio 정확히 1.0 종목 | conditions 2개 충족, rsScore 60, volRatio 1.0 | `stocks` 길이 1 (경계값 포함) |
| volRatio 2.5 종목 | conditions 2개 충족, rsScore 60, volRatio 2.5 | `stocks` 길이 1 (통과) |
| splitSuspect=true 종목 | daily_return +0.95, phase2WithDrop=true | `stocks` 길이 0 (탈락) |
| splitSuspect=false 종목 | daily_return +0.08, conditions 2개 충족 | `stocks` 길이 1 (통과) |
| phase2WithDrop=true + volRatio 0.5 | volRatio 낮음, splitSuspect=false | `stocks` 길이 0 (volRatio 탈락) |

기존 테스트 케이스 중 `vol_ratio: "1.5"` 사용 케이스 검토:
- `phase2WithDrop=true이고 conditions가 1개뿐이어도 필터를 통과한다` — `vol_ratio: "1.5"` → 새 MIN_VOL_RATIO(1.0) 통과. 기존 테스트 기대값 유지.
- `phase2WithDrop=false이고 conditions가 1개뿐이면 필터에서 제외된다` — 이미 탈락. 영향 없음.

## 작업 계획

| 단계 | 작업 | 에이전트 | 완료 기준 |
|------|------|---------|-----------|
| 1 | `getUnusualStocks.ts` 수정 — 상수 추가 + filter AND 조건 2개 삽입 | 구현 에이전트 | 파일 변경 완료, 타입 에러 없음 |
| 2 | `getUnusualStocks.test.ts` 수정 — 새 describe 블록 6개 케이스 추가 | 구현 에이전트 | 단계 1과 병렬 불가 (구현 확인 후 작성) |
| 3 | `yarn test src/tools/__tests__/getUnusualStocks.test.ts` 실행 | 구현 에이전트 | 전체 통과, 기존 케이스 깨지지 않음 |

## 리스크

- **volRatio 1.0 기준 근거**: 이슈 #652에서 CEO가 명시. 다른 수치(예: 0.8)를 사용할 경우 다른 스크리닝 도구와의 일관성 검토 필요하나, 현재로선 CEO 명시값 그대로 사용.
- **phase2WithDrop 우회 경로**: `phase2WithDrop=true`인 종목도 새 필터(volRatio, splitSuspect)를 통과해야 한다. 우회 로직 없이 AND 조건으로 일괄 적용. Phase 2 급락이 저유동성에서 발생한 것이라면 노이즈로 간주하는 것이 올바른 판단.
- **기존 테스트 케이스 충돌 없음**: `vol_ratio: "1.5"` 사용 케이스 모두 MIN_VOL_RATIO(1.0) 초과. 기존 테스트 수정 불필요.

## 의사결정 필요

없음 — 바로 구현 가능.
