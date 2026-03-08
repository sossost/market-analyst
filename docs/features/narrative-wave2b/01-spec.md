# 서사 레이어 Wave 2b — 병목 이동 속도 추적

**이슈**: #90
**날짜**: 2026-03-08
**작성**: mission-planner
**선행 작업**: Wave 2a (PR #98 머지 완료)

---

## 선행 맥락

**Wave 2a 완료 현황 (PR #98):**

- 라운드 1 질문 프레임에 병목 생애주기(ACTIVE/RESOLVING/RESOLVED/OVERSUPPLY) 판단 섹션 추가됨
- 라운드 2 크로스파이어에 병목 판단 교차 검증 섹션 추가됨
- 라운드 3 합성 프롬프트에 "병목 생애주기 현황" 섹션 + `nextBottleneck` 작성 규칙 보강됨
- `newsLoader.ts`에 CAPEX 뉴스 `[CAPEX/설비투자 뉴스 — 병목 해소 신호 가능성 검토]` 태그 추가됨
- `theses` 테이블에 `nextBottleneck`, `consensusScore`, `dissentReason` 필드 존재
- thesis `category` 3분류 (`structural_narrative` / `sector_rotation` / `short_term_outlook`) 운영 중

**Wave 2a에서 명시적으로 연기된 것:**

Wave 2a 스펙 문서 발췌:
> "`narrative_chains`는 서사 체인을 독립 엔티티로 관리할 때 필요하다. DB 스키마 변경은 마이그레이션 비용이 발생하고, 데이터 없이 테이블만 만드는 것은 의미가 없다. **프롬프트 변경으로 4주 이상 데이터를 축적한 뒤, nextBottleneck 패턴이 실제로 나타나는지 확인 후 Wave 2b에서 narrative_chains 도입을 검토하는 것이 올바른 순서다.**"

Wave 2a가 2026-03-08 머지됐으므로, Wave 2b는 데이터 축적 타이밍을 고려하여 즉시 착수한다. `narrative_chains` 테이블은 이번에 구현하고, 병목 날짜 기록과 평균 해소 기간 계산은 시간이 지날수록 의미 있어진다 — 빠를수록 유리.

**RFC 1-C 원본 설계:**

`docs/RFC-narrative-layer.md` 1-C 항목에서 `narrative_chains` 스키마가 상세히 설계되어 있으며, Wave 2b는 이 설계의 핵심인 `bottleneck_identified_at` / `bottleneck_resolved_at` 필드 구현에 집중한다.

---

## 골 정렬

**ALIGNED**

- 병목 해소 타이밍 예측 → 이탈 판단 정밀화 → 알파 보존. 이것은 진입과 동등하게 중요하다.
- "언제 들어가는가"(Wave 1~2a)에 이어 "언제 나오는가"(Wave 2b)를 완성하면 사이클 전체를 커버한다.
- 6개월 후 "LLM 식별 시점 vs 시장 반영 시점의 시차(lead time)" 분석이 가능해진다. RFC 제안 10(메타 인사이트 Q1)의 핵심 데이터 기반.
- 데이터 축적형 기능이므로 시작이 빠를수록 의미 있는 데이터가 먼저 쌓인다.

---

## 문제

현재 시스템은 병목을 식별하고 다음 병목을 예측하지만, **각 병목이 언제 시작됐고 언제 끝났는지를 구조화된 방식으로 기록하지 않는다**. `theses.nextBottleneck`이 존재하지만 이것은 thesis 1개당 1개의 예측값이며, 병목을 독립 엔티티로 추적하는 개념이 없다.

결과적으로 "이 유형의 병목은 평균 몇 개월 후 해소되는가"를 계산할 방법이 없고, 이탈 타이밍의 예측 근거가 생기지 않는다.

---

## Before → After

**Before**
- 병목은 thesis의 필드(`nextBottleneck`) 안에만 존재. 텍스트로 기록되지만 생성일/해소일이 없음.
- 동일 병목이 여러 토론에서 반복 언급돼도 이를 하나의 연속적 체인으로 추적하는 엔티티가 없음.
- 이탈 타이밍 판단은 "현재 RESOLVING 신호가 보인다"는 정성적 판단에만 의존.
- 과거에 "이런 병목이 몇 달 만에 해소됐다"는 패턴을 참조할 데이터 구조가 없음.

**After**
- `narrative_chains` 테이블이 존재하여 병목을 독립 엔티티로 기록.
- `bottleneck_identified_at`(병목 최초 식별일)과 `bottleneck_resolved_at`(해소 확인일)이 축적됨.
- 토론 중 병목 상태가 ACTIVE → RESOLVING → RESOLVED로 전환될 때, 해당 날짜를 자동 기록.
- 체인 3개 이상 쌓인 후 "이 유형의 병목은 평균 N개월 후 해소된다"는 패턴 도출 가능.
- 주간 에이전트가 활성 체인 목록을 참조하여 "X병목이 식별된 지 N일 경과. 과거 유사 병목의 평균 해소 기간: Y일" 형태의 이탈 준비 신호를 생성.

---

## 변경 사항

### 변경 1: DB 마이그레이션 — `narrative_chains` 테이블 신설

RFC 1-C 설계를 기반으로 구현하되, **Wave 2b 범위에 맞게 핵심 필드만 포함하고 선택적 필드는 Wave 3+로 연기한다.**

Wave 2b 범위 필드 (필수):
```
narrative_chains:
  id (serial, PK)
  created_at (timestamp)
  megatrend           -- "AI 인프라 확장"
  demand_driver       -- "데이터센터 GPU 수요 급증"
  supply_chain        -- "GPU → HBM → 광트랜시버 → 전력" (텍스트)
  bottleneck          -- "광트랜시버 공급 부족" (현재 병목 노드)
  bottleneck_identified_at  -- 병목 최초 식별일 (timestamp, NOT NULL)
  bottleneck_resolved_at    -- 병목 해소 확인일 (timestamp, nullable)
  next_bottleneck           -- 예측된 다음 병목 (text, nullable)
  status              -- ACTIVE | RESOLVING | RESOLVED | OVERSUPPLY | INVALIDATED
  beneficiary_sectors -- JSON 배열 ["Optical Components", "Power Infrastructure"]
  beneficiary_tickers -- JSON 배열 ["LITE", "COHR", "VST"]
  linked_thesis_ids   -- JSON 배열 [thesis_id, ...]
  resolution_days     -- 해소까지 소요 일수 (해소 시 자동 계산, nullable)
```

Wave 3+로 연기 (복잡도 높음):
- `cross_trends` — 크로스 메가트렌드 교차점. RFC 1-G.
- `policy_signal_ids` — 정책 신호 연결. RFC 제안 4.

**판단 근거**: Wave 2b의 핵심 가치는 날짜 데이터 축적이다. 크로스 트렌드 매칭 자동화는 체인이 5개 이상 쌓인 후에 의미 있으므로 지금 구현할 필요가 없다.

### 변경 2: 토론 후 체인 자동 기록 (`thesisStore.ts`)

`thesisStore.ts`의 thesis 저장 로직에 `narrative_chains` 연동을 추가한다.

**로직:**
1. `structural_narrative` 카테고리 thesis가 저장될 때 실행.
2. 해당 thesis의 `nextBottleneck` 또는 병목 관련 내용을 파싱하여 체인 생성/업데이트.
3. 동일 병목 노드로 이미 ACTIVE 체인이 존재하면 `linked_thesis_ids`에 추가만 한다 (중복 생성 금지).
4. 신규 병목이면 `bottleneck_identified_at = NOW()`로 새 체인을 삽입.

**병목 동일성 판단**: `bottleneck` 필드 문자열을 완전 일치로 비교하지 않는다. LLM이 "광트랜시버"와 "Optical Transceiver"를 다르게 쓸 수 있으므로, **megatrend + bottleneck 키워드 기반 유사 매칭** 또는 **단순 LIKE 검색**으로 중복을 감지한다. 초기에는 단순하게: 동일 `megatrend`에서 `bottleneck` 텍스트가 70% 이상 겹치면 동일 체인으로 간주.

**상태 자동 전환:**
- thesis에서 `RESOLVING` 신호가 명시적으로 언급되면 → 해당 체인의 status를 `RESOLVING`으로 업데이트.
- thesis에서 `RESOLVED` 또는 `OVERSUPPLY`가 언급되면 → `bottleneck_resolved_at = NOW()`, `resolution_days` 자동 계산.

### 변경 3: 평균 해소 기간 계산 유틸리티 (`narrativeChainStats.ts` 신설)

```typescript
// src/lib/narrativeChainStats.ts
interface ChainStats {
  totalChains: number
  resolvedChains: number
  avgResolutionDays: number | null  // 해소된 체인 3개 미만이면 null
  medianResolutionDays: number | null
  chainsByMegatrend: Record<string, number>
}

async function getChainStats(): Promise<ChainStats>
async function getActiveChainsSummary(): Promise<ActiveChainSummary[]>
```

체인이 3개 미만이면 평균을 계산하지 않고 `null` 반환 — 신뢰할 수 없는 통계를 리포트에 주입하지 않기 위함.

### 변경 4: 주간 에이전트 프롬프트에 활성 체인 주입 (`run-weekly-agent.ts`)

기존 주간 에이전트 프롬프트에 활성 체인 요약을 추가한다.

**주입 형식 (체인 존재 시):**
```
## 현재 추적 중인 병목 체인

| 병목 노드 | 메가트렌드 | 식별일 | 경과일 | 상태 | 참고 해소 기간 |
|----------|----------|--------|-------|------|-------------|
| 광트랜시버 공급 부족 | AI 인프라 | 2026-01-15 | 52일 | ACTIVE | 데이터 축적 중 |
| 전력 인프라 부족 | AI 인프라 | 2026-02-20 | 17일 | ACTIVE | 데이터 축적 중 |

※ 해소된 체인이 3개 이상 쌓이면 "참고 해소 기간"에 평균 기간이 표시됩니다.
```

**체인이 없으면 이 섹션을 주입하지 않는다.** 빈 테이블을 주입하면 오히려 노이즈가 된다.

### 변경 5: 드리즐 ORM 스키마 + 마이그레이션

- `src/db/schema/analyst.ts`에 `narrativeChains` 테이블 정의 추가.
- `drizzle-kit generate` + `drizzle-kit migrate` 실행으로 마이그레이션 파일 생성 및 적용.

---

## 작업 계획

### Phase 1: DB 스키마 + 마이그레이션 (구현 에이전트)

**작업:**
- `src/db/schema/analyst.ts`에 `narrativeChains` 테이블 추가
- Drizzle 마이그레이션 파일 생성 및 적용 (`drizzle-kit generate && drizzle-kit migrate`)

**완료 기준:**
- `narrative_chains` 테이블이 Supabase DB에 존재
- Drizzle 스키마 타입 오류 없음
- 기존 마이그레이션에 충돌 없음

### Phase 2: 체인 기록 로직 + 통계 유틸 (구현 에이전트, Phase 1 완료 후)

**Phase 1 완료 후 병렬 진행 가능:**

**2-A. 체인 자동 기록 로직 (`thesisStore.ts` 또는 별도 `narrativeChainService.ts`)**
- `structural_narrative` thesis 저장 시 체인 생성/업데이트
- 중복 체인 감지 (megatrend + bottleneck 유사 매칭)
- 상태 전환 + 날짜 자동 기록

**2-B. 통계 유틸리티 (`narrativeChainStats.ts` 신설)**
- `getChainStats()` — 전체 통계 (평균 해소 기간 등)
- `getActiveChainsSummary()` — 활성 체인 요약 목록
- 체인 3개 미만 시 평균을 null로 반환하는 가드

**완료 기준:**
- thesis 저장 시 체인이 자동 생성/업데이트됨
- 상태 전환 시 날짜가 기록됨
- 통계 함수가 체인 수 부족 시 null을 반환함

### Phase 3: 주간 에이전트 연동 (구현 에이전트, Phase 2 완료 후)

**작업:**
- `src/agent/run-weekly-agent.ts`에서 `getActiveChainsSummary()` 호출
- 활성 체인이 존재할 때만 프롬프트 섹션 주입
- 참고 해소 기간 포맷: 데이터 3개+ → 평균 표시, 미만 → "데이터 축적 중"

**완료 기준:**
- 주간 에이전트 실행 시 활성 체인 섹션이 프롬프트에 포함됨
- 체인 없을 때는 섹션이 주입되지 않음

### Phase 4: 테스트 (구현 에이전트, Phase 2 완료 후)

**신규 테스트:**
- `narrativeChainService`: 중복 체인 감지 로직 단위 테스트 (동일 메가트렌드 + 유사 병목 노드)
- `narrativeChainStats`: 체인 3개 미만 시 null 반환 단위 테스트
- `narrativeChainStats`: 해소 기간 평균 계산 단위 테스트

**회귀 테스트:**
- 기존 `thesisStore` 테스트 전체 통과 (체인 기록 로직이 기존 thesis 저장 흐름을 깨지 않음)
- 기존 debate 테스트 전체 통과

Phase 3과 Phase 4는 병렬 진행 가능.

---

## 수용 기준 (Acceptance Criteria)

- [ ] `narrative_chains` 테이블이 DB에 존재하고 Drizzle 스키마와 일치함
- [ ] `structural_narrative` thesis 저장 시 체인이 자동 생성 또는 업데이트됨
- [ ] `bottleneck_identified_at`이 체인 최초 생성 시 기록됨
- [ ] 병목 상태 전환(RESOLVING/RESOLVED) 시 `bottleneck_resolved_at`이 기록됨
- [ ] `resolution_days`가 해소 시 자동 계산됨
- [ ] 주간 에이전트 프롬프트에 활성 체인 요약이 주입됨 (체인이 존재할 때만)
- [ ] 체인 3개 미만 시 평균 해소 기간이 `null` 반환됨 (신뢰할 수 없는 통계 노출 방지)
- [ ] 기존 테스트 전체 통과 (회귀 없음)
- [ ] 신규 로직에 대한 단위 테스트 추가

---

## 리스크

| 리스크 | 수준 | 대응 |
|--------|------|------|
| LLM이 병목 텍스트를 매번 다르게 표현하여 중복 체인 폭증 | 높음 | 유사 매칭 임계값(70%) 적용. 초기에는 관리자가 중복 체인을 주기적으로 점검하고 수동 병합. 4주 후 패턴 파악 후 임계값 조정 |
| 데이터 축적 전(체인 3개 미만) 기간의 통계 무의미 | 낮음 | null 반환 + "데이터 축적 중" 표시로 관리. 설계에 이미 반영됨 |
| `thesisStore.ts` 변경으로 기존 thesis 저장 흐름 영향 | 중간 | 체인 기록을 별도 서비스(`narrativeChainService.ts`)로 분리하여 `thesisStore`에서 단순 호출. 실패 시 로그만 남기고 thesis 저장 자체는 계속 진행 (에러 격리) |
| 토론이 structural_narrative thesis를 생성하지 않는 날 | 낮음 | 데이터 누락은 자연스러운 현상. 없는 날은 체인이 업데이트되지 않을 뿐, 시스템 오류 아님 |
| 해소 날짜 판단의 주관성 | 중간 | "RESOLVED"는 LLM이 판단. 오판 가능하지만 체인이 쌓일수록 오류가 평균으로 희석됨. 6개월 후 메타 분석에서 정확도 검증 |

---

## 의사결정 필요

없음 — 자율 판단으로 진행.

**자율 판단 결과 기록:**

1. **중복 체인 감지 방식**: 완전 문자열 일치 대신 유사 매칭(70% 임계값) 채택. 근거: LLM은 동일 개념을 다양한 표현으로 쓴다. 완전 일치는 무한한 중복 체인을 낳는다.

2. **Wave 3+ 연기 항목**: `cross_trends`, `policy_signal_ids` 필드는 지금 추가하지 않는다. 근거: 체인이 5개 이상 쌓이기 전에 교차 분석은 의미 없다. 빈 필드를 미리 추가하는 것은 복잡도만 늘린다.

3. **체인 생성 트리거**: `structural_narrative` 카테고리로 한정. 근거: `sector_rotation`이나 `short_term_outlook`에서 병목 체인을 추출하는 것은 설계 의도와 맞지 않는다. 서사 체인은 구조적 서사 thesis에만 연결되어야 한다.

4. **통계 최소 샘플 수 3개**: 근거: 2개면 평균이지 패턴이 아니다. 3개부터 표준편차가 의미 있어진다. RFC 이슈 본문에서도 "체인 3개+ 이후 의미 있음"으로 명시됨.

5. **체인 기록 실패 시 에러 격리**: 체인 기록 실패가 thesis 저장 실패로 이어지면 안 된다. 근거: thesis 저장은 토론의 핵심 결과물이고, 체인 기록은 부가 기능이다. 핵심 기능이 부가 기능에 종속되어 실패하는 구조는 잘못됐다.
