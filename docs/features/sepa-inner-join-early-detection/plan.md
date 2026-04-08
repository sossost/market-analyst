# Plan: Phase1Late·RisingRS SEPA INNER JOIN → LEFT JOIN 전환

## 문제 정의

`findPhase1LateStocks`와 `findRisingRsStocks`가 `fundamental_scores`에 **INNER JOIN** + `grade IN ('S','A','B')` 필터를 적용하여, SEPA 점수가 없거나 낮은 초기 모멘텀 종목을 구조적으로 차단한다. 조기포착 도구의 목적("시장이 아직 주목하지 않는 초기 모멘텀")과 정면 충돌.

## 골 정렬

- **ALIGNED**: 조기포착 후보군 확대 → 주도주 발굴 성공률 향상 → 프로젝트 핵심 목표 직결
- **무효 판정**: PASS — watchlistGate에서 SEPA를 별도로 검증하므로 '발견은 넓게, 등록은 엄격하게' 2단계 구조 유지

## Before → After

| 함수 | Before | After |
|------|--------|-------|
| `findPhase1LateStocks` | INNER JOIN + `grade IN ('S','A','B')` | LEFT JOIN + 필터 제거 + `sepa_grade` SELECT |
| `findRisingRsStocks` | INNER JOIN + `grade IN ('S','A','B')` | LEFT JOIN + 필터 제거 |
| `findPhase2Stocks` | LEFT JOIN (이미 정상) | 변경 없음 |

## 변경 사항

### 1. `stockPhaseRepository.ts` — `findRisingRsStocks` (L315)
- `JOIN latest_scores fs` → `LEFT JOIN latest_scores fs`
- `AND fs.grade IN ('S', 'A', 'B')` 제거

### 2. `stockPhaseRepository.ts` — `findPhase1LateStocks` (L368)
- `JOIN latest_scores fs` → `LEFT JOIN latest_scores fs`
- `AND fs.grade IN ('S', 'A', 'B')` 제거
- SELECT에 `fs.grade AS sepa_grade` 추가

### 3. `types.ts` — `Phase1LateStockRow`
- `sepa_grade: string | null` 필드 추가

### 4. `getPhase1LateStocks.ts` — 반환 매핑
- `sepaGrade: r.sepa_grade` 추가

### 5. 테스트 업데이트
- `getPhase1LateStocks.test.ts`: SEPA INNER JOIN 테스트 → LEFT JOIN 검증으로 전환 + sepaGrade 매핑 테스트
- `getRisingRS.test.ts`: SEPA INNER JOIN 테스트 → LEFT JOIN 검증으로 전환

## 영향 없는 영역 (확인 완료)

- `findPhase2Stocks`: 이미 LEFT JOIN — 변경 불필요
- `earlyDetectionLoader`: Phase1Late/RisingRs 결과를 symbol/sector만 매핑 — sepa_grade 미참조
- `run-weekly-agent.ts`: Phase2 데이터의 sepaGrade 사용 — 이 변경과 무관
- `watchlistGate`: 별도 레이어에서 SEPA 검증 — 구조 유지

## 리스크

1. **결과 폭증**: SEPA 필터 제거로 후보군 증가 가능 — 기존 LIMIT 파라미터가 제어. 추가 조치 불필요.
2. **earlyDetectionLoader 정합성**: Phase1Late 매핑이 sepa_grade를 참조하지 않으므로 영향 없음.

## 작업 순서

1. `types.ts` — Phase1LateStockRow에 sepa_grade 추가
2. `stockPhaseRepository.ts` — 두 함수 SQL 수정
3. `getPhase1LateStocks.ts` — sepaGrade 매핑 추가
4. 테스트 업데이트
5. 전체 테스트 실행
