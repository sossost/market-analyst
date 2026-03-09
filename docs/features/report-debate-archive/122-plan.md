# 이슈 #122 — 토론 아카이빙 UI (목록 + 상세 탭) 구현 계획

**이슈:** #122
**연관 스펙:** `01-spec.md` (F8 전체 스펙)
**작성일:** 2026-03-09

---

## 선행 맥락

- **#118 (PR #123)**: 프론트엔드 초기 세팅 완료. Next.js 16, Tailwind v4, shadcn/ui (base-nova), Supabase SSR 구성됨.
- **#119 (PR #125)**: Supabase Auth Magic Link 완료. `middleware.ts` 인증 가드 동작 중.
- 라우트 파일 이미 생성됨: `app/(main)/debates/page.tsx`, `app/(main)/debates/[date]/page.tsx` (플레이스홀더 상태).
- `features/debates/` 피쳐 디렉토리 존재 (타입 2개만 선언, lib/components 없음).

## 골 정렬

**SUPPORT** — 아카이빙 UI는 시스템 산출물(토론 세션/thesis)의 열람 인프라다. 직접적인 Phase 2 포착 기능은 아니지만, CEO가 토론 결과와 thesis 상태를 추적하여 의사결정 맥락을 유지하는 데 기여한다.

---

## 문제

Discord로 흘러가는 토론 세션 데이터(라운드별 발언, thesis, 레짐)를 웹에서 날짜별로 검색하고 열람할 수 없다.

## Before → After

**Before:** 토론 목록/상세 라우트가 플레이스홀더 텍스트만 렌더링. DB 쿼리 없음.

**After:** `/debates`에서 날짜순 세션 목록(VIX/Fear&Greed/Phase2 비율/thesis 수 미리보기)을 페이지네이션으로 탐색하고, `/debates/[date]`에서 Round 1 / Round 2 / 종합 탭으로 라운드별 발언과 thesis 목록을 확인할 수 있다.

---

## DB 스키마 분석

### debate_sessions 핵심 컬럼

```
id, date (YYYY-MM-DD, UNIQUE)
vix, fear_greed_score, phase2_ratio, top_sector_rs
round1_outputs  (JSON: RoundOutput[]) — { persona, content }[]
round2_outputs  (JSON: RoundOutput[]) — { persona, content }[]
synthesis_report (text)
theses_count
market_snapshot, news_context
tokens_input, tokens_output, duration_ms
created_at
```

### theses 핵심 컬럼 (debate_date로 조인)

```
id, debate_date, agent_persona
thesis, timeframe_days, confidence, consensus_level
category, status (ACTIVE/CONFIRMED/INVALIDATED/EXPIRED)
next_bottleneck, dissent_reason
```

### market_regimes (regime_date로 조인)

```
regime_date, regime (EARLY_BULL/MID_BULL/LATE_BULL/EARLY_BEAR/BEAR)
rationale, confidence
```

### RoundOutput JSON 구조

```typescript
// round1_outputs / round2_outputs 내부
interface RoundOutput {
  persona: 'macro' | 'tech' | 'geopolitics' | 'sentiment'
  content: string
}
```

---

## 컴포넌트 구조도

```
features/debates/
├── types.ts                         (확장 — 현재 2개 타입)
├── lib/
│   ├── supabase-queries.ts          (Supabase 쿼리 함수)
│   └── parse-round-outputs.ts       (JSON 파싱 + 에러 처리)
└── components/
    ├── DebateListItem.tsx            (목록 행 단위 카드)
    ├── DebateListSkeleton.tsx        (목록 로딩 스켈레톤)
    ├── DebateEmptyState.tsx          (빈 상태)
    ├── DebateDetailTabs.tsx          (탭 컨테이너 — 'use client')
    ├── RoundPanel.tsx                (Round 1/2 탭 패널)
    ├── AnalystCard.tsx               (애널리스트별 발언 카드)
    ├── SynthesisPanel.tsx            (종합 탭 패널)
    ├── ThesisList.tsx                (thesis 목록)
    ├── ThesisBadge.tsx               (ACTIVE/CONFIRMED/INVALIDATED/EXPIRED 뱃지)
    └── RegimeBadge.tsx               (시장 레짐 뱃지)

app/(main)/debates/
├── page.tsx                          (Server Component — 목록)
└── [date]/
    └── page.tsx                      (Server Component — 상세)
```

---

## 데이터 흐름

### 목록 페이지 (`/debates`)

```
URL: /debates?page=1

Server Component (page.tsx)
  └── supabase-queries.ts: fetchDebateSessions({ page, limit: 20 })
      └── Supabase SELECT debate_sessions
          ORDER BY date DESC
          RANGE (page-1)*20 .. page*20-1
          → { sessions: DebateSessionSummary[], total: number }

렌더링:
  sessions.map → DebateListItem
  Pagination 컴포넌트 (URL searchParam 기반)
  sessions.length === 0 → DebateEmptyState
  Supabase 오류 → 에러 메시지 + 재시도 안내
```

### 상세 페이지 (`/debates/[date]`)

```
URL: /debates/2026-03-07

Server Component (page.tsx)
  ├── supabase-queries.ts: fetchDebateSessionByDate(date)
  │   └── Supabase SELECT debate_sessions WHERE date = $date
  │       → DebateSessionDetail | null
  │
  ├── supabase-queries.ts: fetchThesesByDate(date)
  │   └── Supabase SELECT theses WHERE debate_date = $date
  │       ORDER BY confidence DESC, id ASC
  │       → Thesis[]
  │
  └── supabase-queries.ts: fetchRegimeByDate(date)
      └── Supabase SELECT market_regimes WHERE regime_date = $date
          → MarketRegime | null

session === null → notFound() (Next.js 404)

parse-round-outputs.ts:
  parseRoundOutputs(session.round1Outputs)  → RoundOutput[] | null (JSON 파싱 실패 시 null)
  parseRoundOutputs(session.round2Outputs)  → RoundOutput[] | null

렌더링:
  DebateDetailTabs (Client Component)
    ├── round1Outputs != null → "Round 1" 탭 활성
    ├── round2Outputs != null → "Round 2" 탭 활성
    └── "종합" 탭 항상 활성
```

---

## 타입 정의 (확장)

```typescript
// features/debates/types.ts 에 추가할 타입

export type DebateRound = 'round1' | 'round2' | 'synthesis'

export interface DebateSession {
  id: number
  debateDate: string
}

// 추가
export interface RoundOutput {
  persona: 'macro' | 'tech' | 'geopolitics' | 'sentiment'
  content: string
}

export interface DebateSessionSummary {
  id: number
  date: string
  vix: string | null
  fearGreedScore: string | null
  phase2Ratio: string | null
  topSectorRs: string | null
  thesesCount: number
}

export interface DebateSessionDetail extends DebateSessionSummary {
  round1Outputs: string       // raw JSON — 컴포넌트에서 파싱
  round2Outputs: string
  synthesisReport: string
  marketSnapshot: string
  tokensInput: number | null
  tokensOutput: number | null
  durationMs: number | null
}

export interface DebateThesis {
  id: number
  agentPersona: string
  thesis: string
  timeframeDays: number
  confidence: 'low' | 'medium' | 'high'
  consensusLevel: string
  category: string
  status: 'ACTIVE' | 'CONFIRMED' | 'INVALIDATED' | 'EXPIRED'
  nextBottleneck: string | null
  dissentReason: string | null
}

export interface MarketRegimeSummary {
  regime: 'EARLY_BULL' | 'MID_BULL' | 'LATE_BULL' | 'EARLY_BEAR' | 'BEAR'
  rationale: string
  confidence: 'low' | 'medium' | 'high'
}
```

---

## 작업 계획

### Phase 1: 타입 + 쿼리 레이어 (독립 커밋)

**목표:** DB 접근 계층 완성. UI 없음.

| 파일 | 작업 |
|------|------|
| `features/debates/types.ts` | DebateSessionSummary, DebateSessionDetail, DebateThesis, MarketRegimeSummary, RoundOutput 추가 |
| `features/debates/lib/supabase-queries.ts` | fetchDebateSessions, fetchDebateSessionByDate, fetchThesesByDate, fetchRegimeByDate |
| `features/debates/lib/parse-round-outputs.ts` | JSON 파싱 유틸. 실패 시 null 반환 (throw 금지) |

**완료 기준:**
- TypeScript 타입 에러 없음
- 각 쿼리 함수 export 확인 (lint 통과)
- 파싱 함수: 유효 JSON → RoundOutput[], 잘못된 JSON → null

---

### Phase 2: 목록 페이지 (`/debates`) (독립 커밋)

**목표:** 날짜순 목록 + 페이지네이션 완성.

| 파일 | 작업 |
|------|------|
| `features/debates/components/DebateListItem.tsx` | 날짜 / VIX / Fear&Greed / Phase2비율 / thesis수 표시. Card 컴포넌트 활용. `href=/debates/${date}` 링크. |
| `features/debates/components/DebateListSkeleton.tsx` | Skeleton 컴포넌트로 로딩 상태 (5행) |
| `features/debates/components/DebateEmptyState.tsx` | "토론 기록이 없습니다" 안내 텍스트 |
| `app/(main)/debates/page.tsx` | Server Component. searchParams.page 처리. fetchDebateSessions 호출. Pagination 렌더링. |

**완료 기준:**
- `/debates` 접속 시 세션 목록 렌더링
- 목록 없을 때 EmptyState 표시
- 페이지네이션: 20개 단위, URL searchParam(`?page=N`) 기반
- 각 항목 클릭 시 `/debates/[date]` 이동
- 모바일 375px에서 레이아웃 깨지지 않음

---

### Phase 3: 상세 공통 컴포넌트 (독립 커밋)

**목표:** 상세 페이지에서 사용할 원자 컴포넌트 완성.

| 파일 | 작업 |
|------|------|
| `features/debates/components/ThesisBadge.tsx` | status별 variant 매핑. ACTIVE→default, CONFIRMED→secondary(green), INVALIDATED→destructive, EXPIRED→outline |
| `features/debates/components/RegimeBadge.tsx` | regime별 variant. EARLY_BULL/MID_BULL→secondary, LATE_BULL→outline(amber), EARLY_BEAR/BEAR→destructive |
| `features/debates/components/AnalystCard.tsx` | persona 라벨(한글) + content 텍스트. Card 컴포넌트 활용. whitespace-pre-wrap. |
| `features/debates/components/ThesisList.tsx` | DebateThesis[] 수신. 각 thesis를 카드로 렌더링. ThesisBadge, confidence/consensusLevel 표시. |

**완료 기준:**
- ThesisBadge: 4가지 status 각각 올바른 variant 렌더링
- RegimeBadge: 5가지 regime 각각 렌더링
- AnalystCard: persona를 한글 라벨로 변환 (macro→거시경제, tech→기술분석, geopolitics→지정학, sentiment→심리분석)
- ThesisList: 빈 배열 시 "생성된 thesis가 없습니다" 표시

---

### Phase 4: 상세 탭 패널 + 페이지 (독립 커밋)

**목표:** 상세 페이지 완성.

| 파일 | 작업 |
|------|------|
| `features/debates/components/RoundPanel.tsx` | RoundOutput[] 수신. AnalystCard 목록 렌더링. null 시 "라운드 데이터가 없습니다" 표시. |
| `features/debates/components/SynthesisPanel.tsx` | synthesisReport(텍스트) + ThesisList + RegimeBadge. |
| `features/debates/components/DebateDetailTabs.tsx` | `'use client'`. Tabs/TabsList/TabsTrigger/TabsContent 사용. round1/round2 null 시 해당 탭 `aria-disabled`. defaultValue는 항상 '종합'. |
| `app/(main)/debates/[date]/page.tsx` | Server Component. date params 수신. 3개 쿼리 병렬 실행(Promise.all). notFound() 처리. DebateDetailTabs에 props 전달. |

**완료 기준:**
- `/debates/2026-03-07` 접속 시 탭 3개 렌더링
- 라운드 데이터 없는 탭: aria-disabled + 클릭 불가
- 종합 탭: synthesis_report 텍스트 + thesis 목록 + 레짐 뱃지
- notFound: 존재하지 않는 날짜 접속 시 Next.js 404 페이지
- JSON 파싱 실패 시: "데이터를 불러올 수 없습니다" 표시 (throw 없음)
- 모바일 375px 탭 스크롤 가능

---

## 사용할 shadcn/ui 컴포넌트

| 컴포넌트 | 파일 위치 | 사용처 |
|----------|----------|--------|
| `Card`, `CardHeader`, `CardTitle`, `CardContent` | `shared/components/ui/card.tsx` | DebateListItem, AnalystCard, ThesisList 항목 |
| `Badge` | `shared/components/ui/badge.tsx` | ThesisBadge, RegimeBadge |
| `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` | `shared/components/ui/tabs.tsx` | DebateDetailTabs |
| `Skeleton` | `shared/components/ui/skeleton.tsx` | DebateListSkeleton |
| `Pagination`, `PaginationContent`, `PaginationLink`, `PaginationPrevious`, `PaginationNext` | `shared/components/ui/pagination.tsx` | 목록 페이지 |

---

## 파일별 변경/생성 목록

### 신규 생성

```
frontend/src/features/debates/lib/supabase-queries.ts
frontend/src/features/debates/lib/parse-round-outputs.ts
frontend/src/features/debates/components/DebateListItem.tsx
frontend/src/features/debates/components/DebateListSkeleton.tsx
frontend/src/features/debates/components/DebateEmptyState.tsx
frontend/src/features/debates/components/AnalystCard.tsx
frontend/src/features/debates/components/ThesisBadge.tsx
frontend/src/features/debates/components/RegimeBadge.tsx
frontend/src/features/debates/components/ThesisList.tsx
frontend/src/features/debates/components/RoundPanel.tsx
frontend/src/features/debates/components/SynthesisPanel.tsx
frontend/src/features/debates/components/DebateDetailTabs.tsx
```

### 수정

```
frontend/src/features/debates/types.ts          (타입 추가)
frontend/src/app/(main)/debates/page.tsx         (플레이스홀더 → 실구현)
frontend/src/app/(main)/debates/[date]/page.tsx  (플레이스홀더 → 실구현)
```

---

## 쿼리 설계 상세

### fetchDebateSessions

```typescript
// 목록: 요약 데이터만 SELECT (round outputs 제외 — 데이터 크기 절감)
SELECT id, date, vix, fear_greed_score, phase2_ratio, top_sector_rs, theses_count
FROM debate_sessions
ORDER BY date DESC
RANGE offset..offset+limit-1
```

### fetchDebateSessionByDate

```typescript
// 상세: 전체 컬럼 SELECT
SELECT *
FROM debate_sessions
WHERE date = $date
LIMIT 1
```

### fetchThesesByDate

```typescript
// thesis: debate_date 기준
SELECT id, agent_persona, thesis, timeframe_days, confidence,
       consensus_level, category, status, next_bottleneck, dissent_reason
FROM theses
WHERE debate_date = $date
ORDER BY confidence DESC, id ASC
```

### fetchRegimeByDate

```typescript
// 레짐: regime_date 기준
SELECT regime, rationale, confidence
FROM market_regimes
WHERE regime_date = $date
LIMIT 1
```

---

## 리스크 및 주의사항

| 항목 | 내용 | 대응 |
|------|------|------|
| round1/2_outputs JSON 파싱 | DB에 저장된 raw JSON 문자열 — 실패 가능 | parse-round-outputs.ts에서 try/catch, null 반환. 컴포넌트는 null 처리 필수. |
| synthesis_report 텍스트 길이 | 수 KB 텍스트. 마크다운 미지원. | `whitespace-pre-wrap`으로 줄바꿈 보존. 마크다운 렌더링은 v2. |
| Tabs disabled 처리 | shadcn/ui (base-nova) Tabs 컴포넌트에서 `aria-disabled` vs `disabled` prop 차이 | TabsTrigger에 `aria-disabled={true}` + `tabIndex={-1}` 조합 사용. 실제 코드 확인 후 조정. |
| Supabase RLS | debate_sessions, theses, market_regimes에 RLS 정책 없으면 anon key로 접근 가능 여부 확인 필요 | 미들웨어 인증 가드가 있으나, Supabase 대시보드에서 RLS 정책도 확인할 것. |
| 페이지네이션 서버 컴포넌트 | searchParams는 `Promise<{ page?: string }>` 타입 (Next.js 15+) | `await params`로 처리. 기존 [date]/page.tsx 패턴 참조. |
| top_sector_rs 포맷 | "Energy:73.3,Technology:41.5,..." 형식 문자열 | 목록에서는 원문 표시. 파싱 로직 불필요. |

---

## 의사결정 필요

없음 — 바로 구현 가능.

다음 사항은 자율 판단:
- synthesis_report 텍스트 최대 높이 스크롤 처리 (`max-h-[600px] overflow-y-auto`) — 가독성 우선
- DebateDetailTabs defaultValue: 항상 "종합" 탭으로 시작 (최신 결과 우선 노출)
- 페이지 단위: 20개 (reports 패턴 동일)
