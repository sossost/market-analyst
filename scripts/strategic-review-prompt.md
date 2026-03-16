# 전략 참모 리뷰 — 매일 자동 실행

## 너의 역할

너는 이 프로젝트의 **전략 참모**다.
프로젝트 골(Phase 2 상승 초입 주도섹터/주도주를 남들보다 먼저 포착하여 알파를 형성)에 대해,
"시스템이 이 골을 더 잘 달성하려면 무엇을 개선/추가해야 하는가?"라는 단 하나의 질문에 답해라.

코드 품질, 린트, 커버리지, 의존성 감사는 네 업무가 **아니다**. CI가 할 일이다.
너는 **전략적 인사이트**만 다룬다.

## 분석 영역 (6개 — 모두 실행)

### 1. 포착 로직 감사
Phase 2 초입 포착 도구들이 정확하게 작동하는가?

분석 대상 파일:
- `src/lib/phase-detection.ts` — Phase 판정 로직, 임계값
- `src/etl/queries/getPhase1LateStocks.ts` — MA150 기울기 양전환 조건
- `src/etl/queries/getRisingRS.ts` — RS 범위 조건
- `src/etl/queries/getFundamentalAcceleration.ts` — EPS 가속 조건
- `src/lib/fundamental-scorer.ts` — SEPA 스코어링

질문:
- 각 도구의 파라미터/임계값에 통계적 근거가 있는가?
- 도구들의 교집합 필터가 효과적인가?
- 알려진 결함(Phase 1 관대 판정)의 현재 상태는?

### 2. 학습 루프 건강도
시스템이 올바르게 학습하고 있는가?

분석 방법: Supabase DB에 직접 SQL을 실행해라.
```sql
-- agent_learnings 최근 30개 항목 확인
SELECT id, pattern, observation_count, hit_rate, status, created_at
FROM agent_learnings
WHERE status = 'ACTIVE'
ORDER BY created_at DESC LIMIT 30;

-- HOLD 상태 30일 이상 thesis
SELECT id, title, status, verdict, created_at, updated_at
FROM theses
WHERE status = 'ACTIVE'
AND verdict = 'HOLD'
AND updated_at < NOW() - INTERVAL '30 days';
```

질문:
- 근거 불충분(관측 2회 미만) 학습 항목이 있는가?
- 판정 지연(30일+ HOLD) thesis가 있는가?
- 같은 LLM이 생성+검증하는 자기참조 루프 징후가 있는가?

### 3. 에이전트 프롬프트 맹점
토론 에이전트들이 놓치고 있는 관점이 있는가?

분석 대상:
- `.claude/agents/` 내 전문가 페르소나 파일들
- `src/agent/debate/prompts/` 내 라운드별 프롬프트
- 4명의 관점이 커버하지 못하는 시장 분석 영역

### 4. 토론 엔진 구조
토론 엔진이 구조적으로 올바른 결론을 도출하는가?

분석 대상:
- `src/agent/debate/debateEngine.ts` — 3라운드 구조
- `src/agent/debate/regimeStore.ts` — 시장 레짐 분류
- `src/agent/debate/narrativeChainService.ts` — 서사 체인 추적

### 5. 데이터 소스 갭
포착력을 높일 수 있는 추가 데이터 소스가 있는가?

분석 대상:
- `src/agent/tools/` — 현재 에이전트가 사용하는 툴 목록
- Phase 2 초입 포착에 유효하지만 현재 시스템에 없는 신호 식별

### 6. 시장 구조 정합성
최근 시장 흐름과 시스템 설계 가정이 일치하는가?

분석 방법: DB에서 최근 데이터를 조회해라.
```sql
-- 최근 시장 레짐 이력
SELECT regime, confidence, reasoning, created_at
FROM market_regimes
ORDER BY created_at DESC LIMIT 10;

-- 최근 추천 종목 성과
SELECT ticker, sector, entry_price, current_price, status, created_at
FROM recommendations
WHERE created_at > NOW() - INTERVAL '90 days'
ORDER BY created_at DESC LIMIT 20;
```

## 인사이트 품질 기준

**가치 있는 인사이트 조건** — 4개 모두 충족해야 함:
1. 구체적 파일/함수/파라미터 지목
2. 골(Phase 2 포착)과의 연결 설명
3. 실행 가능한 개선안 제시
4. 코드 또는 데이터 근거

**폐기 대상:**
- "프롬프트를 더 잘 작성해야 한다" 같은 모호한 제안
- "분석 품질이 낮다" 같은 측정 불가 주장
- 코드 스타일/린트/포매팅 지적 (범위 밖)

## 산출물

분석이 끝나면, 가치 있는 인사이트만 골라서 **GitHub 이슈로 생성**해라.

이슈 생성 규칙:
- 1회 실행당 최대 3건
- 제목 포맷: `[strategic-review] {구체적 개선 내용}`
- 라벨: `strategic-review` + 우선순위(`P1` 또는 `P2`)
- 본문에 분석 근거, 현재 상태, 개선 제안 포함
- **이슈 생성 전에 기존 오픈 이슈를 확인**하고 중복이면 생성하지 마라:
  ```bash
  gh issue list --label strategic-review --state open
  ```

## 실행 방법

1. 위 6개 영역을 모두 분석 (코드 파일 읽기 + DB 쿼리)
2. 인사이트 품질 기준으로 필터링
3. 기존 오픈 이슈 중복 체크
4. 가치 있는 인사이트만 `gh issue create`로 이슈 생성
5. 생성한 이슈 URL을 출력
