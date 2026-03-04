# Decisions: Data Infrastructure

**Created:** 2026-03-04
**Updated:** 2026-03-04

---

## Technical Decisions

### 1. 계산 주체: ETL(사전 계산) vs Agent(실시간 계산)

| Option | Pros | Cons |
|--------|------|------|
| A: ETL 사전 계산 | 정확하고 일관된 계산, Agent 토큰 절약, 빠른 조회 | 새 지표 추가 시 ETL 수정 필요 |
| B: Agent 실시간 계산 | 유연함, ETL 불필요 | LLM 계산 실수 가능, 토큰 낭비, 느림 |
| C: 하이브리드 | 핵심은 ETL, 탐색적은 Agent | 경계 설정 필요 |

**Chosen:** A: ETL 사전 계산
**Reason:** LLM은 숫자 계산에 약하고 해석에 강함. 섹터 RS, Phase 판별, 브레드스는 확정적 계산이므로 ETL이 담당. Agent는 결과 조회 + 해석에 집중.

---

### 2. Phase 판별 프레임워크: Weinstein vs Minervini vs 커스텀

| Option | Pros | Cons |
|--------|------|------|
| A: Weinstein Stage Analysis | 체계적, 검증된 프레임워크, MA150(30주) 중심 | Phase 경계가 다소 모호할 수 있음 |
| B: Minervini SEPA | 더 엄격한 필터, 고성능 종목 집중 | 조건이 너무 엄격해 후보가 적을 수 있음 |
| C: 커스텀 로직 | 완전한 자유 | 검증 안 된 로직, 유지보수 어려움 |

**Chosen:** A: Weinstein Stage Analysis
**Reason:** 가장 체계적이고 Phase 1→2 전환 포착에 최적화된 프레임워크. MA150(≈30주 이동평균) 기준으로 Phase를 명확히 구분 가능. Minervini SEPA 조건은 Phase 2 내에서 추가 필터로 활용 가능.

---

### 3. 그룹 분류 체계: 2단계(Sector → Industry) 도입

| Option | Pros | Cons |
|--------|------|------|
| A: Sector(11개 대분류)만 | 기존 DB에 있음, 단순 | "광통신" 같은 소분류를 찾을 수 없음 |
| B: Sector + Industry 2단계 | 대분류로 흐름 보고, 소분류로 드릴다운 | 테이블 1개 추가, Industry 종목 수 적을 수 있음 |
| C: GICS 4단계 분류 | 가장 세밀 | 매핑 복잡, 필요 이상으로 세분화 |

**Chosen:** B: Sector + Industry 2단계
**Reason:** 주도주를 찾으려면 소분류(Industry)가 필수. "Technology" → "Optical Communication"으로 드릴다운해야 광통신 주도주를 찾을 수 있음. FMP symbols.industry 필드를 그대로 활용.

---

### 4. 섹터/Industry 자체 Phase 판별

| Option | Pros | Cons |
|--------|------|------|
| A: 섹터/Industry도 Phase 판별 | 그룹 레벨에서 Phase 1→2 전환 감지 가능 | 개별 종목 Phase와 혼동 가능 |
| B: 종목 Phase만 | 단순 | 섹터 레벨 전환 시그널 누락 |

**Chosen:** A: 섹터/Industry도 Phase 판별
**Reason:** 2024년 AI 소프트웨어 "섹터 자체"가 Phase 2로 전환한 것이 PLTR 상승의 배경. 그룹 레벨 Phase가 있어야 Agent가 "이 Industry가 새로 Phase 2 진입했다"를 판단 가능.

---

### 5. Phase 전환 급증 감지

| Option | Pros | Cons |
|--------|------|------|
| A: 5일 윈도우 집계 | 단기 급증 포착, 노이즈 적절히 필터 | 느린 전환은 놓칠 수 있음 |
| B: 단일 일 집계 | 가장 빠른 감지 | 노이즈에 취약 |
| C: 10일 윈도우 | 안정적이지만 느림 | 시그널이 이미 늦을 수 있음 |

**Chosen:** A: 5일 윈도우 집계
**Reason:** Phase 전환은 하루에 몇 종목씩 점진적으로 발생. 5일 윈도우가 의미 있는 클러스터링 단위. Agent가 추가로 10일/20일 추세를 자체 분석할 수 있으므로 ETL은 5일로 충분.

---

### 6. 펀더멘털 가속 집계 포함 여부

| Option | Pros | Cons |
|--------|------|------|
| A: 섹터/Industry RS 테이블에 포함 | 한 테이블에서 기술+펀더멘털 종합 조회 | 테이블 컬럼 증가 |
| B: 별도 테이블 분리 | 정규화, 깔끔 | JOIN 필요, 조회 복잡 |

**Chosen:** A: 같은 테이블에 포함
**Reason:** Agent가 "RS 가속 + 펀더멘털 뒷받침" 을 한 쿼리로 확인할 수 있어야 함. 컬럼 수가 많아지지만, 실제 사용 패턴상 항상 함께 조회되므로 합리적.

---

### 7. DB 테이블 위치

| Option | Pros | Cons |
|--------|------|------|
| A: 같은 Supabase, 신규 테이블 | 기존 테이블 JOIN 가능, 인프라 비용 없음 | DB 결합도 증가 |
| B: 별도 DB 인스턴스 | 완전 분리, 장애 격리 | 기존 데이터 접근 불가 (복제 필요), 비용 증가 |

**Chosen:** A: 같은 Supabase, 신규 테이블
**Reason:** 섹터 RS 계산에 기존 daily_prices, symbols 테이블 JOIN이 필수. 별도 DB면 데이터 복제 필요. 신규 테이블은 prefix나 별도 schema로 구분 가능.

---

### 8. MA150 기울기 계산 방법

| Option | Pros | Cons |
|--------|------|------|
| A: 단순 변화율 | 구현 간단, 직관적 | 노이즈에 민감할 수 있음 |
| B: 선형회귀 기울기 | 통계적으로 더 견고 | 구현 복잡도 증가 |

**Chosen:** A: 단순 변화율
**Reason:** 초기 구현은 단순하게 시작. Phase 판별의 핵심은 "MA150이 올라가고 있는가"이므로 단순 변화율로 충분. 필요 시 선형회귀로 업그레이드.

---

<!-- Architecture section will be added by /plan after codebase analysis -->
