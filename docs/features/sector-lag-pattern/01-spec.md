# 섹터 간 시차(Lag) 패턴 축적

**이슈**: #93
**날짜**: 2026-03-08
**작성**: mission-planner
**RFC 근거**: RFC-narrative-layer.md 제안 6

---

## 선행 맥락

**RFC Wave 4 배치의 의미:**

`docs/RFC-narrative-layer.md` 제안 6에서 이 기능은 "Wave 4: 3개월+ 데이터 필요"로 분류됐다. Wave 4는 "외부 데이터 소스 추가 또는 3개월+ 축적 데이터 필요. 급하지 않음"의 범주였다. RFC에 담긴 당시 판단: "충분한 관측(N ≥ 5) 후 평균 시차 + 신뢰도 산출."

**현재 데이터 상황 (2026-03-08 기준):**

- `sector_rs_daily`: 매일 섹터별 RS, groupPhase, prevGroupPhase, phase1to2Count5d 축적 중
- `industry_rs_daily`: 매일 산업별 동일 지표 축적 중
- `stock_phases`: 개별 종목별 phase, prevPhase 매일 기록
- 프로젝트 시작 이후 데이터가 쌓이고 있으나 정확한 시작 시점 불명. 섹터 Phase 2 진입 이벤트를 별도로 기록하는 테이블은 없음.

**핵심 제약**: `sector_rs_daily`의 `groupPhase`와 `prevGroupPhase`로 Phase 전이를 탐지할 수 있으나, 이것은 **스냅샷 기반**이다. 섹터가 Phase 1 → Phase 2로 전이하는 정확한 날짜를 이벤트 로그로 기록하는 구조가 현재 없다. 기존 데이터에서 소급 계산은 가능하지만, 섹터 간 시차가 의미 있으려면 Phase 2 진입 이벤트가 최소 5회 이상 반복 관측되어야 한다.

**Wave 2b(narrative_chains) 완료로 생긴 시너지:**

병목 체인 추적과 섹터 시차 패턴은 독립적이지만 상호 보완적이다. 서사 레이어가 "왜 이 섹터인가"의 서사적 근거를 제공한다면, 섹터 시차 패턴은 "언제 다음 섹터가 반응하는가"의 정량적 근거를 제공한다.

---

## 골 정렬

**ALIGNED**

- "반도체가 Phase 2 진입 → N주 후 반도체 장비 주시"는 Phase 2(상승 초입) 주도섹터/주도주를 **남들보다 먼저** 포착하는 것의 정의 그 자체다.
- 선행 섹터를 모니터링하다가 후행 섹터의 Phase 2 진입 신호를 조기에 포착하는 것은 직접적 알파 형성 수단이다.
- 기존 DB 데이터만 사용 — 추가 외부 API, 비용, 의존성 없음.
- 서사 레이어(narrative_chains)와 교차 검증 가능 → "서사도 맞고, 시차 패턴도 확인" = 이중 필터.

---

## 문제

섹터는 독립적으로 움직이지 않는다. 공급 체인 상류(예: 반도체)가 먼저 Phase 2에 진입하면, 하류(예: 반도체 장비)가 일정 시간 후 Phase 2에 진입하는 패턴이 반복된다. 그러나 현재 시스템은 이 시차 데이터를 축적하지 않으며, 주간 에이전트는 현재 섹터 RS만 보고 "무엇이 지금 강한가"만 판단한다. "A가 강해졌으니 B를 주시하라"는 선행 경보를 생성할 수 없다.

---

## Before → After

**Before**
- 섹터 Phase 전이 이벤트가 별도로 기록되지 않음. `sector_rs_daily.prevGroupPhase`로 하루 단위 변화는 탐지 가능하지만 이벤트 로그가 없어 통계 계산 불가.
- 주간 에이전트는 현재 시점의 섹터 RS 랭킹만 참조. 과거 시차 패턴을 활용하지 않음.
- "반도체가 오늘 Phase 2에 진입했으니 N주 후 장비를 주시하라"는 알림 없음.

**After**
- `sector_phase_events` 테이블이 섹터별 Phase 전이 시점을 이벤트 로그로 기록.
- `sector_lag_patterns` 테이블이 섹터 쌍별 시차 통계(평균, 표준편차, 샘플 수, p-value)를 축적.
- Phase 2 진입 이벤트 발생 시 → 해당 섹터의 팔로워 섹터 목록과 예상 시차를 ETL이 계산.
- 주간 에이전트 프롬프트에 "현재 선행 섹터 기반 주시 대상" 섹션이 주입됨.
- 샘플 5개 미만의 패턴은 "데이터 축적 중"으로 표시되어 신뢰할 수 없는 패턴이 노출되지 않음.

---

## 변경 사항

### 변경 1: DB 스키마 — `sector_phase_events` 테이블 신설

Phase 전이 이벤트를 독립적으로 기록하는 이벤트 로그 테이블.

```
sector_phase_events:
  id                  serial PK
  date                text NOT NULL          -- 이벤트 발생 날짜 (YYYY-MM-DD)
  entity_type         text NOT NULL          -- 'sector' | 'industry'
  entity_name         text NOT NULL          -- "Semiconductors" | "Semiconductor Equipment"
  from_phase          smallint NOT NULL      -- 이전 Phase (1~4)
  to_phase            smallint NOT NULL      -- 새 Phase (1~4)
  avg_rs              numeric                -- 이벤트 시점 RS
  phase2_ratio        numeric                -- 이벤트 시점 Phase 2 비율
  created_at          timestamp with timezone

  UNIQUE(date, entity_type, entity_name, from_phase, to_phase)
  INDEX(entity_type, entity_name, to_phase, date)
  INDEX(date, entity_type, to_phase)
```

**설계 근거:**
- `entity_type`으로 섹터/산업 구분 — 산업 수준 시차도 의미 있음(예: "Semiconductors Phase 2" → "Semiconductor Equipment" 산업 Phase 2)
- `from_phase` + `to_phase` 쌍으로 기록 — Phase 1→2 전이가 핵심이지만 Phase 3→4(하락 전이)도 선행 신호로 가치 있음
- `avg_rs`, `phase2_ratio` 스냅샷 — 이벤트 강도 파악용. 나중에 "강한 Phase 2 진입"과 "약한 Phase 2 진입"을 구분하는 데 활용 가능

### 변경 2: DB 스키마 — `sector_lag_patterns` 테이블 신설

섹터/산업 쌍별 시차 통계를 누적 계산하는 집계 테이블.

```
sector_lag_patterns:
  id                  serial PK
  entity_type         text NOT NULL          -- 'sector' | 'industry'
  leader_entity       text NOT NULL          -- "Semiconductors"
  follower_entity     text NOT NULL          -- "Semiconductor Equipment"
  transition          text NOT NULL          -- '1to2' | '3to4' (선행 이벤트 유형)

  -- 관측 통계
  sample_count        integer NOT NULL DEFAULT 0
  avg_lag_days        numeric                -- 평균 시차 (일 단위)
  median_lag_days     numeric
  stddev_lag_days     numeric
  min_lag_days        integer
  max_lag_days        integer

  -- 신뢰도
  p_value             numeric                -- 이항 검정 p-value (대안: 단순 신뢰도 0~1)
  is_reliable         boolean DEFAULT false  -- sample_count >= MIN_SAMPLE (5)

  -- 최근 관측
  last_observed_at    text                   -- 마지막 관측 날짜
  last_lag_days       integer                -- 가장 최근 시차

  last_updated        text
  created_at          timestamp with timezone

  UNIQUE(entity_type, leader_entity, follower_entity, transition)
```

**설계 근거:**
- `is_reliable` 플래그로 샘플 부족 패턴을 명시적으로 구분 — "신뢰할 수 없는 패턴"을 에이전트 프롬프트에 주입하면 오히려 해가 됨
- `stddev_lag_days`로 신뢰 구간 계산 가능 — "평균 4.2주, 표준편차 1.3주"는 "2.6~5.8주 범위로 예상"으로 변환 가능
- `transition` 필드로 전이 유형 구분 — Phase 1→2가 주 관심사이나, Phase 3→4 선행 신호도 리스크 관리에 중요

### 변경 3: ETL 잡 — `detect-sector-phase-events.ts` 신설

매일 ETL 파이프라인에서 실행. `sector_rs_daily`, `industry_rs_daily`의 `groupPhase`/`prevGroupPhase`를 비교하여 전이 이벤트를 탐지하고 `sector_phase_events`에 기록.

**로직:**
1. 최신 거래일의 `sector_rs_daily`를 조회
2. `group_phase != prev_group_phase` AND `prev_group_phase IS NOT NULL` 조건으로 전이 이벤트 탐지
3. 해당 이벤트가 이미 `sector_phase_events`에 없으면 INSERT (중복 방지 UPSERT)
4. `industry_rs_daily`에 대해서도 동일 실행
5. 완료 후 `update-sector-lag-patterns.ts` 트리거

### 변경 4: ETL 잡 — `update-sector-lag-patterns.ts` 신설

`sector_phase_events` 데이터를 기반으로 섹터 쌍별 시차 통계를 재계산하여 `sector_lag_patterns`에 UPSERT.

**시차 계산 알고리즘:**

```
대상: Phase 1→2 전이 이벤트 (transition = '1to2')

1. 리더 이벤트 목록: leader_entity의 1→2 전이 날짜 시계열
2. 팔로워 이벤트 목록: follower_entity의 1→2 전이 날짜 시계열
3. 각 리더 이벤트에 대해:
   a. 해당 리더 전이일로부터 0~180일 이내의 팔로워 전이를 탐색
   b. 가장 가까운 팔로워 전이 선택 (정방향 시차만 — 팔로워가 나중에 진입해야 의미 있음)
   c. lag_days = follower_date - leader_date (양수만 유효)
4. 페어별 lag_days 배열 → 평균, 중앙값, 표준편차, 최소, 최대 계산
5. sample_count >= MIN_SAMPLE(5) → is_reliable = true

주의사항:
- 동시 진입(lag = 0)은 포함 (같은 날 반응하는 것도 유효 패턴)
- 음수 시차(팔로워가 먼저 진입)는 제외 — 이 경우 리더/팔로워 관계가 반전됨
- 탐색 윈도우 180일: 너무 넓으면 우연한 매칭이 늘어나고, 너무 좁으면 실제 패턴을 놓침
```

**섹터 쌍 생성 전략:**

모든 섹터 조합(N×N)을 계산하는 것은 비효율적이다. 두 가지 접근을 병용:
1. **이벤트 기반**: 실제로 관측된 이벤트 쌍에서 자연스럽게 패턴이 축적됨 — 별도 "쌍 목록"이 불필요
2. **최소 샘플 필터**: `is_reliable = false` 패턴은 에이전트 프롬프트에 주입하지 않음으로써 노이즈 최소화

### 변경 5: ETL 잡 — `detect-leading-sectors.ts` 신설 (또는 `detect-sector-phase-events.ts`에 통합)

`sector_lag_patterns`를 기반으로 "현재 선행 섹터 기반 주시 대상"을 계산하여 별도 캐시 파일 또는 DB 컬럼에 저장.

**로직:**
1. 최근 N일 내 Phase 2에 진입한 섹터/산업 조회 (`sector_phase_events` where `to_phase = 2` AND `date >= today - 14`)
2. 해당 리더 섹터의 신뢰 가능한 팔로워 패턴 조회 (`sector_lag_patterns` where `is_reliable = true`)
3. 현재 날짜 기준 "예상 팔로워 진입 윈도우" 계산: `leader_event_date + avg_lag_days - stddev_lag_days` ~ `leader_event_date + avg_lag_days + stddev_lag_days`
4. 아직 Phase 2에 진입하지 않은 팔로워만 필터링 (이미 진입한 섹터는 제외)
5. 결과를 주간 에이전트 프롬프트 주입용 포맷으로 반환

### 변경 6: 주간 에이전트 프롬프트 연동 (`run-weekly-agent.ts`)

`formatLeadingSectorsForPrompt()` 함수를 신설하여 주간 에이전트 시스템 프롬프트에 주입.

**주입 형식 (신뢰 가능한 패턴 존재 시):**

```
## 섹터 시차 기반 조기 경보

현재 선행 섹터 움직임 기반 주시 대상:

| 리더 섹터 | Phase 2 진입일 | 팔로워 섹터 | 예상 진입 윈도우 | 과거 평균 시차 | 관측 횟수 |
|---------|-------------|-----------|---------------|-------------|---------|
| Semiconductors | 2026-02-28 | Semiconductor Equipment | 2026-04-04 ~ 2026-05-02 | 35일 (±14일) | 7회 |

※ 예상 진입 윈도우 내에 팔로워 섹터 RS 상승 조짐이 보이면 집중 주시.
※ 관측 5회 미만 패턴은 신뢰도 부족으로 표시하지 않습니다.
```

**패턴이 없거나 신뢰 가능한 패턴이 없으면 이 섹션을 주입하지 않는다.**

---

## 작업 계획

### Phase 1: DB 스키마 + 마이그레이션 (구현 에이전트)

**작업:**
- `src/db/schema/analyst.ts`에 `sectorPhaseEvents`, `sectorLagPatterns` 테이블 추가
- Drizzle 마이그레이션 파일 생성 및 Supabase 적용

**완료 기준:**
- 두 테이블이 Supabase DB에 존재
- Drizzle 스키마 타입 오류 없음

### Phase 2: ETL 이벤트 탐지 + 역사적 데이터 소급 (구현 에이전트, Phase 1 완료 후)

**작업:**
- `src/etl/jobs/detect-sector-phase-events.ts` 구현
  - `sector_rs_daily`, `industry_rs_daily`에서 `groupPhase != prevGroupPhase` 탐지
  - 역사적 소급: 테이블 생성 후 **기존 전체 데이터에 대해 1회 소급 실행**
  - 이후 매일 최신 날짜만 처리

**완료 기준:**
- 이벤트 탐지 로직이 기존 `sector_rs_daily` 전체 데이터에서 이벤트를 추출하여 테이블에 기록
- 중복 이벤트가 삽입되지 않음 (UPSERT)
- 일간 ETL 파이프라인 스크립트에 추가됨

### Phase 3: 시차 통계 계산 (구현 에이전트, Phase 2 완료 후)

**작업:**
- `src/etl/jobs/update-sector-lag-patterns.ts` 구현
  - `sector_phase_events`에서 섹터 쌍별 시차 계산
  - `sector_lag_patterns` UPSERT
  - `src/lib/sectorLagStats.ts` 유틸리티 함수 신설

**완료 기준:**
- Phase 2 진입 이벤트가 5개 이상인 섹터 쌍에서 평균 시차, 표준편차가 계산됨
- `is_reliable` 플래그가 정확히 설정됨

### Phase 4: 주간 에이전트 연동 + 테스트 (구현 에이전트, Phase 3 완료 후)

**Phase 4-A: 주간 에이전트 연동**
- `src/lib/sectorLagStats.ts`에 `formatLeadingSectorsForPrompt()` 구현
- `run-weekly-agent.ts`에 호출 추가
- 신뢰 가능한 패턴 없을 때 빈 문자열 반환 (섹션 미주입)

**Phase 4-B: 테스트**
- `sectorLagStats.ts` 시차 계산 로직 단위 테스트
  - 정방향 시차만 포함되는지 (음수 시차 제외)
  - 샘플 5개 미만 시 `is_reliable = false` 반환
  - 평균/중앙값/표준편차 계산 정확성
- `detect-sector-phase-events.ts` 이벤트 탐지 로직 단위 테스트
  - `prevGroupPhase`가 null인 경우 이벤트 미생성
  - `from_phase == to_phase`인 경우 이벤트 미생성
- 기존 ETL 테스트 회귀 없음 확인

Phase 4-A와 Phase 4-B는 병렬 진행 가능.

---

## 수용 기준 (Acceptance Criteria)

- [ ] `sector_phase_events` 테이블이 DB에 존재하고 Drizzle 스키마와 일치함
- [ ] `sector_lag_patterns` 테이블이 DB에 존재하고 Drizzle 스키마와 일치함
- [ ] 기존 `sector_rs_daily` 데이터에서 Phase 전이 이벤트가 소급 추출되어 기록됨
- [ ] 섹터 쌍별 시차 통계가 계산되어 `sector_lag_patterns`에 저장됨
- [ ] `is_reliable` 플래그가 샘플 수 기반으로 정확히 설정됨 (최소 5개)
- [ ] 주간 에이전트 프롬프트에 신뢰 가능한 선행 섹터 경보가 주입됨 (패턴 존재 시만)
- [ ] 신뢰 가능한 패턴이 없을 때 해당 섹션이 주입되지 않음
- [ ] 시차 계산 로직 단위 테스트 통과
- [ ] 이벤트 탐지 로직 단위 테스트 통과
- [ ] 기존 ETL 테스트 전체 통과 (회귀 없음)

---

## 리스크

| 리스크 | 수준 | 대응 |
|--------|------|------|
| 기존 `sector_rs_daily` 데이터가 충분하지 않아 신뢰 가능한 패턴이 나오지 않을 수 있음 | 높음 | 이것은 예상된 상황. 테이블과 ETL을 지금 만들어 두면 시간이 지날수록 자동으로 의미 있어진다. 즉각적인 패턴 생성을 기대하지 말고, 데이터 축적 인프라로 접근. |
| `prevGroupPhase`가 null인 초기 레코드로 인해 이벤트 탐지 오류 | 중간 | `prevGroupPhase IS NOT NULL` 가드 추가. 초기 레코드(null)는 이벤트 없음으로 처리. |
| 섹터 Phase가 하루에 왔다 갔다 하는 노이즈 이벤트 | 중간 | 단일 날짜 전이보다 N일 이상 유지된 Phase 2 진입만 유효 이벤트로 처리하는 필터 추가 (예: 5일 연속 Phase 2 유지). 초기에는 단순하게 단일 날짜로 시작하고, 노이즈 문제 확인 후 추가 필터 적용. |
| 탐색 윈도우(180일) 내에 우연한 매칭 증가 | 낮음 | `is_reliable`(샘플 5개 이상) + 표준편차 기반 신뢰 구간으로 관리. 패턴이 확고하지 않으면 프롬프트에 주입되지 않음. |
| 주간 에이전트 프롬프트에 잘못된 패턴 주입 → 판단 오도 | 중간 | `is_reliable = true`인 패턴만 주입. 프롬프트에 "과거 관측 횟수"와 "표준편차 범위" 명시하여 에이전트가 신뢰도를 직접 판단. |

---

## 의사결정 필요

없음 — 자율 판단으로 진행.

**자율 판단 결과 기록:**

1. **RFC Wave 4 → 즉시 착수로 상향**: RFC에서 "3개월+ 데이터 필요 후 착수"로 분류됐으나, 이는 "패턴 활용에 3개월+ 데이터가 필요하다"는 의미이지 "인프라를 3개월 후에 만들라"는 의미가 아니다. 인프라(테이블 + ETL)는 지금 만들어야 3개월 후에 의미 있는 데이터가 있다. narrative_chains와 동일한 원칙 적용.

2. **`prevGroupPhase` 기반 탐지 방식**: 기존 `sector_rs_daily`에 `prevGroupPhase`가 이미 있으므로 별도 조인 없이 이벤트 탐지 가능. 구현 단순성 우선.

3. **역사적 소급 실행**: ETL 최초 실행 시 전체 `sector_rs_daily` 데이터를 소급 처리. 이후 매일 incremental 처리. 단, 소급 데이터의 품질은 `prevGroupPhase` 기록의 품질에 종속됨.

4. **섹터/산업 통합 처리**: `entity_type` 컬럼으로 두 레벨을 하나의 테이블에서 관리. 별도 테이블보다 통계 쿼리 단순화 효과가 크다.

5. **탐색 윈도우 180일**: RFC 원문에서 구체적 수치가 없었다. 섹터 시차가 6개월(180일)을 넘으면 "같은 시장 사이클"이라고 보기 어렵다는 판단으로 180일 선택. 추후 데이터 축적 후 조정 가능.

6. **최소 샘플 수 5개**: narrative_chains의 3개보다 높게 설정. 이유: 시차 패턴은 통계적 회귀 분석에 가깝고, 분산(표준편차)을 의미 있게 계산하려면 최소 5개가 필요. 3개로는 표준편차가 노이즈에 불과하다.
