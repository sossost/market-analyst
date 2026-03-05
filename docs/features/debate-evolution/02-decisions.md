# Decisions: 에이전트 토론 & 진화 시스템

## Decision 1: 토론 구조

**Date:** 2026-03-05
**Status:** accepted

### Context
토론 라운드 수, 모더레이터 역할, 에이전트 수를 결정해야 함.

### Decision
- **4명 전문가 + 1명 모더레이터, 3라운드 고정**
- 라운드 1: 독립 분석 / 라운드 2: 교차 반박 / 라운드 3: 모더레이터 종합

### Rationale
- 시운전(2026-03-05)에서 4명 관점 차별화 충분히 확인
- 3명이면 관점 부족 (매크로+테크만으로는 지정학/심리 빠짐)
- 5명이면 비용 대비 한계효용 낮음
- 라운드 2는 자유형이면 비용 폭주, 3라운드가 최적

---

## Decision 2: Thesis 구조화 방식

**Date:** 2026-03-05
**Status:** accepted

### Decision
- 모더레이터가 라운드 3에서 thesis를 구조화
- timeframe은 30/60/90일 중 선택 (자유 설정 금지)

### Rationale
- 토론 에이전트가 직접 구조화하면 형식이 제각각
- 모더레이터가 표준화하면 DB 저장/검증 로직이 깔끔
- 고정 timeframe이면 검증 ETL의 cron 스케줄이 단순해짐

---

## Decision 3: 검증 방식

**Date:** 2026-03-05
**Status:** accepted

### Decision
- **규칙 기반 1차 판정 + 에이전트 보완**
- 수치 비교(RS 변화, 가격 변화 등)는 ETL 코드로 자동 판정
- "왜 맞았/틀렸나" 원인 분석은 에이전트가 보충

### Rationale
- 순수 에이전트 판정은 비용 높고 일관성 부족
- 순수 규칙 기반은 "부분 적중"이나 맥락 판단 불가
- 혼합이 비용 효율 + 판단 품질 최적

---

## Decision 4: 장기 기억 관리

**Date:** 2026-03-05
**Status:** accepted

### Decision
- 최대 50개 원칙 (토큰 ~4K)
- 승격 조건: 동일 패턴 3회 이상 적중
- 유효기간: 6개월, 적중률 하락 시 자동 강등
- 저장: 파일 기반 (`data/debate/learnings.json`)

### Rationale
- system prompt에 들어가야 하니 크기 제한 필수
- 3회 적중이면 우연이 아닌 패턴
- 시장 레짐 변화 시 과거 원칙이 해가 되므로 유효기간 필요
- DB보다 파일이 system prompt 주입에 간편

---

## Decision 5: 기존 주간 에이전트와의 관계

**Date:** 2026-03-05
**Status:** accepted

### Decision
- **단계적 전환**: 처음엔 병행 → 토론 품질 검증 후 통합

### Rationale
- 통합 시 토론 품질이 검증 안 된 상태에서 기존 주간 리포트가 망가질 수 있음
- 병행 기간 동안 토론 리포트 vs 기존 리포트 비교 가능
- 검증 후 자연스럽게 전환

---

## Decision 6: 토론 엔진 구현 위치

**Date:** 2026-03-05
**Status:** accepted

### Decision
- `src/agent/debate/` 디렉토리에 코드 기반 구현
- `.claude/agents/`의 system prompt를 코드에서 import하여 재사용

### Rationale
- GitHub Actions에서 자동 실행해야 하므로 코드 기반 필수
- `.claude/agents/`의 프롬프트를 CLI 자문용과 자동화용 양쪽에서 재사용
- 프롬프트 변경이 양쪽에 동시 반영되는 단일 소스

---

## Decision 7: 비용 관리

**Date:** 2026-03-05
**Status:** accepted

### Decision
- 전 과정 Sonnet 사용 (Opus 불필요)
- 목표: 토론 1회 < $3, 월 < $15

### Rationale
- 시운전에서 Sonnet으로도 충분한 품질 확인
- 라운드 1은 4명 병렬 → 4 API 호출
- 라운드 2는 4명 병렬 → 4 API 호출
- 라운드 3은 모더레이터 1 → 1 API 호출
- thesis 구조화 → 1 API 호출
- 총 ~10 API 호출 × $0.2~0.3 ≈ $2~3/회
