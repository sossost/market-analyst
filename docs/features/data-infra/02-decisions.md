# Decisions: Data Infrastructure

**Created:** 2026-03-04

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

### 3. 섹터 분류 기준: FMP sector vs GICS vs 커스텀

| Option | Pros | Cons |
|--------|------|------|
| A: FMP symbols.sector | 기존 DB에 이미 있음, 추가 작업 없음 | 분류가 다소 거칠 수 있음 (11개 대분류) |
| B: GICS 하위 분류 | 더 세밀한 분류 (24 industry group) | 별도 매핑 테이블 필요, FMP에서 industry 필드 활용 |
| C: 커스텀 테마 기반 | "AI 인프라", "광통신" 등 테마 중심 | 분류 기준 주관적, 유지보수 부담 |

**Chosen:** A: FMP symbols.sector (대분류) + symbols.industry (소분류) 병행
**Reason:** 대분류(sector)로 전체 흐름을 보고, Agent가 관심 섹터를 발견하면 소분류(industry)로 드릴다운. 기존 DB 데이터 그대로 활용 가능. 커스텀 테마는 F3(Industry Intel)에서 Agent가 자유롭게 정의.

---

### 4. 섹터 브레드스 지표 선정

| Option | Pros | Cons |
|--------|------|------|
| A: MA정배열 + Phase2 + RS>50 + 신고가 4개 | 다각도 측정, 서로 보완적 | 계산량 많음 |
| B: Phase2 비율만 | 단순, Phase 판별에 이미 포함 | 단일 지표는 노이즈에 취약 |
| C: Advance/Decline ratio | 전통적 브레드스 지표 | 일별 변동이 커서 노이즈 많음 |

**Chosen:** A: 4개 지표 병행
**Reason:** 각 지표가 다른 관점을 측정. MA정배열=기술적 건강, Phase2=스테이지, RS>50=상대강도, 신고가=모멘텀. Agent가 종합 판단에 활용.

---

### 5. DB 테이블 위치: 같은 Supabase DB vs 별도 DB

| Option | Pros | Cons |
|--------|------|------|
| A: 같은 Supabase, 신규 테이블 | 기존 테이블 JOIN 가능, 인프라 비용 없음 | DB 결합도 증가 |
| B: 별도 DB 인스턴스 | 완전 분리, 장애 격리 | 기존 데이터 접근 불가 (복제 필요), 비용 증가 |

**Chosen:** A: 같은 Supabase, 신규 테이블
**Reason:** 섹터 RS 계산에 기존 daily_prices, symbols 테이블 JOIN이 필수. 별도 DB면 데이터 복제 필요. 신규 테이블은 prefix나 별도 schema로 구분 가능.

---

### 6. MA150 기울기 계산 방법

| Option | Pros | Cons |
|--------|------|------|
| A: 단순 변화율 (MA150[today] - MA150[20d ago]) / MA150[20d ago] | 구현 간단, 직관적 | 노이즈에 민감할 수 있음 |
| B: 선형회귀 기울기 (최근 20일 MA150에 대한 선형회귀) | 통계적으로 더 견고, 노이즈 필터링 | 구현 복잡도 증가 |

**Chosen:** A: 단순 변화율
**Reason:** 초기 구현은 단순하게 시작. Phase 판별의 핵심은 "MA150이 올라가고 있는가 내려가고 있는가"이므로 단순 변화율로 충분. 필요 시 선형회귀로 업그레이드.

---

<!-- Architecture section will be added by /plan after codebase analysis -->
