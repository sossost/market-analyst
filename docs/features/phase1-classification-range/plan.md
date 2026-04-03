# Plan: Phase 1 분류 범위 과소 수정

> Lite 트랙 — 단순 로직 수정, 의사결정 불필요

## 문제 정의

`phase-detection.ts`의 Phase 1 판정이 base-building 종목을 누락한다:

1. **임계값 과소**: `MA150_FLAT_THRESHOLD = 0.02` (±2%)가 너무 좁아, MA150 기울기 -3~-5%인 base-building 종목이 flat으로 인식되지 않음
2. **판정 순서 구조적 문제**: Phase 3 distribution 체크(`!priceAboveMa150 && ma150AboveMa200`)가 Phase 1보다 선행 — 가격이 MA150 아래이면서 MA150 > MA200인 종목은 기울기가 flat이든 아니든 무조건 Phase 3으로 분류되어 Phase 1 체크에 도달 불가

## 골 정렬

**ALIGNED** — Phase 2 초입 포착이 프로젝트 핵심 골. Phase 1(축적기) 모집단이 좁으면 "Phase 1 → Phase 2 전환" 감지 후보군 자체가 줄어듦. 전략 브리핑에서도 "Phase 1 분류 범위 과소"를 미해결 전략 이슈 상위 3건으로 지목.

## 무효 판정

**VALID** — slope ±2%는 실제 시장 데이터 기준으로 과소. Minervini/O'Neil 프레임워크에서 Stage 1 base 후반부(기울기 -3~-5%)는 Phase 2 진입 2-4주 전 시점으로, 정확히 포착 대상.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| `MA150_FLAT_THRESHOLD` | 0.02 (±2%) | 0.05 (±5%) |
| Phase 3 distribution 체크 | `!priceAboveMa150 && ma150AboveMa200` → 무조건 Phase 3 | slope near-flat + price near MA150인 경우 Phase 1 후보로 통과 |
| `priceNearMa150` 계산 위치 | Phase 1 블록 직전 (line 139) | Phase 3 체크 이전으로 이동 |

### 예시: MA150 기울기 -3%, 가격이 MA150 근처, MA150 > MA200인 종목

- **Before**: Phase 3 distribution 체크에 걸려 Phase 1 도달 불가 → Phase 3
- **After**: slope near-flat(|-3%| < 5%) + price near MA150 → Phase 3 예외 → Phase 1 체크 통과 → Phase 1

### 안전장치: 진짜 distribution은 여전히 Phase 3

- 급격한 하락(slope < -5%): slopeFlat = false → Phase 3 예외 미적용
- 가격이 MA150에서 먼 경우(>5%): priceNearMa150 = false → Phase 3 예외 미적용

## 변경 사항

### `src/lib/phase-detection.ts`

1. `MA150_FLAT_THRESHOLD`: `0.02` → `0.05`
2. `priceNearMa150` 계산을 Phase 3 체크 이전으로 이동
3. Phase 3 distribution 분기에 Phase 1 예외 조건 추가:
   ```
   if (!priceAboveMa150 && ma150AboveMa200 && !(slopeFlat && priceNearMa150))
   ```

### `__tests__/lib/phase-detection.test.ts`

1. 기존 Phase 3 distribution guard 테스트 2건 → Phase 1으로 기대값 변경 (slope flat + price near MA150 + MA150 > MA200 → 이제 Phase 1)
2. 새 테스트 추가:
   - steep slope(-8%) + MA150 > MA200 → 여전히 Phase 3 (진짜 distribution)
   - price far below MA150(>5%) + MA150 > MA200 → 여전히 Phase 3
   - slope -3~-4% + price near MA150 + MA150 > MA200 → Phase 1 (핵심 수정 케이스)

## 작업 계획

1. `phase-detection.ts` 수정 (상수, 변수 위치, 조건 분기)
2. `phase-detection.test.ts` 수정 (기존 테스트 업데이트 + 신규 테스트)
3. 테스트 실행 및 커버리지 확인
4. 코드 셀프 리뷰

## 리스크

- **Phase 1 모집단 급증 가능**: ±5%로 확대하면 Phase 1 비율 증가. 다음 ETL 실행 후 `stock_phases` 테이블에서 Phase별 카운트 비교 권장
- **Issue #328과의 충돌**: #328에서 추가한 Phase 3 distribution guard를 부분적으로 완화. 단, slope near-flat + price near MA150인 경우만 예외 처리하므로, 진짜 distribution(급격 하락, 가격 MA150에서 먼 경우)은 여전히 Phase 3으로 정확 분류
- `PRICE_NEAR_MA150_THRESHOLD`(5%)는 변경하지 않음 — 기울기 임계값만 확대
