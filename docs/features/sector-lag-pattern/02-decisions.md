# 의사결정 기록 — 섹터 간 시차(Lag) 패턴 축적

**이슈**: #93
**날짜**: 2026-03-08

---

## Decision 1: 이벤트 로그 테이블 신설 vs. `sector_rs_daily` 직접 쿼리

**Context**: `sector_rs_daily`에 이미 `group_phase`와 `prev_group_phase`가 있다. 매번 통계 쿼리 시 이 테이블을 직접 JOIN하여 계산하면 별도 이벤트 테이블이 필요 없다.

**Options:**

| 방식 | 장점 | 단점 |
|------|------|------|
| 직접 쿼리 (이벤트 테이블 없음) | 단순. 테이블 추가 없음 | 매번 전체 `sector_rs_daily` 풀 스캔. `sector_rs_daily`가 커질수록 느려짐. 통계 계산이 복잡한 SQL이 됨 |
| `sector_phase_events` 별도 로그 | 이벤트 레코드 수가 훨씬 적음. 통계 쿼리 단순. 인덱스 최적화 용이. 히스토리 감사(audit) 가능 | 테이블 1개 + ETL 1개 추가 |

**Decision**: `sector_phase_events` 별도 이벤트 로그 테이블 신설.

**Reason**: 이벤트는 드물게 발생한다(하루에 섹터 전체에서 수 개 수준). 이를 별도로 기록하면 통계 계산 쿼리가 수십만 행 대신 수백~수천 행을 읽는다. `sector_rs_daily`는 매일 모든 섹터 × 날짜 레코드가 쌓이는 넓은 테이블로, 시간이 갈수록 쿼리 비용이 증가한다. 이벤트 로그 패턴이 장기적으로 더 확장 가능하다.

---

## Decision 2: 섹터 쌍(Pair) 사전 정의 vs. 이벤트 기반 자연 생성

**Context**: "반도체 → 반도체 장비"처럼 의미 있는 쌍을 사전에 정의할 수도 있고, 실제 이벤트 데이터에서 자연스럽게 쌍을 발견할 수도 있다.

**Options:**

| 방식 | 장점 | 단점 |
|------|------|------|
| 하드코딩 사전 정의 | 의미 없는 쌍 제거 가능 | 주관적. 알려지지 않은 패턴 누락 가능 |
| 이벤트 기반 자연 생성 | 데이터 주도. 예상치 못한 패턴 발견 가능 | 초기에 의미 없는 쌍도 포함될 수 있음 |
| 하이브리드: 자연 생성 + 신뢰도 필터 | 두 가지 장점 결합 | 구현 복잡도 약간 증가 |

**Decision**: 이벤트 기반 자연 생성 + `is_reliable` 신뢰도 필터.

**Reason**: 사전 정의는 "알고 있는 것"만 포착한다. 데이터에서 자연스럽게 나타나는 패턴이 더 가치 있다 — 우리가 몰랐던 시차 관계를 발견할 수 있기 때문. `is_reliable`(샘플 5개 이상) 필터가 에이전트 프롬프트 노출을 통제하므로, 신뢰할 수 없는 쌍이 의사결정에 영향을 미치지 않는다.

---

## Decision 3: 시차 탐색 윈도우 — 180일

**Context**: 리더 섹터 Phase 2 진입 후, 얼마 안에 팔로워 이벤트를 탐색할 것인가?

**Options:**

| 윈도우 | 장점 | 단점 |
|--------|------|------|
| 60일 | 강한 단기 패턴만 포착. 노이즈 적음 | 중기 시차(10주 내외) 패턴 누락 |
| 120일 | 균형점 | 근거 약함 |
| 180일 | 6개월 내 패턴까지 포착 | 우연한 매칭 가능성 증가 |
| 365일 | 연간 사이클 포착 | 다른 시장 사이클의 이벤트와 혼합 위험 |

**Decision**: 180일 (약 6개월, 26주).

**Reason**: 섹터 Phase 2 진입 이후 6개월은 일반적으로 동일한 시장 사이클 내에 있다. 180일을 초과하면 다음 사이클의 이벤트와 혼동할 가능성이 크다. RFC 원문에서도 구체적 수치가 없었으므로 보수적으로 설정하고, 데이터 축적 후 재검토.

---

## Decision 4: `entity_type` 통합 vs. 섹터/산업 분리 테이블

**Context**: `sector_phase_events`와 `sector_lag_patterns`를 섹터 전용 테이블과 산업 전용 테이블로 분리할 수도 있다.

**Decision**: `entity_type` 컬럼으로 하나의 테이블에서 통합 관리.

**Reason:**
1. 섹터와 산업의 구조가 동일(날짜, Phase, RS). 코드 중복 없이 하나의 ETL로 처리.
2. 섹터-산업 교차 시차도 탐지 가능: "Semiconductors(섹터) Phase 2 → Semiconductor Equipment(산업) Phase 2" 같은 cross-entity 패턴.
3. 통계 쿼리에서 `entity_type`으로 필터링하면 충분히 구분됨.

---

## Decision 5: 노이즈 이벤트 필터링 전략 — 단순 탐지로 시작

**Context**: 섹터 Phase가 1일 만에 들어왔다 나갔다 할 수 있다 ("거짓 Phase 2"). N일 유지 조건을 추가할 것인가?

**Options:**

| 방식 | 장점 | 단점 |
|------|------|------|
| 단순 탐지 (1일 전이 = 이벤트) | 구현 단순. 데이터 누락 없음 | 노이즈 이벤트 포함 가능 |
| N일 유지 조건 (예: 5일 Phase 2 유지 후 이벤트 확정) | 노이즈 제거 | 지연 감지. 초기 Phase 2 신호 놓침 가능 |

**Decision**: 초기에는 단순 탐지로 시작. 데이터 축적 후 노이즈 확인하여 필요 시 추가.

**Reason**: 이 시스템은 데이터 축적이 목적이다. 노이즈 이벤트가 발생해도 `is_reliable` 필터(샘플 5개)가 에이전트 노출을 막는다. 너무 엄격한 초기 필터는 데이터 축적을 방해한다. 6개월 후 실제 노이즈 패턴이 확인되면 그때 필터를 추가하는 것이 데이터 주도 개선이다.

---

## Decision 6: p-value vs. 단순 신뢰도 — 이항 검정 사용하지 않음

**Context**: narrative_chains의 `statisticalTests.ts`에는 이항 검정(binomial test)이 구현됐다. 섹터 시차 패턴에도 동일하게 p-value를 적용할 것인가?

**Decision**: 이 단계에서는 p-value 없이 샘플 수 기반 `is_reliable` 플래그만 사용.

**Reason:**
1. 이항 검정은 이진 결과(성공/실패)에 적합하다. 시차 패턴은 연속형 데이터(lag_days)이므로 다른 통계 검정(t-test 또는 Wilcoxon)이 더 적합하다.
2. 그러나 현재 샘플 수가 매우 적을 것이 예상된다. 5~10개 샘플에서 t-test는 신뢰할 수 없다.
3. 충분한 데이터 축적(N ≥ 30) 후에 적절한 통계 검정을 추가하는 것이 올바른 순서다.
4. `stddev_lag_days`를 저장해두면 나중에 신뢰 구간을 계산하는 데 사용할 수 있다.

---

## Architecture Summary

```
[매일 ETL 파이프라인]
  build-sector-rs.ts (기존)
  build-industry-rs.ts (기존)
       ↓
  detect-sector-phase-events.ts (신규)
  → sector_rs_daily + industry_rs_daily에서 Phase 전이 탐지
  → sector_phase_events INSERT (UPSERT)
       ↓
  update-sector-lag-patterns.ts (신규)
  → sector_phase_events에서 섹터 쌍별 시차 계산
  → sector_lag_patterns UPSERT

[주간 에이전트]
  run-weekly-agent.ts (수정)
  → sectorLagStats.formatLeadingSectorsForPrompt() 호출
  → 신뢰 가능한 패턴 존재 시 프롬프트에 주입
  → buildWeeklySystemPrompt()에 sectorLagContext 추가

[신규 파일]
  src/etl/jobs/detect-sector-phase-events.ts
  src/etl/jobs/update-sector-lag-patterns.ts
  src/lib/sectorLagStats.ts
  src/db/schema/analyst.ts (sectorPhaseEvents, sectorLagPatterns 추가)
```
