# Spec: 에이전트 토론 & 진화 시스템 (내각 시스템)

## Purpose

4명의 전문가 에이전트가 라운드 기반 토론을 수행하고, 토론 결과에서 추출된 thesis를 시장 데이터로 자동 검증하며, 검증된 원칙을 장기 기억으로 축적해 에이전트의 분석 수준이 시간이 지날수록 우상향하는 시스템.

## Requirements

### Functional

#### 토론 엔진
- [ ] 4명 전문가 + 1명 모더레이터가 3라운드 토론 수행
- [ ] 라운드 1: 독립 분석 (4명이 동일 질문에 각자 답변)
- [ ] 라운드 2: 교차 검증 (4명이 서로의 분석을 읽고 반박/보완)
- [ ] 라운드 3: 모더레이터가 합의/불일치 정리 + thesis 구조화
- [ ] 각 에이전트는 웹 검색(`searchCatalyst` 또는 WebSearch)으로 실시간 데이터 활용
- [ ] 장기 기억을 토론 시작 시 system prompt에 주입

#### Thesis Ledger
- [ ] 토론에서 나온 주장을 검증 가능한 형태로 DB 저장
- [ ] 필수 필드: thesis 문장, 발언 에이전트, timeframe (30/60/90일), 검증 지표, 달성 조건, 무효화 조건, 확신도
- [ ] 상태: ACTIVE → CONFIRMED / INVALIDATED / EXPIRED

#### 자동 검증 루프
- [ ] 주간 ETL로 ACTIVE thesis 중 timeframe 도래한 건 자동 검증
- [ ] 규칙 기반 1차 판정 (수치 비교) + 에이전트 보완 (원인 분석)
- [ ] 검증 결과: 적중/빗나감/부분적중 + 원인 기록

#### Evolving Memory (장기 기억)
- [ ] 동일 패턴 3회 이상 적중 시 "검증된 원칙"으로 승격
- [ ] 반복적으로 빗나가는 패턴은 "경계 패턴"으로 분류
- [ ] 장기 기억 최대 50개 원칙 (토큰 ~4K 이내)
- [ ] 6개월 유효기간, 적중률 하락 시 자동 강등/제거
- [ ] 장기 기억은 DB 저장 (`agent_learnings` 테이블) + system prompt 주입 시 로드

#### 리포트 발송
- [ ] 모더레이터 종합 결과를 기존 리뷰 파이프라인(reviewAgent)으로 전달
- [ ] 기존 Discord/Gist 발송 채널 그대로 사용

### Non-Functional
- [ ] 주 1회 실행 (토요일, 기존 주간 에이전트와 동일 타이밍)
- [ ] Sonnet 기반 (월 ~$8 추가 비용)
- [ ] 토론 1회 총 소요 시간 < 10분

## Scope

**In scope:**
- 토론 엔진 (라운드 기반, 코드 구현)
- Thesis Ledger DB 스키마 + 저장/조회
- 자동 검증 ETL
- 장기 기억 파일 관리
- 기존 주간 에이전트와 병행 운영 (단계적 전환)

**Out of scope:**
- CLI 기반 실시간 토론 (이건 `.claude/agents/`로 수동 가능, 별도 구현 불필요)
- 장관 추가/교체 자동화 (수동으로 충분)
- 실시간 시장 이벤트 트리거 토론 (Phase 2에서 고려)

## Design

### 토론 엔진 아키텍처

```
src/agent/debate/
├── debateEngine.ts        # 3라운드 토론 오케스트레이션
├── personas.ts            # 4 전문가 + 1 모더레이터 system prompt
├── round1-independent.ts  # 라운드 1: 독립 분석
├── round2-crossfire.ts    # 라운드 2: 교차 검증
├── round3-synthesis.ts    # 라운드 3: 모더레이터 종합
├── thesisExtractor.ts     # thesis 구조화 + DB 저장
└── memoryLoader.ts        # 장기 기억 로드/저장
```

### 토론 흐름

```
1. memoryLoader: 장기 기억 + 최근 thesis 검증 결과 로드
2. round1: 4명에게 동일 질문 → 4개 독립 분석 (병렬)
3. round2: 4명에게 다른 3명의 분석 전달 → 반박/보완 (병렬)
4. round3: 모더레이터에게 라운드1+2 전체 전달 → 종합
5. thesisExtractor: 모더레이터 결과에서 thesis 추출 → DB 저장
6. reviewAgent: 모더레이터 리포트를 리뷰 파이프라인으로 전달
7. memoryLoader: 이번 토론 결과 반영하여 기억 업데이트
```

### DB 스키마

```sql
-- Thesis Ledger
CREATE TABLE theses (
  id SERIAL PRIMARY KEY,
  debate_date DATE NOT NULL,
  agent_persona TEXT NOT NULL,          -- 'macro' | 'tech' | 'geopolitics' | 'sentiment'
  thesis TEXT NOT NULL,                 -- 검증 가능한 예측 문장
  timeframe_days INT NOT NULL,          -- 30 | 60 | 90
  verification_metric TEXT NOT NULL,    -- 검증에 사용할 지표
  target_condition TEXT NOT NULL,       -- 달성 조건
  invalidation_condition TEXT,          -- 무효화 조건
  confidence TEXT NOT NULL,             -- 'low' | 'medium' | 'high'
  consensus_level TEXT NOT NULL,        -- '4/4' | '3/4' | '2/4' | '1/4'
  status TEXT NOT NULL DEFAULT 'ACTIVE', -- ACTIVE | CONFIRMED | INVALIDATED | EXPIRED
  verification_date DATE,
  verification_result TEXT,             -- 검증 결과 상세
  close_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 장기 기억 (검증된 원칙)
CREATE TABLE agent_learnings (
  id SERIAL PRIMARY KEY,
  principle TEXT NOT NULL,              -- 검증된 원칙 문장
  category TEXT NOT NULL,               -- 'confirmed' | 'caution'
  hit_count INT NOT NULL DEFAULT 0,     -- 적중 횟수
  miss_count INT NOT NULL DEFAULT 0,    -- 빗나감 횟수
  hit_rate NUMERIC(3,2),                -- 적중률
  source_thesis_ids INT[],              -- 근거가 된 thesis ID 목록
  first_confirmed DATE,                 -- 최초 승격일
  last_verified DATE,                   -- 최근 검증일
  expires_at DATE,                      -- 유효기간 (first_confirmed + 6개월)
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### API (Agent Tools)

| 도구 | 용도 |
|------|------|
| `saveThesis` | 토론 결과 thesis를 DB에 저장 |
| `readActiveTheses` | ACTIVE 상태 thesis 조회 |
| `verifyThesis` | thesis 검증 결과 업데이트 |
| `readLearnings` | 장기 기억 (검증된 원칙) 조회 |
| `updateLearning` | 원칙 적중/빗나감 업데이트 |

### 기존 주간 에이전트와의 관계

**Phase 1 (병행):**
- 기존 `run-weekly-agent.ts`는 그대로 유지
- 새로운 `run-debate-agent.ts` 추가 — 토요일 별도 실행
- 토론 리포트는 별도 Discord 채널 또는 같은 채널에 추가 발송

**Phase 2 (통합, 토론 품질 검증 후):**
- `run-weekly-agent.ts`가 토론 엔진을 호출
- 기존 단일 에이전트 분석을 토론 기반 분석으로 대체
- 리포트 포맷: "4명 합의/불일치 기반" 구조화 리포트

## Error Handling

| 시나리오 | 대응 |
|----------|------|
| 개별 에이전트 API 실패 | 해당 라운드에서 3명으로 진행, 로그 기록 |
| 모더레이터 실패 | 라운드 1+2 원문을 그대로 리뷰 파이프라인에 전달 |
| thesis 파싱 실패 | 보수적으로 빈 thesis 저장, 수동 리뷰 |
| 검증 데이터 부재 | EXPIRED로 전환, 검증 불가 사유 기록 |

## Acceptance Criteria

- [ ] 4명 에이전트가 3라운드 토론을 완료하고 모더레이터가 종합 리포트 생성
- [ ] 최소 3개 이상의 검증 가능한 thesis가 DB에 저장됨
- [ ] 장기 기억이 다음 토론 시 system prompt에 정상 주입됨
- [ ] 기존 주간 에이전트와 병행 실행 시 충돌 없음
- [ ] 토론 1회 총 비용 < $3 (Sonnet 기준)
