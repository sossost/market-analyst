# 서사 레이어 Wave 1 — 수요-공급-병목 프레임 + Thesis 카테고리

이슈: #76 (N-1a), #77 (N-1b)
RFC 참조: `docs/RFC-narrative-layer.md` 제안 1-A, 1-B

---

## 선행 맥락

- `docs/RFC-narrative-layer.md` — 전체 서사 레이어 로드맵. 이번 기획은 Wave 1의 두 항목(1-A, 1-B)만 다룬다.
- Wave 1 설계 원칙: "코드 변경 최소, 프롬프트/스키마만 수정. 서사 데이터 축적은 하루라도 빨리 시작."
- 교집합이 최강 필터 (PR #61 검증 결과): 기술적 신호 단독보다 서사 교집합이 강력하다는 증거가 이미 있음.
- 토론 시스템은 5개 애널리스트 (macro, tech, geopolitics, sentiment, moderator). 라운드1 프롬프트는 `.claude/agents/*.md` 파일의 systemPrompt 바디로 구성.
- theses 테이블 현재 구조: `debate_date`, `agent_persona`, `thesis`, `timeframe_days` (30|60|90), `confidence`, `consensus_level`, `status` 등. `category` 컬럼 없음.
- `round3-synthesis.ts`의 `VALID_TIMEFRAMES = {30, 60, 90}` — category별 기본 timeframe 도입 시 이 유효값 집합을 확장하거나, 카테고리를 별도 필드로 추가해야 함.
- 기존 마이그레이션 디렉토리: `drizzle/` 없음. `src/db/migrate.ts`가 있으며 Drizzle Kit (`drizzle.config.ts`) 방식으로 마이그레이션 관리.

---

## 골 정렬

**ALIGNED** — 직접 기여.

PLTR(23), NVDA(24), MU/LITE(25) 같은 알파 종목은 기술적 신호 이전에 구조적 서사(수요 폭발 → 공급 체인 → 병목)가 먼저 존재했다. 현재 시스템은 이 서사적 맥락을 체계적으로 다루지 않는다. 이번 미션은:

1. 라운드1 프롬프트에 수요-공급-병목 질문 프레임을 삽입하여, 토론 에이전트가 "시장 논평"이 아니라 "구조적 수요 → 공급 체인 → 병목 → 수혜 기업" 체인을 도출하도록 유도한다.
2. thesis에 카테고리를 부여하여, 구조적 서사(8~12주)와 단기 전망(1~2주)의 검증 주기를 분리한다.

두 변경 모두 Phase 2 초입 포착을 위한 선행 신호 레이어를 강화한다.

---

## 문제

토론 에이전트가 현재 구조적 수요-공급-병목 체인을 체계적으로 분석하지 않아, 기술적 신호보다 앞서 나타나는 서사적 선행 신호를 놓치고 있다. 또한 단기 전망과 구조적 서사가 동일한 timeframe(30/60/90일)으로 관리되어 카테고리별 적중률 추적이 불가능하다.

---

## Before → After

**Before**

- 라운드1: 4명 애널리스트가 자유 분석. 수요-공급-병목 체인 언급은 우연에 의존.
- 뉴스 수집: 정책/규제 키워드 없음 (bill, regulation, tariff, subsidy 미포함).
- thesis: category 필드 없음. 모든 thesis가 동일 버킷에서 만료 처리.
- 통계: 전체 적중률만 집계 가능. 서사 thesis vs 단기 전망 thesis 성과 비교 불가.

**After**

- 라운드1: 각 애널리스트가 자신의 관점에서 수요-공급-병목 4가지 질문에 답하도록 유도하는 프레임이 systemPrompt에 추가됨.
- 뉴스 수집: geopolitics 및 macro 쿼리에 정책/규제 키워드 추가 (bill, regulation, tariff, subsidy, executive order 등).
- thesis: `category` 컬럼 추가. `structural_narrative`(8~12주), `sector_rotation`(2~4주), `short_term_outlook`(1~2주).
- 라운드3: 모더레이터가 thesis 추출 시 카테고리를 자동 분류하여 JSON에 포함.
- 통계: 카테고리별 적중률 분리 조회 가능.
- 기존 thesis: `short_term_outlook`으로 기본값 마이그레이션.

---

## 변경 사항

### N-1a: 프롬프트 프레임 + 뉴스 쿼리 확장

1. **`.claude/agents/macro-economist.md`** — systemPrompt 바디에 수요-공급-병목 분석 섹션 추가.
2. **`.claude/agents/tech-analyst.md`** — 동일.
3. **`.claude/agents/geopolitics.md`** — 동일. + 정책/규제 관점 질문 강화.
4. **`.claude/agents/sentiment-analyst.md`** — 동일.
5. **`src/agent/debate/newsCollector.ts`** — `SEARCH_QUERIES`에 정책/규제 키워드 추가.
   - `geopolitics`: `"US trade bill regulation tariff subsidy semiconductor latest"` 등 추가.
   - `macro`: `"fiscal policy federal spending executive order economic impact"` 등 추가.

### N-1b: Thesis 카테고리 분리

6. **`src/types/debate.ts`** — `ThesisCategory` 타입 추가. `Thesis` 인터페이스에 `category` 필드 추가.
7. **`src/db/schema/analyst.ts`** — `theses` 테이블에 `category` 컬럼 추가 (`text`, nullable, 기존 데이터 호환).
8. **`src/agent/debate/round3-synthesis.ts`**
   - `buildSynthesisPrompt`: thesis JSON 스키마에 `category` 필드 추가 + 분류 기준 설명 삽입.
   - `isValidThesis`: `category` 유효성 검증 추가.
   - `VALID_TIMEFRAMES`: 카테고리별 기본값과 연동 — structural_narrative는 60~90, sector_rotation은 30~60, short_term_outlook은 30.
9. **`src/agent/debate/thesisStore.ts`**
   - `saveTheses`: `category` 필드 포함하여 저장.
   - `getThesisStatsByCategory`: 카테고리별 status 집계 쿼리 추가.
   - `formatThesesForPrompt`: 카테고리 레이블 포함 출력.
10. **DB 마이그레이션** — `theses.category` 컬럼 추가 + 기존 rows `short_term_outlook` 기본값 설정.

---

## 작업 계획

### 태스크 1 — DB 스키마 + 마이그레이션 [실행팀]

완료 기준:
- `src/db/schema/analyst.ts`의 `theses` 테이블에 `category text` 컬럼 추가.
- Drizzle Kit으로 마이그레이션 파일 생성 (`drizzle-kit generate`).
- 마이그레이션 실행 후 기존 rows에 `category = 'short_term_outlook'` 기본값 적용 (SQL UPDATE).
- `src/types/debate.ts`에 `ThesisCategory = 'structural_narrative' | 'sector_rotation' | 'short_term_outlook'` 타입 추가.
- `Thesis` 인터페이스에 `category: ThesisCategory` 필드 추가.

의존성: 없음 (독립 태스크, 먼저 완료해야 이후 태스크가 진행 가능).

### 태스크 2 — 라운드1 애널리스트 프롬프트 수정 [실행팀]

완료 기준:
- 4개 애널리스트 파일(`.claude/agents/` 내 macro, tech, geopolitics, sentiment)에 수요-공급-병목 4가지 질문 프레임 추가.
- 각 애널리스트의 관점에 맞게 프레임 표현을 조정 (macro: 거시 수요 구조, tech: 기술 공급 체인, geopolitics: 정책/규제 촉발 요인, sentiment: 시장 인식 전환 시점).
- 프롬프트 추가 텍스트는 기존 분석 항목의 마지막 섹션에 삽입하여 기존 분석 흐름을 방해하지 않음.
- 4가지 공통 질문:
  1. 현재 가장 큰 구조적 수요 변화는 무엇인가?
  2. 그 수요를 충족시키는 공급 체인은 어떻게 구성되어 있는가?
  3. 병목은 어디인가? (현재 또는 예상되는 제약)
  4. 그 병목을 해소하는/수혜를 받는 기업/섹터는?

의존성: 없음 (태스크 1과 병렬 실행 가능).

### 태스크 3 — 뉴스 쿼리 확장 [실행팀]

완료 기준:
- `src/agent/debate/newsCollector.ts`의 `SEARCH_QUERIES` 수정.
- `geopolitics`에 정책/규제 키워드 쿼리 1개 추가: `"US legislation bill regulation tariff subsidy sector impact latest"`.
- `macro`에 재정 정책 쿼리 1개 추가: `"fiscal policy federal budget executive order economic structural impact"`.
- 기존 쿼리 2개/persona 유지. 신규 쿼리 추가로 geopolitics 3개, macro 3개로 확장.

의존성: 없음 (태스크 1, 2와 병렬 실행 가능).

### 태스크 4 — 라운드3 synthesis 수정 [실행팀]

완료 기준:
- `buildSynthesisPrompt`의 thesis JSON 스키마에 `"category"` 필드 추가.
- 분류 기준 설명 삽입:
  - `structural_narrative`: 수요-공급-병목 서사 기반 전망. 기본 timeframe 60~90일.
  - `sector_rotation`: 섹터 로테이션 전망. 기본 timeframe 30~60일.
  - `short_term_outlook`: 단기 시장/지수 전망. 기본 timeframe 30일.
- `isValidThesis`에 `category` 유효성 검증 추가 (3개 값 중 하나).
- `VALID_CATEGORIES` Set 추가.

의존성: 태스크 1 완료 후 진행 (ThesisCategory 타입 필요).

### 태스크 5 — thesisStore 수정 [실행팀]

완료 기준:
- `saveTheses`: insert rows에 `category` 포함.
- `getThesisStatsByCategory`: `category`별 status 집계 반환 함수 추가.
- `formatThesesForPrompt`: 출력 라인에 category 레이블 포함 (예: `[STRUCTURAL]`, `[ROTATION]`, `[SHORT]`).

의존성: 태스크 1 완료 후 진행.

### 태스크 6 — 토큰 증가량 측정 + 테스트 업데이트 [실행팀]

완료 기준:
- 기존 round1/round3 단위 테스트에서 `category` 필드를 포함하는 mock 데이터 업데이트.
- `isValidThesis` 테스트에 category 유효성 케이스 추가.
- `extractThesesFromText` 테스트에 category 파싱 케이스 추가.
- 프롬프트 토큰 증가량을 로그로 기록 (라운드1 실행 시 기존 대비 증가분 INFO 로그).
- 전체 테스트 통과 (기존 555개 + 신규 케이스).

의존성: 태스크 4, 5 완료 후 진행.

---

## 병렬 실행 계획

```
태스크 1 (DB + 타입)  ─────────────────┐
태스크 2 (프롬프트)  ──────────────────┤ → 태스크 4 (round3) ─┐
태스크 3 (뉴스 쿼리) ──────────────────┘                      │
                                                              └→ 태스크 5 (store) → 태스크 6 (테스트)
```

태스크 1, 2, 3은 완전 독립 — 병렬 실행.
태스크 4, 5는 태스크 1 완료 후 진행 (타입 의존).
태스크 6은 4, 5 완료 후 진행.

---

## 리스크

1. **VALID_TIMEFRAMES 충돌**: 현재 라운드3가 timeframeDays를 `30 | 60 | 90`만 허용한다. category별 기본 timeframe을 도입할 때, 모더레이터가 "structural_narrative라 90일"이라고 판단하는 것과 기존 유효값(90)이 충돌하지 않도록 매핑을 명확히 해야 한다. structural_narrative → 90, sector_rotation → 60, short_term_outlook → 30으로 매핑하면 기존 유효값 내에서 처리 가능.

2. **모더레이터 카테고리 분류 신뢰도**: LLM이 thesis를 카테고리로 자동 분류할 때 일관성이 낮을 수 있다. 초기에는 분류 결과를 관찰하고, 오분류율이 높으면 프롬프트 예시를 강화한다. 카테고리 오분류는 데이터 정합성 문제이지 시스템 장애가 아니므로 블로커가 아님.

3. **프롬프트 토큰 증가**: 4개 애널리스트 파일에 수요-공급-병목 섹션 추가 시 라운드1 토큰이 증가한다. RFC 추정 기준 섹션당 100~150토큰, 4명 × 150 = ~600 input 토큰/일 증가. 비용 영향 미미.

4. **기존 thesis 마이그레이션**: 기존 ACTIVE thesis에 category 기본값을 `short_term_outlook`으로 설정하면 만료 로직(`expireStaleTheses`)이 기존과 동일하게 동작한다. 영향 없음.

---

## 의사결정 필요

없음 — 바로 구현 가능.

RFC의 카테고리 정의와 timeframe 매핑이 명확하고, 기존 인프라(theses 테이블, round3 JSON 파싱, Drizzle 스키마) 위에서 최소 변경으로 구현 가능하다.
