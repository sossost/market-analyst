# Plan: Fundamental Acceleration ↔ SEPA 등급 정합성

## 문제 정의

두 시스템이 동일 종목에 상반된 평가를 내린다:
- `isAccelerating()`: EPS YoY > 0 + 3분기 monotonic increase → "가속" 판정. **최소 성장 허들 없음**.
- SEPA Scorer: EPS >25% AND Revenue >25% 필수. 미충족 시 Grade C/F.

결과: EPS 5%→8%→12%인 종목이 "가속 O + SEPA F"로 토론엔진에 모순 신호 투입.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| `isAccelerating` 최소 허들 | `> 0` (사실상 없음) | `>= 15%` (의미 있는 성장만 가속 인정) |
| earlyDetection 가속 출력 | SEPA 등급 정보 없음 | SEPA 등급 병기 + F등급 필터링 |
| 토론엔진 모순 | 가속 O + SEPA F 동시 수신 가능 | F등급 종목은 가속 리스트에서 제외 |

## 변경 사항

### P1: isAccelerating 최소 허들 추가
- **파일**: `src/tools/getFundamentalAcceleration.ts`
- **변경**: `isAccelerating()`에 `MIN_ACCELERATION_GROWTH = 15` 허들 추가. `latest.yoyGrowth >= 15` 조건 추가.
- **근거**: SEPA 필수 기준 25%의 60% 수준. 가속 패턴 + 일정 규모 이상 성장 동시 요구. Minervini의 "가속" 개념은 의미 있는 성장률 위에서의 가속을 전제.

### P2: earlyDetectionLoader에 SEPA 등급 병기 + F등급 필터링
- **파일**: `src/debate/earlyDetectionLoader.ts`
- **변경**:
  1. `AcceleratingStock` 인터페이스에 `sepaGrade` 필드 추가
  2. `loadAccelerating()`에서 가속 종목의 SEPA 등급을 `scoreFundamentals`로 계산
  3. SEPA F등급 종목은 가속 리스트에서 제외
  4. `formatEarlyDetectionContext()`에서 SEPA 등급 표시
- **비용**: `findFundamentalAcceleration()`에서 이미 로드한 quarters 데이터를 `scoreFundamentals` 입력으로 변환하여 재활용. 추가 DB 쿼리 없음.

### 스코프 외 (후속 이슈로)
- P3: turnaround 고정 점수 200 검토
- P4: ROE 데이터 확보

## 작업 계획

1. `isAccelerating()` 허들 추가 + 테스트 업데이트
2. `earlyDetectionLoader`에 SEPA 등급 연동 + F등급 필터링
3. `formatEarlyDetectionContext()`에 SEPA 등급 컬럼 추가
4. earlyDetectionLoader 테스트 작성
5. 전체 테스트 + 타입 체크 통과 확인

## 리스크

- **허들 15% 선정**: Minervini 원전에서 25% 이상이 "진정한 리더" 기준. 15%는 가속 패턴의 noise 필터 목적이므로 충분히 보수적.
- **quarters 데이터 변환**: `FundamentalAccelerationRow` → `QuarterlyData` 변환 시 필드 매핑 정확성 확인 필요.
- **기존 가속 종목 수 감소**: 의도된 변경. noise 제거가 목적.

## 골 정렬

- **ALIGNED**: 토론엔진 thesis 품질 향상 → short_term_outlook 적중률 개선 직결
- **무효 판정**: 해당 없음 (기존 시스템 버그 수정, 새 기능 아님)
