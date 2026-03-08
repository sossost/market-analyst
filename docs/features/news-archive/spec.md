# News Archive — 뉴스 상시 수집 + 키워드 분류 + DB 축적

## 선행 맥락

없음 — 뉴스 아카이브는 신규 기능. 단, 연관 컨텍스트:

- **현재 뉴스 수집 방식**: `newsCollector.ts`가 토론 직전 Brave Search로 10개 쿼리 실행 → 최대 50건 수집 → 메모리에서 바로 소비 후 휘발. URL 없이 title+description+age만 저장.
- **토론 에이전트 내 on-demand 검색**: `braveSearch.ts`가 라운드 중 `web_search`/`news_search` 툴로 추가 검색. 이것도 휘발.
- **`debate_sessions.news_context`**: 현재 newsContext를 JSON으로 이미 저장하고 있으나, 수집 당시 구조화(분류/감성)는 없음. text blob.
- **Brave API 쿼터**: Pro 플랜 기준 월 2,000 queries 무료. 현재 토론 당 10 queries × 주 5회 = 주 50 queries ≈ 월 200 queries. 6시간마다 수집 시 하루 4회 × 10 queries × 30일 = 월 1,200 queries. 합산 월 1,400 queries — Pro 2,000 범위 내.
- **맥미니 launchd 체계**: `setup-launchd.sh` + plist 파일 패턴. `__PROJECT_DIR__` 플레이스홀더 치환. 신규 plist 추가 후 스크립트에 PLISTS 배열 항목 1개 추가하면 됨.
- **관련 후속 이슈**: #95(정책·규제 감지), #89(공급 과잉), #93(섹터 시차) — 이들이 news_archive를 데이터 소스로 사용할 예정.

---

## 골 정렬

**ALIGNED** — Phase 2 상승 초입을 남들보다 먼저 포착하는 데 직접 기여.

뉴스-시장 반응 패턴 축적이 핵심 근거:
- 정책/기술 변화 뉴스가 섹터 RS 상승으로 전환되는 리드타임을 과거 데이터로 학습 가능
- 토론 에이전트가 실시간 검색 대신 DB에서 맥락 있는 뉴스를 조회 → 분석 품질 향상
- #95(정책 감지), #89(공급 과잉), #93(섹터 시차) 등 후속 이슈의 데이터 기반 제공

단, 뉴스 아카이브 자체는 인프라다. 직접적인 Phase 2 포착 알파는 이 인프라를 활용하는 후속 이슈에서 발생한다. 인프라 구축에 걸리는 비용 대비 효과를 명확히 인식하고 진행.

---

## 문제

토론 에이전트가 Brave Search를 매 토론마다 실시간 호출하여 뉴스를 수집하지만, 수집된 뉴스는 해당 토론 세션에서만 소비되고 즉시 휘발된다. 이로 인해 과거 뉴스-시장 반응 패턴을 학습할 수 없고, 후속 이슈(정책 감지, 공급 과잉, 섹터 시차)가 필요로 하는 구조화된 뉴스 데이터 소스가 존재하지 않는다.

---

## Before → After

**Before**
```
토론 직전: newsCollector.ts → Brave Search 10 queries → 메모리 → 토론 → 휘발
토론 중:   braveSearch.ts   → Brave Search N queries → 응답 텍스트 → 휘발
저장: debate_sessions.news_context (비구조화 JSON text blob)
```

**After**
```
6시간마다: news-collector-job → Brave Search 10 queries → 중복 제거 → 분류 → news_archive DB
토론 직전: newsLoader.ts → DB에서 최근 24h 뉴스 조회 → 토론 에이전트 주입
토론 중:   braveSearch.ts → 유지 (on-demand 검색은 그대로)
저장: news_archive (URL, 분류, 감성, 수집 시각 포함)
```

---

## 변경 사항

### Phase 1 — DB 스키마 + 수집 파이프라인 (핵심)

**1-1. DB 테이블: `news_archive`**

```typescript
export const newsArchive = pgTable(
  "news_archive",
  {
    id: serial("id").primaryKey(),

    // 원본 데이터
    url: text("url").notNull(),               // 중복 제거 기준
    title: text("title").notNull(),
    description: text("description"),
    source: text("source"),                    // hostname (예: reuters.com)
    publishedAt: text("published_at"),         // Brave가 제공하는 age 문자열 or ISO datetime
    collectedAt: timestamp("collected_at", { withTimezone: true }).defaultNow().notNull(),

    // 분류 (키워드 룰 기반)
    category: text("category").notNull(),
    // 'POLICY' | 'TECHNOLOGY' | 'MARKET' | 'GEOPOLITICAL' | 'CAPEX' | 'OTHER'

    // 감성 (키워드 룰 기반)
    sentiment: text("sentiment").notNull(),
    // 'POS' | 'NEU' | 'NEG'

    // 연관 쿼리 카테고리 (어떤 persona 쿼리에서 수집됐는지)
    queryPersona: text("query_persona"),       // 'macro' | 'tech' | 'geopolitics' | 'sentiment'
    queryText: text("query_text"),             // 원본 검색 쿼리

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uqUrl: unique("uq_news_archive_url").on(t.url),               // URL 기반 중복 제거
    idxCollectedAt: index("idx_news_archive_collected_at").on(t.collectedAt),
    idxCategory: index("idx_news_archive_category").on(t.category),
    idxSentiment: index("idx_news_archive_sentiment").on(t.sentiment),
    idxPersona: index("idx_news_archive_persona").on(t.queryPersona),
  }),
);
```

**설계 판단:**
- URL unique constraint로 중복 제거. title 기준(현재 newsCollector.ts)보다 신뢰성 높음.
- Brave API가 URL을 항상 반환하므로 의존 안전.
- 구분: `category`는 "뉴스가 다루는 주제", `queryPersona`는 "어떤 쿼리로 수집됐는지". 다를 수 있음 (tech 쿼리로 수집됐지만 POLICY 뉴스일 수 있음).
- 감성 분류는 키워드 룰 기반. LLM 호출 없음 — 비용 0, 속도 빠름. 정확도 70% 수준이나 대량 처리에 충분.
- `publishedAt`: Brave는 `age` 필드로 "2 hours ago" 형식 제공. 파싱하여 ISO datetime 변환 시도, 실패 시 null 허용.

**1-2. `src/etl/jobs/collect-news.ts`**

신규 ETL 잡. 기존 `newsCollector.ts`의 Brave Search 로직을 재사용하되, URL 포함 + 중복 제거 + 분류 + DB upsert 추가.

```
collect-news.ts 구조:
  1. SEARCH_QUERIES (기존과 동일한 10개 쿼리)
  2. 각 쿼리 실행 → URL 포함 결과 수집
  3. URL unique check → DB에 없는 것만 분류
  4. classifyCategory(title + description) → POLICY/TECHNOLOGY/MARKET/GEOPOLITICAL/CAPEX/OTHER
  5. classifySentiment(title + description) → POS/NEU/NEG
  6. DB upsert (on conflict do nothing)
  7. 수집 건수 로깅
```

**키워드 분류 규칙 (초안):**

```
POLICY: ['federal reserve', 'fed', 'rate', 'tariff', 'regulation', 'legislation', 'subsidy', 'executive order', 'treasury', 'fiscal']
TECHNOLOGY: ['ai', 'artificial intelligence', 'semiconductor', 'chip', 'gpu', 'cloud', 'data center', 'software', 'tech earnings']
GEOPOLITICAL: ['china', 'taiwan', 'russia', 'ukraine', 'trade war', 'sanctions', 'nato', 'supply chain', 'geopolit']
CAPEX: ['capex', 'capital expenditure', 'investment', 'spending', 'infrastructure', 'hyperscaler']
MARKET: ['market', 'stocks', 'earnings', 'vix', 'sentiment', 'fund flow', 'etf', 'institutional']
OTHER: 위 어느 것도 아닌 경우
```

우선순위: POLICY > TECHNOLOGY > GEOPOLITICAL > CAPEX > MARKET > OTHER (앞 카테고리 매칭 시 즉시 반환)

```
POS: ['surge', 'rally', 'beat', 'record', 'growth', 'upside', 'outperform', 'bullish', 'strong', 'gain']
NEG: ['fall', 'drop', 'miss', 'recession', 'decline', 'bearish', 'weak', 'risk', 'concern', 'warning', 'cut']
NEU: 위 어느 것도 없는 경우
```

**1-3. `src/etl/jobs/cleanup-news-archive.ts`**

30일 이상 된 뉴스 삭제 (DB 무한 증가 방지).

```sql
DELETE FROM news_archive WHERE collected_at < NOW() - INTERVAL '30 days'
```

**1-4. launchd plist: `com.market-analyst.news-collect.plist`**

```xml
<!-- KST 00:00, 06:00, 12:00, 18:00 매일 (UTC 15:00, 21:00, 03:00, 09:00) -->
```

6시간 간격, 매일 실행. 주말 포함 (뉴스는 주말에도 발생).

**1-5. `setup-launchd.sh` PLISTS 배열에 항목 추가**

```bash
"com.market-analyst.news-collect"
```

---

### Phase 2 — 토론 에이전트 연동

**2-1. `src/agent/debate/newsLoader.ts` (신규)**

DB에서 최근 24h 뉴스를 조회하여 토론 프롬프트 형식으로 반환. 기존 `newsCollector.ts`의 `formatNewsForPersona`와 동일한 출력 형식 유지.

```typescript
// persona별 관련 뉴스 조회
// queryPersona = persona OR category가 persona 영역에 해당하는 것
// collectedAt >= NOW() - 24h
// 최대 15건 per persona (현재 newsCollector.ts는 10-15건)

export async function loadNewsForPersona(
  persona: 'macro' | 'tech' | 'geopolitics' | 'sentiment',
  hoursBack: number = 24,
): Promise<string>
```

persona → category 매핑:
- `macro` → POLICY, MARKET
- `tech` → TECHNOLOGY, CAPEX
- `geopolitics` → GEOPOLITICAL, POLICY
- `sentiment` → MARKET

**2-2. `src/agent/run-debate-agent.ts` 수정**

Step [4/9] 뉴스 수집 부분:

```typescript
// Before (휘발):
const news = await collectNews();
newsContext[persona] = formatNewsForPersona(persona, news);

// After (DB 조회):
newsContext[persona] = await loadNewsForPersona(persona);
```

**폴백 처리**: DB 뉴스가 0건(수집 잡 미실행 등)이면 기존 `collectNews()` 실시간 호출로 폴백. 토론이 뉴스 없이 진행되는 상황 방지.

**2-3. `newsCollector.ts` 보존**

삭제하지 않음. 폴백 + 테스트 목적으로 유지. 단, URL 필드 추가 (Phase 1에서 `collect-news.ts`가 URL을 사용하므로 공통화 고려).

---

### Phase 3 — 정리 및 확장 준비 (선택적)

**3-1. 후속 이슈 연결 인터페이스**

#95, #89, #93이 사용할 공통 조회 함수:

```typescript
// src/agent/debate/newsQuery.ts (신규)
export async function queryNewsByCategory(
  categories: NewsCategory[],
  daysBack: number,
  sentiment?: NewsSentiment,
): Promise<NewsArchiveRow[]>

export async function queryNewsByKeyword(
  keywords: string[],
  daysBack: number,
): Promise<NewsArchiveRow[]>
```

**3-2. cleanup 잡 launchd 통합**

`cleanup-news-archive.ts`는 주간 ETL 또는 log-cleanup plist에 편승하는 방식 검토. 별도 plist 추가보다 기존 주간 ETL 스크립트에 step으로 추가하는 게 단순.

---

## 작업 계획

### Phase 1-A: 스키마 + 마이그레이션 (실행팀)
- **무엇을**: `news_archive` 테이블 Drizzle 스키마 작성 + 마이그레이션 생성
- **파일**: `src/db/schema/analyst.ts` (newsArchive 추가), `drizzle migrate`
- **완료 기준**: `npm run db:generate && npm run db:migrate` 성공, 테이블 생성 확인

### Phase 1-B: ETL 잡 구현 (실행팀, 1-A와 병렬)
- **무엇을**: `src/etl/jobs/collect-news.ts` 작성
  - Brave Search 호출 (URL 포함), 분류, 감성 판정, DB upsert
  - `src/etl/jobs/cleanup-news-archive.ts` 작성 (30일 초과 삭제)
- **완료 기준**: 단위 테스트 통과, `tsx src/etl/jobs/collect-news.ts` 실행 시 DB에 뉴스 적재 확인

### Phase 1-C: launchd 등록 (실행팀, 1-A 완료 후)
- **무엇을**: `scripts/launchd/com.market-analyst.news-collect.plist` 작성, `setup-launchd.sh` 업데이트
- **완료 기준**: 맥미니에서 `launchctl list com.market-analyst.news-collect` 등록 확인

### Phase 2: 토론 연동 (실행팀, Phase 1 완료 후)
- **무엇을**: `src/agent/debate/newsLoader.ts` 작성 + `run-debate-agent.ts` Step 4 교체
- **완료 기준**: DB에 뉴스 있는 상태에서 토론 실행 시 newsContext 로드 확인, 0건 시 폴백 동작 확인

### Phase 3: 쿼리 인터페이스 (실행팀, Phase 2 완료 후, 후속 이슈 착수 전)
- **무엇을**: `src/agent/debate/newsQuery.ts` 공통 조회 함수
- **완료 기준**: #95, #89, #93 착수 시 바로 import 가능한 API

---

## 리스크

| 리스크 | 수준 | 대응 |
|--------|------|------|
| Brave API 쿼터 초과 | 낮음 | 현재 월 200 + 신규 월 1,200 = 1,400. Pro 2,000 한도 내. 단, 쿼리 수 늘릴 경우 재계산 필요. |
| URL 누락 (Brave 응답에 url 없음) | 낮음 | Brave news API는 url 필드 포함. 누락 시 title+source hash를 대체 key로 사용 가능. |
| `publishedAt` 파싱 실패 | 낮음 | Brave의 `age`는 "2 hours ago" 형식. 파싱 실패 시 null 허용, collectedAt으로 대체. |
| 키워드 분류 정확도 낮음 | 중간 | 초기 70% 정확도는 수용 가능. 분류 오류는 로그로 모니터링, 필요 시 키워드 목록 보강. LLM 분류는 Phase 3 이후 검토 (비용 대비 효과 먼저 측정). |
| DB 무한 증가 | 낮음 | cleanup 잡으로 30일 초과 삭제. 월 ~3,600건(6h×4×30days×~30뉴스) → 30일치 최대 약 3.6만 rows. Supabase 무료 플랜 500MB에 충분. |
| 토론 연동 후 뉴스 부재 시 | 낮음 | 폴백(실시간 collectNews 호출)으로 커버. 완전 실패 시 뉴스 없이 토론 진행 (기존 동작과 동일). |
| 맥미니 오프라인 시 수집 공백 | 중간 | launchd는 재부팅 후 자동 복구. 장시간 오프라인 시 공백 발생. 허용 리스크. |

---

## 의사결정 필요

**없음 — 바로 구현 가능**

단, 구현 중 확인이 필요한 항목:
- Brave API 응답에서 `url` 필드 반환 여부 (기존 코드에서 `meta_url.hostname`만 사용 중 — `url` 원본이 항상 있는지 API 문서 또는 실제 응답 확인 필요. 구현자가 확인 후 처리)
- cleanup 잡을 별도 plist로 분리할지 vs 기존 weekly 스크립트에 편승할지 — 단순성 기준으로 주간 ETL 편승 권장. 구현자 판단에 위임.
