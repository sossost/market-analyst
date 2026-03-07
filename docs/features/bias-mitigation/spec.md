# Bias Mitigation — 재귀 개선 자기확증편향 해소

## 선행 맥락

- **이슈 #49**: 프로젝트 골 재정렬 — Phase 2(재귀 개선 신뢰성) 정의
- **PR #56**: Phase 1 — 정량 검증(quantitativeVerifier.ts) + 승격 기준 강화(MIN_HITS=10, MIN_HIT_RATE=0.70)
- **PR #59/#62**: QA 에이전트 정상화 — GitHub Actions + 파일 저장 + 프롬프트 강화
- **이슈 #58**: 초입 포착 도구 유효성 검증 완료. 핵심 인사이트: 섹터 RS 동반 상승이 가장 유의미한 필터.

선행 작업(#58, #59)이 모두 완료된 상태로, 이슈 #60이 마지막 Phase 2 미착수 항목이다.

## 골 정렬

**ALIGNED** — 재귀 개선 루프가 실제로 시스템을 개선하는지 보장하는 인프라. 골 달성의 신뢰성 기반.

신뢰할 수 없는 학습이 쌓이면 장관들의 분석 품질이 서서히 저하된다. 편향이 없어야 알파가 형성된다.

## 문제

현재 재귀 개선 루프:
```
장관 토론(Claude) → thesis 생성 → thesis 검증(Claude) → 3회+ 적중 → agent_learnings 승격 → 프롬프트 주입
```

**구조적 결함 3가지:**

1. **자기확증편향**: 같은 Claude 모델이 thesis를 생성하고 검증한다. LLM 검증(`verificationMethod = 'llm'`)이 전체 검증의 주 경로다. 정량 조건(`>`, `<` 형식)이 없는 thesis는 모두 LLM이 채점한다.

2. **승격 기준 유의성 미검증**: 현재 기준(MIN_HITS=10, MIN_HIT_RATE=70%)이 랜덤 생성 대비 통계적으로 유의한지 확인되지 않았다. 우연히 맞은 패턴이 "검증된 패턴"으로 승격될 수 있다.

3. **오염 감지 부재**: 학습 원칙(principle)이 특정 편향 방향으로 수렴하는지 모니터링하는 메커니즘이 없다. 잘못된 학습이 쌓여도 자동으로 감지되지 않는다.

## Before → After

**Before**
- thesis 검증의 주 경로: LLM 판단 (정량 조건 없으면 무조건 LLM)
- 승격된 learning의 신뢰도: 검증되지 않음 (우연 vs 인과 구분 불가)
- 편향 수렴 감지: 없음
- `verificationMethod = 'llm'` 비율: 추적 안 됨

**After**
- thesis 설계 시점에서 정량 조건 작성을 구조적으로 유도 → LLM 검증 비율 감소
- 승격 learning의 신뢰도: p-value 기반 통계 검증으로 유의성 확인
- 편향 수렴: 주기적 다양성 체크로 쏠림 감지 + 경고
- `verificationMethod = 'llm'` vs `'quantitative'` 비율 추적 → QA 메트릭에 포함

## 변경 사항

### Phase A — 정량 조건 커버리지 확대 (핵심)

**A1. thesis 생성 프롬프트 강화** (`round3-synthesis.ts`)
- 현재: `verificationMetric`, `targetCondition`, `invalidationCondition` 필드 요청
- 변경: 장관들에게 "가능한 한 수치 기반 조건(`>`, `<`, `>=`, `<=`)으로 작성하라"는 명시적 지시 추가
- 예시 추가: `"S&P 500 > 5800"`, `"Tech RS > 60"`, `"VIX < 20"`
- 목표: 정량 파싱 가능한 thesis 비율 증가 → LLM 검증 폴백 감소

**A2. 정량 커버리지 메트릭 추적** (`thesisVerifier.ts`)
- 현재: `quantitative: number`, `llm: number` 카운트만 있음
- 변경: 검증 결과에 커버리지 비율(`quantitativeRate`)을 포함, QA 리포트에 기록
- 임계값: `quantitativeRate < 30%`이면 QA에서 경고

### Phase B — 승격 기준 통계적 유의성 검증 (핵심)

**B1. 이항분포 p-value 검증** (`promote-learnings.ts`)
- 현재: MIN_HITS=10, MIN_HIT_RATE=0.70 — 기준의 근거 없음
- 변경: 승격 전 이항분포 검정(binomial test) 추가
  - 귀무가설: "이 패턴의 실제 적중률은 50%(랜덤)"
  - 기준: p-value < 0.05이어야 승격 허용
  - 구현: `src/lib/statisticalTests.ts`에 `binomialTest(hits, total, p0 = 0.5)` 함수 추가
- 효과: 우연히 10번 맞춘 패턴이 승격되지 않음

**B2. 효과 크기(Effect Size) 필터**
- p-value만으로는 부족 (샘플 많으면 작은 차이도 유의)
- Cohen's h 기준으로 중간 이상 효과크기(|h| >= 0.3) 추가 요구
- 구현: `binomialTest` 반환값에 `cohenH` 포함

### Phase C — 오염 감지 메커니즘 (보조)

**C1. 학습 다양성 체크** (`promote-learnings.ts` 또는 신규 ETL)
- 목적: 특정 편향(예: "항상 상승", "Tech 섹터만") 쏠림 감지
- 구현:
  - 현재 active learnings에서 principle 텍스트 분석
  - Bull-bias 비율: CONFIRMED learning 중 "상승/긍정" 방향 비율 계산
  - 임계값: bull-bias > 80%이면 경고 로그 + QA 리포트에 포함
- 단순 구현: 키워드 기반(상승, 돌파, 강세, 긍정 / 하락, 약세, 부정)

**C2. 학습 origin 태깅** (`agentLearnings` 스키마 확장)
- 현재: `category = 'confirmed'` 단일 분류
- 변경: `verificationPath = 'quantitative' | 'llm' | 'mixed'` 컬럼 추가
  - quantitative: 승격 기반 thesis가 모두 정량 검증됨
  - llm: 승격 기반 thesis가 모두 LLM 검증됨
  - mixed: 혼합
- 목적: 학습 신뢰도 계층화 (memoryLoader에서 quantitative 우선 노출 가능)

### Phase D — QA 메트릭 연동 (보조)

**D1. QA 리포트에 편향 메트릭 추가**
- 주간 QA 실행 시 다음 항목 포함:
  - `verificationMethod` 비율 (quantitative vs llm)
  - 신규 승격된 learning의 p-value 분포
  - bull-bias 비율
  - 최근 30일 CONFIRMED/INVALIDATED 비율
- 파일: `data/qa-reports/` (기존 QA 파일 경로 따름)

## 작업 계획

### 단계 1: statisticalTests 라이브러리 구현
- **담당**: 실행국 (구현 에이전트)
- **파일**: `src/lib/statisticalTests.ts`
- **내용**: `binomialTest(hits, total, p0)` — p-value + Cohen's h 반환
- **테스트**: `src/lib/__tests__/statisticalTests.test.ts` — 경계값 포함
- **완료 기준**: binomialTest가 scipy.stats.binomtest 결과와 동일한 p-value 반환

### 단계 2: promote-learnings.ts에 통계 검증 통합
- **담당**: 실행국
- **파일**: `src/etl/jobs/promote-learnings.ts`
- **내용**: `buildPromotionCandidates`에서 기준 통과한 후보에 `binomialTest` 적용. p-value >= 0.05이면 승격 거부 + 로그.
- **선행**: 단계 1
- **완료 기준**: 기존 테스트 통과 + 신규 통계 검증 테스트 추가

### 단계 3: agentLearnings 스키마에 verificationPath 컬럼 추가
- **담당**: 실행국
- **파일**: `src/db/schema/analyst.ts` + 마이그레이션
- **내용**: `verificationPath text` 컬럼 추가 (nullable, 기존 데이터 호환)
- **완료 기준**: 마이그레이션 실행 성공, 스키마 반영

### 단계 4: thesis 생성 프롬프트 강화
- **담당**: 실행국
- **파일**: `src/agent/debate/round3-synthesis.ts`
- **내용**: thesis 작성 지시에 정량 조건 권장 문구 + 예시 추가
- **완료 기준**: 프롬프트에 정량 조건 예시가 명시적으로 포함됨

### 단계 5: 정량 커버리지 + bull-bias 메트릭 추적
- **담당**: 실행국
- **파일**: `src/agent/debate/thesisVerifier.ts` (커버리지), `src/etl/jobs/promote-learnings.ts` (bias)
- **내용**: 커버리지 비율 계산 + bull-bias 키워드 스캔 + 경고 로그
- **완료 기준**: 두 메트릭이 로그에 출력됨

### 단계 6: QA 리포트 연동
- **담당**: 실행국
- **파일**: QA 에이전트 관련 파일 (이슈 #59 결과물 기반)
- **내용**: 편향 메트릭을 QA 리포트에 포함
- **완료 기준**: QA 리포트에 verificationMethod 비율 + bull-bias 포함

단계 1-2는 순차 실행. 단계 3-5는 1-2 완료 후 병렬 실행 가능. 단계 6은 3-5 완료 후.

## 리스크

**1. LLM 검증의 완전 제거는 불가**
- 이유: 많은 thesis가 정성적 조건("기술주 실적 서프라이즈 지속")을 사용하며, 이는 구조적으로 정량화 불가.
- 대응: LLM 검증을 제거하는 게 아니라 비율을 줄이고 신뢰도를 태깅하는 방향.

**2. binomialTest 구현 오류 위험**
- 이유: 수학 함수 직접 구현 시 수치 오차 발생 가능.
- 대응: 검증된 근사식(Normal approximation for large n, exact for small n) 사용. scipy 기준값과 비교 테스트 필수.

**3. bull-bias 키워드 방식의 한계**
- 이유: "하락 리스크에 베팅"도 "하락" 키워드를 포함하면 bear-bias로 잘못 분류.
- 대응: Phase C는 정밀 감지가 아닌 1차 경고 메커니즘으로 설계. 운영 중 패턴 보고 후 정교화.

**4. 스키마 마이그레이션 실행 리스크**
- 이유: 기존 데이터(agentLearnings) 영향 가능성.
- 대응: `verificationPath`는 nullable 컬럼으로 추가. 기존 행은 NULL 유지.

## 의사결정 필요

없음 — 바로 구현 가능.

단, Phase C (bull-bias)는 보조 메커니즘이며 정밀도보다 조기 경고에 초점. 운영 데이터 축적 후 고도화 여부는 추후 판단.
