# recommendations ETL 자동화 — 에이전트 의존 제거

GitHub Issue: #547

## 선행 맥락

없음 — recommendations 자동화를 직접 다룬 이전 기록 없음.

관련 맥락:
- F11(인사이트 브리핑 전환, #390)에서 save_recommendations 도구 복원(#544)을 거쳤지만,
  에이전트가 도구를 호출하지 않으면 0건이 되는 근본 구조는 미해결 상태였음.
- PR #544에서 "saveRecommendations 도구 에이전트 복원 — 추천 종목 진입 경로 재개"가
  최근 커밋으로 확인됨.

## 골 정렬

ALIGNED — Phase 2 초입 종목의 자동 포착 신뢰성을 높이는 인프라 변경.
에이전트 호출 누락으로 인한 0건 리스크 제거 = 포착 연속성 보장.

## 문제

`save_recommendations` 도구는 에이전트(LLM)가 호출해야만 실행되는 구조다.
게이트 조건(Phase 2, RS 60~95, 지속성/안정성, 펀더멘탈 등)이 전부 DB 정량 기준이므로,
에이전트 판단이 개입해야 할 이유가 없다. 에이전트가 호출하지 않으면 그날 추천 0건이 된다.

## Before → After

**Before**
```
ETL → build-stock-phases → [에이전트 실행] → LLM이 종목 선정 → save_recommendations 도구 호출 → DB 저장
                                                               ↑ 여기서 끊기면 0건
```

**After**
```
ETL → build-stock-phases → scan-recommendation-candidates (신규 ETL job) → DB 저장
에이전트 → save_recommendations 도구: 조회/코멘트 전용으로 역할 재정의
                              (또는 도구 유지하되 "ETL 이미 저장됨" 상태 반환)
```

ETL job이 게이트 통과 종목을 자동 스캔·저장하므로, 에이전트 실행 여부와 무관하게
매 거래일 추천이 생성된다.

## 변경 사항

### 1. 신규 ETL job: `src/etl/jobs/scan-recommendation-candidates.ts`

**역할**: `saveRecommendations.ts`의 게이트 로직을 그대로 재사용하여
조건 충족 종목을 자동 스캔 → recommendations INSERT.

**스캔 대상**: `stock_phases`에서 오늘 날짜 기준 Phase 2 종목 전수.

**reason 처리**: ETL 자동 저장임을 명시하는 고정 접두사 사용.
- 포맷: `"[ETL 자동] Phase {phase} RS {rs_score} 자동 스캔"`
- 에이전트 reason(서술형 분석)과 구분 가능하도록 태깅.

**게이트 로직 재사용 방식**:
- `saveRecommendations.ts`에서 순수 게이트 함수를 별도 모듈(`src/tools/recommendationGates.ts`)로 추출.
- ETL job과 기존 도구 둘 다 해당 모듈을 import.
- 코드 중복 없이 게이트 조건 일관성 보장.

**Bear/LateBull 예외 게이트 처리**:
- `evaluateBearException`, `evaluateLateBullGate`는 개별 종목에 대해 DB 쿼리 후 판단.
- ETL job도 동일하게 적용. fail-open 정책은 기존 동일.

**멱등성**: 기존 `onConflictDoNothing({ target: [symbol, recommendationDate] })` 그대로.
에이전트가 이후 도구를 호출해도 중복 저장 없음.

**기업 분석 리포트 (`runCorporateAnalyst`)**: ETL job에서 동일하게 fire-and-forget 실행.

### 2. `src/tools/recommendationGates.ts` 추출

`saveRecommendations.ts`에서 순수 게이트 로직을 분리하는 새 모듈.

추출 대상:
- `getDateOffset` 헬퍼
- `BEAR_REGIMES`, `COOLDOWN_CALENDAR_DAYS`, `PHASE2_PERSISTENCE_DAYS` 등 상수
- `MIN_PHASE2_PERSISTENCE_COUNT`, `PHASE2_STABILITY_DAYS`, `BLOCKED_FUNDAMENTAL_GRADE` 상수
- 게이트 판정 함수 (Phase 하드 게이트, RS 하한, RS 과열, 저가주, 지속성, 안정성, 펀더멘탈)

`saveRecommendations.ts`는 이 모듈을 import하여 기존 동작 유지.

### 3. `scripts/cron/etl-daily.sh` — Phase 3.8에 추가

```
# Phase 3.8 (추천 종목 성과 갱신 + 관심종목 Phase 궤적 갱신)
run_step "Update Recommendation Status" "src/etl/jobs/update-recommendation-status.ts"
run_step "Update Watchlist Tracking" "src/etl/jobs/update-watchlist-tracking.ts"
+ run_step "Scan Recommendation Candidates" "src/etl/jobs/scan-recommendation-candidates.ts"
```

**위치 선정 근거**:
- `stock_phases` 완료(Phase 3) + `build-industry-rs` 완료(Phase 3.5) 이후 필수.
  → Phase, RS, 섹터/업종 RS 등 모든 판단 근거 데이터가 준비된 시점.
- `update-recommendation-status.ts` 와 같은 Phase 3.8에 배치.
  → 성과 갱신(기존 ACTIVE 종목 처리)과 신규 추가(신규 스캔)를 같은 단계에 묶음.
- `run_parallel`이 아닌 `run_step` (순차): update-recommendation-status와의 DB 경합 방지.
  → ACTIVE 종목 상태 갱신이 완료된 후 쿨다운/중복 체크가 정확히 동작.

### 4. 에이전트 `save_recommendations` 도구 역할 재정의

**방향**: 도구를 제거하지 않고 역할을 "조회/코멘트 추가"로 전환.

**변경 내용**:
- `execute` 함수: 입력받은 symbols에 대해 오늘 recommendations 레코드 조회 후 반환.
  에이전트가 선정한 종목이 ETL에 의해 이미 저장됐는지 확인하는 용도.
- 에이전트가 "이 종목들이 오늘 관심종목으로 등록됐는지 확인"하는 검증 도구로 전환.
- 도구 description 및 systemPrompt 설명 업데이트.

**systemPrompt 변경**:
- "save_recommendations: 추천 종목 저장" → "check_recommendations: 오늘 자동 저장된 추천 종목 조회"
- "반드시 호출하세요" 문구 제거.
- 에이전트에게 ETL 자동화 사실을 명시.

## 작업 계획

### Step 1 — 게이트 로직 추출 (리팩터링)

**담당**: 구현팀 에이전트
**완료 기준**:
- `src/tools/recommendationGates.ts` 생성
- `saveRecommendations.ts`가 추출된 모듈을 import하여 기존 동작 동일
- 기존 `saveRecommendations.test.ts` 전체 통과

### Step 2 — ETL job 구현

**담당**: 구현팀 에이전트
**완료 기준**:
- `src/etl/jobs/scan-recommendation-candidates.ts` 구현
- 오늘 날짜 Phase 2 종목 전수 스캔
- 모든 게이트 적용 (recommendationGates.ts 재사용)
- `onConflictDoNothing` 멱등성 보장
- `runCorporateAnalyst` fire-and-forget 포함
- 단위 테스트 작성 (게이트별 케이스)

### Step 3 — 도구 역할 전환

**담당**: 구현팀 에이전트
**완료 기준**:
- `saveRecommendations.ts`의 `execute`가 조회 모드로 전환
- `systemPrompt.ts` 설명 업데이트
- 도구 이름은 유지 (하위 호환) 또는 `check_recommendations`로 변경 후 시스템 프롬프트 반영
- 기존 테스트 업데이트

### Step 4 — etl-daily.sh 배치

**담당**: 구현팀 에이전트
**완료 기준**:
- Phase 3.8에 `scan-recommendation-candidates` 추가
- 로컬 dry-run으로 순서 확인

### Step 5 — 통합 검증

**담당**: 구현팀 에이전트
**완료 기준**:
- `ETL_SKIP_AGENT=1 ./scripts/cron/etl-daily.sh` 실행 시 recommendations 저장 확인
- 에이전트 실행 없이 DB에 오늘 날짜 추천 레코드 생성됨
- 에이전트 실행 시 도구가 "이미 ETL 저장된 종목" 목록 반환

## 테스트 계획

**단위 테스트** (`src/etl/jobs/__tests__/scan-recommendation-candidates.test.ts`):
- 정상 케이스: Phase 2 + RS 60~95 + 지속성 3일 + 안정성 3일 + 펀더멘탈 비F → 저장
- Phase 미달 종목 → 스킵
- RS 하한 미달(< 60) → 스킵
- RS 과열(> 95) → 스킵
- 저가주(< $5) → 스킵
- 지속성 미달(< 3일) → 스킵
- 안정성 미달(3일 연속 아님) → 스킵
- SEPA F등급 → 스킵
- ACTIVE 중복 → 스킵
- 쿨다운 내 CLOSED → 스킵
- 멱등성: 동일 (symbol, date) 2회 실행 시 1건만 저장

**기존 테스트 유지**:
- `saveRecommendations.test.ts` 전체 통과 (리팩터링 후)

## 리스크 / 주의사항

**ETL job의 reason 품질**: 에이전트는 서술형 분석을 reason에 담지만, ETL job은
정형화된 문자열만 저장한다. 추천 품질(이유) 면에서는 에이전트 저장이 더 풍부하다.
→ 허용 가능. ETL 추천 = "자격 미달 아님" 수준의 보장. 에이전트는 이후
check_recommendations로 조회 후 코멘트를 update할 수 있도록 향후 확장 고려.

**Bear/LateBull 예외 게이트 개별 종목 DB 쿼리**: Phase 2 전수 스캔 시
수백~수천 건에 대해 개별 쿼리가 발생할 수 있음.
→ 레짐이 BEAR/LATE_BULL이 아니면 해당 게이트 자체를 스킵하므로 일반 상황에서 비용 없음.
BEAR 레짐에서도 현재 에이전트 도구와 동일한 쿼리 패턴 — 새로운 부하 아님.
단, 스캔 대상이 수천 건이면 순차 처리 시간이 길어질 수 있음.
→ 초기 구현은 순차 처리. Phase 2 종목이 통상 200~500건 수준이면 수용 가능.
성능 이슈 발생 시 배치 쿼리로 최적화 (후속 작업).

**cron 타이밍**: scan-recommendation-candidates는 Phase 3.8에서 실행됨.
Phase 5(에이전트 토론)가 이후에 실행되므로, 에이전트가 check_recommendations 도구로
ETL 저장 결과를 조회하는 순서가 보장됨.

**기업 분석 리포트 중복 실행 방지**: `runCorporateAnalyst`는 `onConflictDoNothing`
방식으로 멱등성을 보장하는지 확인 필요. 에이전트 경로와 ETL 경로 둘 다 실행될 경우
중복 리포트 생성 리스크.
→ Step 2에서 `runCorporateAnalyst` 내부 멱등성 확인 후 구현.

## 의사결정 필요

없음 — 바로 구현 가능.

단, 도구명 변경(save_recommendations → check_recommendations)은 시스템 프롬프트 전체
일관성에 영향을 주므로, 구현팀이 systemPrompt.ts를 수정할 때 주의.
도구 이름 유지(하위 호환)가 더 안전하며, description만 변경하는 방식을 권장.
