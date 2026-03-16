# 학습 루프 Cold Start 해결

이슈: #268

## 선행 맥락

**`docs/features/failure-pattern-accumulation/spec.md` (PR #82, #84):**
- failure_patterns 테이블과 caution 카테고리 학습 경로가 이미 구현됨
- `promote-learnings.ts`에 `promoteFailurePatterns()` 함수 존재 — failure_patterns에서 caution 학습 승격

**`docs/features/recursive-improvement-reliability/spec.md`:**
- 승격 기준이 MIN_HITS=10, MIN_HIT_RATE=0.70, MIN_TOTAL=10으로 상향됨 (이전 3회에서)
- 정량 검증 엔진(`quantitativeVerifier.ts`) 도입 완료
- `theses.verification_method` 컬럼 추가 완료

**현재 코드 분석:**
- `promote-learnings.ts`: MIN_HITS_FOR_PROMOTION=10, MIN_HIT_RATE=0.70, MIN_TOTAL_OBSERVATIONS=10
- `expireStaleTheses()`: ACTIVE thesis 중 timeframeDays 초과 시 EXPIRED 처리 (검증 결과 없이 종료)
- `verifyTheses()`: 매일 debate 실행 시에만 호출. debate가 안 돌아간 날에는 검증도 없음
- `run-debate-agent.ts` 순서: expireStaleTheses (2.5단계) → verifyTheses (3단계) — **만료가 검증보다 먼저 실행되어, timeframe 초과 thesis가 검증 기회 없이 EXPIRED 처리됨**

**이슈 #268 데이터:**
- `agent_learnings` 0건 (시스템 가동 이래 학습 없음)
- CONFIRMED thesis 6건뿐
- 미검증 thesis 31건 (verification_result = NULL, status = ACTIVE)
- 동일 persona+metric 그룹에 10건 모이는 것은 현재 데이터 규모에서 구조적으로 불가능

## 골 정렬

**ALIGNED** — 직접 기여.

학습 루프는 과거 분석의 성공/실패에서 패턴을 추출하여 향후 분석 정확도를 높이는 핵심 메커니즘이다. 학습이 0건이라는 것은 시스템이 경험에서 전혀 배우지 못한다는 뜻이며, Phase 2 초입 포착의 정밀도 향상이 구조적으로 불가능한 상태다. 이 문제를 해결해야 학습 기반 분석 고도화가 시작된다.

### 무효 판정 체크
- LLM 백테스트? 아니다. 실제 운영 데이터 기반 학습 파이프라인 수리.
- 같은 LLM 생성+검증 루프? 아니다. 승격 기준과 검증 파이프라인의 구조적 병목 해결.
- 이미 실패한 접근? 아니다. 최초 시도.

## 문제

시스템이 운영 이래 단 한 건의 학습도 축적하지 못했다. 원인은 3가지:

1. **검증 파이프라인 누수**: 만료 처리가 검증보다 먼저 실행되어, timeframe 초과 thesis가 검증 기회 없이 EXPIRED 처리됨. EXPIRED thesis는 CONFIRMED도 INVALIDATED도 아니므로 학습에 기여하지 않는 사각지대.
2. **승격 조건의 구조적 불가능**: 동일 persona+metric 그룹에 10건의 CONFIRMED가 필요한데, 전체 CONFIRMED가 6건인 상황에서 이 조건은 달성 불가능.
3. **failure_patterns 경로의 미활용**: caution 카테고리 학습 경로가 구현되어 있으나, 상류 데이터(signal_log의 phase2Reverted)가 축적되어야 작동. 현재 이 데이터의 축적 상태 미확인.

## Before → After

**Before**
- `agent_learnings` 0건. 학습 루프 완전 정지.
- timeframe 초과 thesis가 검증 없이 EXPIRED → 데이터 낭비
- 승격 조건 MIN_HITS=10이 cold start 상황에서 달성 불가능
- 시스템이 과거 경험에서 배우지 못함

**After**
- timeframe 초과 thesis가 만료 전 최종 검증 기회를 가짐 → CONFIRMED/INVALIDATED 데이터 증가
- cold start 기간 완화된 승격 조건으로 초기 학습 축적 시작
- 학습 건수가 임계치 도달 시 자동으로 정상 기준 복귀
- failure_patterns 경로 점검 및 활성화

## 변경 사항

### 1. 검증-만료 순서 역전 (`run-debate-agent.ts`)

**현재 순서 (버그)**:
```
2.5단계: expireStaleTheses() → timeframe 초과 thesis를 EXPIRED 처리
3단계: verifyTheses() → ACTIVE thesis만 검증
```

**변경 순서**:
```
2.5단계: verifyTheses() → ACTIVE thesis 검증 (timeframe 초과 포함)
2.6단계: expireStaleTheses() → 검증 후에도 HOLD인 timeframe 초과 thesis만 EXPIRED 처리
```

이렇게 하면 timeframe 초과 thesis도 만료 전 마지막 검증 기회를 가진다. 이미 targetCondition을 충족했거나 명백히 무효화된 thesis는 CONFIRMED/INVALIDATED로 전환되고, 판단 불가한 것만 EXPIRED로 처리된다.

### 2. Cold Start 승격 조건 완화 (`promote-learnings.ts`)

graduated threshold 도입 — 전체 학습 건수에 따라 승격 기준이 자동 조정:

```typescript
// 현재 활성 학습 수에 따라 승격 기준 결정
function getPromotionThresholds(activeLearningCount: number) {
  // Cold start: 학습 0~4건 → 완화 기준
  if (activeLearningCount < 5) {
    return { minHits: 3, minHitRate: 0.60, minTotal: 5 };
  }
  // 성장기: 학습 5~14건 → 중간 기준
  if (activeLearningCount < 15) {
    return { minHits: 5, minHitRate: 0.65, minTotal: 8 };
  }
  // 정상 운영: 학습 15건+ → 현재 기준 유지
  return { minHits: 10, minHitRate: 0.70, minTotal: 10 };
}
```

graduated threshold를 선택한 이유:
- 고정된 완화 기준(예: 항상 3/5)은 데이터가 충분해져도 느슨한 학습이 계속 승격됨
- graduated는 학습이 축적될수록 자동으로 기준이 엄격해지므로, cold start 해결과 장기 품질 유지를 동시에 달성
- 상수 3개(5/15 경계, 각 단계별 기준)만 관리하면 되어 복잡도가 낮음

binomialTest는 모든 단계에서 유지 — 통계적 유의성 검증은 cold start에서도 타협하지 않음.

### 3. EXPIRED thesis 최종 판정 시도 (`thesisVerifier.ts` 또는 별도 함수)

`expireStaleTheses` 대신, timeframe 초과 thesis에 대해 최종 판정을 시도하는 로직:

```
1. ACTIVE thesis 중 timeframe 초과 항목 식별
2. 각 thesis에 대해 tryQuantitativeVerification() 시도
3. 정량 판정 가능 → CONFIRMED/INVALIDATED 처리
4. 정량 판정 불가 → EXPIRED 처리 (기존과 동일)
```

LLM 검증은 사용하지 않는다 — timeframe 초과 thesis에 LLM 비용을 투입하는 것은 비효율적이며, 정량 판정 가능한 것만 구제하는 것이 합리적이다.

### 4. failure_patterns 경로 점검

`collect-failure-patterns.ts`의 상류 데이터 확인:
- `signal_log`에 `phase2_reverted` 데이터가 있는지 DB 조회
- 데이터가 있으면: `etl:failure-patterns` → `etl:promote-learnings` 순서로 실행하여 caution 학습 생성
- 데이터가 없으면: 이 경로는 아직 활성화 불가, 별도 추적 필요

이 태스크는 코드 변경이 아닌 운영 점검이다.

## 작업 계획

### 태스크 1 — 검증-만료 순서 역전 + 만료 전 정량 판정 [실행팀]

**변경 파일:**
- `src/agent/run-debate-agent.ts`: verifyTheses와 expireStaleTheses 호출 순서 역전
- `src/agent/debate/thesisStore.ts`: `expireStaleTheses`에 정량 판정 시도 로직 추가 (또는 별도 `tryResolveBeforeExpiry` 함수)

**완료 기준:**
- timeframe 초과 thesis가 만료 전 정량 검증을 시도함
- 정량 판정 성공 시 CONFIRMED/INVALIDATED, 실패 시 EXPIRED
- 기존 테스트 통과 + 신규 테스트: timeframe 초과 + 정량 판정 가능 thesis → CONFIRMED/INVALIDATED
- 기존 debate 흐름에 부작용 없음

**의존성:** 없음

### 태스크 2 — graduated 승격 기준 도입 [실행팀]

**변경 파일:**
- `src/etl/jobs/promote-learnings.ts`: `getPromotionThresholds()` 함수 추가, `buildPromotionCandidates` 필터에 동적 기준 적용

**완료 기준:**
- 학습 0건 → minHits=3, minHitRate=0.60, minTotal=5 적용
- 학습 15건+ → minHits=10, minHitRate=0.70, minTotal=10 적용 (현재와 동일)
- binomialTest는 모든 단계에서 유지
- 기존 `buildPromotionCandidates` 테스트 수정 + graduated threshold 테스트 추가

**의존성:** 없음 (태스크 1과 병렬 가능)

### 태스크 3 — failure_patterns 경로 점검 [실행팀]

**작업:**
- DB 조회: `signal_log`에서 `phase2_reverted IS NOT NULL` 건수 확인
- 데이터가 있으면: `yarn etl:failure-patterns` 실행 → `failure_patterns` 테이블 확인 → `yarn etl:promote-learnings` 실행 → caution 학습 생성 확인
- 결과를 로그로 기록

**완료 기준:**
- failure_patterns 경로의 현재 상태가 문서화됨
- 활용 가능한 데이터가 있으면 caution 학습 생성 확인

**의존성:** 없음 (태스크 1, 2와 병렬 가능)

### 태스크 4 — 테스트 + 코드 리뷰 [검증팀]

**변경 파일:**
- `src/agent/debate/__tests__/thesisStore.test.ts` (또는 신규): 만료 전 정량 판정 테스트
- `src/etl/jobs/__tests__/promote-learnings.test.ts`: graduated threshold 테스트
- 통합 테스트: debate 실행 시 검증→만료 순서 확인

**완료 기준:**
- 전체 테스트 통과
- 커버리지 80%+ 유지
- 코드 리뷰 CRITICAL/HIGH 이슈 없음

**의존성:** 태스크 1, 2 완료 후

## 병렬 실행 계획

```
태스크 1 (검증-만료 순서 역전)  ──┐
태스크 2 (graduated 승격 기준)  ──├── 태스크 4 (테스트 + 리뷰)
태스크 3 (failure_patterns 점검) ─┘
```

태스크 1, 2, 3은 독립적이므로 병렬 실행. 태스크 4는 전체 완료 후.

## 리스크

1. **graduated threshold의 초기 학습 품질**: cold start 완화 기준(3회 적중, 60%)이 노이즈를 학습으로 승격할 수 있다. 완화: binomialTest 유지 + 학습 만료 6개월 규칙으로 자연 도태. 학습이 15건 이상 축적되면 자동으로 엄격 기준 복귀.

2. **검증-만료 순서 변경의 부작용**: verifyTheses가 expireStaleTheses보다 먼저 실행되면, timeframe 초과 thesis에 대한 LLM 검증 비용이 추가 발생할 수 있다. 완화: timeframe 초과 thesis는 정량 판정만 시도, LLM 비용 미발생.

3. **EXPIRED → CONFIRMED/INVALIDATED 전환율 불확실**: timeframe 초과 thesis 중 정량 판정 가능한 비율이 낮을 수 있다 (targetCondition이 정량적이지 않은 경우). 이 경우 태스크 1의 효과가 제한적이며, 태스크 2(graduated threshold)가 주된 해결책이 된다.

4. **기존 통계와의 정합성**: `getThesisStats()`에서 EXPIRED 건수가 줄고 CONFIRMED/INVALIDATED가 늘어남. 주간 QA 리포트 해석에 변화가 있을 수 있으나, 데이터 품질 관점에서 긍정적.

## 의사결정 필요

없음 — 바로 구현 가능.

이슈 #268의 개선안을 코드 분석 결과와 대조하여 검증했고, 다음 판단을 자율 수행했다:
- graduated threshold 방식 채택 (고정 완화 vs graduated → graduated가 장기 품질 유지에 유리)
- 만료 전 정량 판정만 시도, LLM 미사용 (비용 효율 + LLM 자기참조 방지)
- 검증-만료 순서 역전 (현재 순서가 데이터 낭비를 유발하는 명확한 버그)
