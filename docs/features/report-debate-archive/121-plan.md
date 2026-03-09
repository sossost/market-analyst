# 이슈 #121 — 리포트 아카이빙 UI (목록 + 상세) 구현 계획

**이슈:** #121
**연관 스펙:** `01-spec.md` (F8 전체 스펙)
**작성일:** 2026-03-09

---

## 선행 맥락

- **#118 (PR #123)**: 프론트엔드 초기 세팅 완료. Next.js 16, Tailwind v4, shadcn/ui (base-nova), Supabase SSR 구성됨.
- **#119 (PR #125)**: Supabase Auth Magic Link 완료. `middleware.ts` 인증 가드 동작 중.
- **#120 (PR #126)**: `daily_reports` 테이블 마이그레이션 완료. `saveReportLog` DB 저장 전환 완료.
- **#122 (PR #127)**: 토론 아카이빙 UI 완료. `features/debates/` 전체 패턴 구축됨 — 동일 패턴 재사용.
- 라우트 파일 이미 생성됨: `app/(main)/reports/page.tsx`, `app/(main)/reports/[date]/page.tsx` (플레이스홀더 상태).
- `features/reports/` 피쳐 디렉토리 존재 (타입 2개만 선언, lib/components 없음).

## 골 정렬

**SUPPORT** — 리포트 아카이빙 UI는 에이전트 산출물(일간/주간 리포트)의 열람 인프라다. 직접적인 Phase 2 포착 기능은 아니지만, CEO가 과거 추천 종목과 시장 요약을 날짜별로 추적하여 의사결정 맥락을 유지하는 데 기여한다. F8 아카이빙 대시보드의 마지막 피스.

---

## 문제

Discord로 흘러가는 일간/주간 리포트 데이터(추천 종목, 시장 요약, 메타데이터)를 웹에서 날짜별로 검색하고 열람할 수 없다.

## Before → After

**Before:** 리포트 목록/상세 라우트가 플레이스홀더 텍스트만 렌더링. DB 쿼리 없음. `features/reports/types.ts`에 타입 2개만 존재.

**After:** `/reports`에서 날짜순 리포트 목록(일간/주간 구분, 추천 종목 수, 주도섹터 미리보기)을 페이지네이션으로 탐색하고, `/reports/[date]`에서 추천 종목 테이블, 시장 요약, 메타데이터를 확인할 수 있다.

---

## DB 스키마 분석

### daily_reports 핵심 컬럼 (PR #126 마이그레이션 완료)

```
id: serial PK
report_date: text NOT NULL (YYYY-MM-DD, UNIQUE)
type: text NOT NULL DEFAULT 'daily'    -- 'daily' | 'weekly'
reported_symbols: jsonb NOT NULL       -- ReportedStock[]
market_summary: jsonb NOT NULL         -- { phase2Ratio, leadingSectors, totalAnalyzed }
full_content: text                     -- 현재 없음, null
metadata: jsonb NOT NULL               -- { model, tokensUsed, toolCalls, executionTime }
created_at: timestamptz
```

### ReportedStock JSON 구조 (src/types/index.ts 기준)

```typescript
interface ReportedStock {
  symbol: string
  phase: number
  prevPhase: number | null
  rsScore: number
  sector: string
  industry: string
  reason: string
  firstReportedDate: string
}
```

### market_summary JSON 구조

```typescript
interface MarketSummary {
  phase2Ratio: number
  leadingSectors: string[]
  totalAnalyzed: number
}
```

### metadata JSON 구조

```typescript
interface ReportMetadata {
  model: string
  tokensUsed: { input: number; output: number }
  toolCalls: number
  executionTime: number
}
```

---

## 컴포넌트 구조도

토론 아카이브(`features/debates/`) 패턴을 그대로 따른다.

```
features/reports/
├── types.ts                          (확장 — 현재 2개 타입)
├── constants.ts                      (타입 라벨 등 상수)
├── lib/
│   └── supabase-queries.ts           (Supabase 쿼리 함수)
└── components/
    ├── ReportListItem.tsx             (목록 행 단위 카드)
    ├── ReportListSkeleton.tsx         (목록 로딩 스켈레톤)
    ├── ReportEmptyState.tsx           (빈 상태)
    ├── ReportTypeBadge.tsx            (daily/weekly 뱃지)
    ├── RecommendedStockTable.tsx      (추천 종목 테이블 — Client Component)
    └── MarketSummaryCard.tsx          (시장 요약 카드)

app/(main)/reports/
├── page.tsx                           (Server Component — 목록)
└── [date]/
    └── page.tsx                       (Server Component — 상세)
```

---

## 데이터 흐름

### 목록 페이지 (`/reports`)

```
URL: /reports?page=1

Server Component (page.tsx)
  └── supabase-queries.ts: fetchReports({ page, limit: 20 })
      └── Supabase SELECT daily_reports
          SELECT id, report_date, type, market_summary, reported_symbols
          (reported_symbols에서 length만 추출 — jsonb_array_length)
          ORDER BY report_date DESC
          RANGE (page-1)*20 .. page*20-1
          → { reports: ReportSummary[], total: number }

렌더링:
  reports.map → ReportListItem
  Pagination 컴포넌트 (URL searchParam 기반)
  reports.length === 0 → ReportEmptyState
  Supabase 오류 → 에러 메시지 + 재시도 안내
```

**주의:** `jsonb_array_length`는 Supabase JS 클라이언트에서 직접 지원 안 됨.
`reported_symbols`를 전체 select 후 JS에서 `.length`로 처리한다.
목록에서 `reported_symbols` 전체를 불러오는 것은 데이터 크기 이슈가 있으나,
현재 리포트 건수(수십 건 수준)에서는 허용 가능. 대량화 시 DB 함수로 개선.

### 상세 페이지 (`/reports/[date]`)

```
URL: /reports/2026-02-20

Server Component (page.tsx)
  └── supabase-queries.ts: fetchReportByDate(date)
      └── Supabase SELECT daily_reports WHERE report_date = $date
          → ReportDetail | null

report === null → notFound() (Next.js 404)

렌더링:
  ReportTypeBadge (daily/weekly)
  MarketSummaryCard (phase2Ratio, leadingSectors, totalAnalyzed)
  RecommendedStockTable (ReportedStock[] — Client Component, 정렬 가능)
  MetadataSection (model, tokensUsed, executionTime, toolCalls)
```

---

## 타입 정의 (확장)

```typescript
// features/reports/types.ts 전체 교체

export type ReportType = 'daily' | 'weekly'

export interface ReportedStock {
  symbol: string
  phase: number
  prevPhase: number | null
  rsScore: number
  sector: string
  industry: string
  reason: string
  firstReportedDate: string
}

export interface MarketSummary {
  phase2Ratio: number
  leadingSectors: string[]
  totalAnalyzed: number
}

export interface ReportMetadata {
  model: string
  tokensUsed: { input: number; output: number }
  toolCalls: number
  executionTime: number
}

export interface ReportSummary {
  id: number
  reportDate: string
  type: ReportType
  symbolCount: number              // reported_symbols.length
  leadingSectors: string[]         // market_summary.leadingSectors
  phase2Ratio: number              // market_summary.phase2Ratio
}

export interface ReportDetail {
  id: number
  reportDate: string
  type: ReportType
  reportedSymbols: ReportedStock[]
  marketSummary: MarketSummary
  fullContent: string | null
  metadata: ReportMetadata
}
```

---

## 작업 계획

### Phase 1: 타입 + 쿼리 레이어 (독립 커밋)

**목표:** DB 접근 계층 완성. UI 없음.

| 파일 | 작업 |
|------|------|
| `features/reports/types.ts` | ReportSummary, ReportDetail, ReportedStock, MarketSummary, ReportMetadata, ReportType 전체 정의 |
| `features/reports/lib/supabase-queries.ts` | fetchReports(page), fetchReportByDate(date) |
| `features/reports/constants.ts` | REPORT_TYPE_LABEL: `{ daily: '일간', weekly: '주간' }` |

**완료 기준:**
- TypeScript 타입 에러 없음
- 각 쿼리 함수 export 확인 (lint 통과)
- fetchReports: `{ reports: ReportSummary[], total: number }` 반환
- fetchReportByDate: `ReportDetail | null` 반환 (PGRST116 에러 → null)

---

### Phase 2: 목록 페이지 (`/reports`) (독립 커밋)

**목표:** 날짜순 목록 + 페이지네이션 완성.

| 파일 | 작업 |
|------|------|
| `features/reports/components/ReportTypeBadge.tsx` | `daily` → "일간" (secondary), `weekly` → "주간" (default). Badge 컴포넌트 활용. |
| `features/reports/components/ReportListItem.tsx` | 날짜 / 타입 뱃지 / 추천 종목 수 / Phase 2 비율 / 주도섹터 미리보기. Card 컴포넌트 활용. `href=/reports/${reportDate}` 링크. |
| `features/reports/components/ReportListSkeleton.tsx` | Skeleton 컴포넌트로 로딩 상태 (5행) |
| `features/reports/components/ReportEmptyState.tsx` | "리포트가 없습니다" 안내 텍스트 |
| `app/(main)/reports/page.tsx` | Server Component. searchParams.page 처리. fetchReports 호출. Pagination 렌더링. 토론 목록 페이지(`debates/page.tsx`) 패턴 그대로 적용. |

**완료 기준:**
- `/reports` 접속 시 리포트 목록 렌더링
- 목록 없을 때 EmptyState 표시
- 페이지네이션: 20개 단위, URL searchParam(`?page=N`) 기반
- 각 항목 클릭 시 `/reports/[date]` 이동
- 일간/주간 Badge 구분 표시
- 모바일 375px에서 레이아웃 깨지지 않음

---

### Phase 3: 상세 페이지 컴포넌트 (독립 커밋)

**목표:** 상세 페이지에서 사용할 컴포넌트 완성.

| 파일 | 작업 |
|------|------|
| `features/reports/components/MarketSummaryCard.tsx` | MarketSummary 수신. Phase 2 비율 / 총 분석 종목 수 / 주도섹터 목록(Badge 나열) 표시. Card 컴포넌트 활용. |
| `features/reports/components/RecommendedStockTable.tsx` | `'use client'`. ReportedStock[] 수신. Table 컴포넌트 활용. 컬럼: 심볼 / Phase / RS 점수 / 섹터 / 산업 / 최초 보고일. 빈 배열 시 "추천 종목이 없습니다" 표시. |

**완료 기준:**
- MarketSummaryCard: leadingSectors를 Badge로 나열, phase2Ratio 퍼센트 포맷
- RecommendedStockTable: 7개 컬럼 렌더링
- 모바일: 테이블 `overflow-x-auto` 처리 (가로 스크롤)

---

### Phase 4: 상세 페이지 + 메타데이터 (독립 커밋)

**목표:** 상세 페이지 완성.

| 파일 | 작업 |
|------|------|
| `app/(main)/reports/[date]/page.tsx` | Server Component. date params 수신. fetchReportByDate 호출. notFound() 처리. 헤더(날짜 + 타입 뱃지) + MarketSummaryCard + RecommendedStockTable + MetadataSection 렌더링. |

**MetadataSection 구조 (인라인 구현):**
```
실행 모델 | 토큰 사용량(입력/출력) | 도구 호출 수 | 실행 시간(초)
```
→ 4개 MetricItem을 grid로 표시. 토론 상세 페이지의 메타 헤더 패턴 참조.

**완료 기준:**
- `/reports/2026-02-20` 접속 시 전체 상세 렌더링
- notFound: 존재하지 않는 날짜 접속 시 Next.js 404 페이지
- 뒤로가기 링크 (`← 리포트 목록`) 표시
- 모바일 375px 전체 동작 확인

---

## 사용할 shadcn/ui 컴포넌트

| 컴포넌트 | 파일 위치 | 사용처 |
|----------|----------|--------|
| `Card`, `CardHeader`, `CardTitle`, `CardContent` | `shared/components/ui/card.tsx` | ReportListItem, MarketSummaryCard |
| `Badge` | `shared/components/ui/badge.tsx` | ReportTypeBadge, 주도섹터 목록 |
| `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell` | `shared/components/ui/table.tsx` | RecommendedStockTable |
| `Skeleton` | `shared/components/ui/skeleton.tsx` | ReportListSkeleton |
| `Pagination`, `PaginationContent`, `PaginationLink`, `PaginationPrevious`, `PaginationNext` | `shared/components/ui/pagination.tsx` | 목록 페이지 |

**주의:** `table.tsx`가 `shared/components/ui/`에 없으면 `npx shadcn@latest add table`로 추가 필요.
현재 목록 확인 결과 `table.tsx` 존재함 — 추가 설치 불필요.

---

## 파일별 변경/생성 목록

### 신규 생성

```
frontend/src/features/reports/constants.ts
frontend/src/features/reports/lib/supabase-queries.ts
frontend/src/features/reports/components/ReportTypeBadge.tsx
frontend/src/features/reports/components/ReportListItem.tsx
frontend/src/features/reports/components/ReportListSkeleton.tsx
frontend/src/features/reports/components/ReportEmptyState.tsx
frontend/src/features/reports/components/MarketSummaryCard.tsx
frontend/src/features/reports/components/RecommendedStockTable.tsx
```

### 수정

```
frontend/src/features/reports/types.ts              (전체 교체 — 현재 2개 타입만)
frontend/src/app/(main)/reports/page.tsx             (플레이스홀더 → 실구현)
frontend/src/app/(main)/reports/[date]/page.tsx      (플레이스홀더 → 실구현)
```

---

## 쿼리 설계 상세

### fetchReports

```typescript
// 목록: 요약 데이터 SELECT
// reported_symbols 전체 포함 (JS에서 .length 추출)
// market_summary 전체 포함 (leadingSectors, phase2Ratio 추출)
SELECT id, report_date, type, reported_symbols, market_summary
FROM daily_reports
ORDER BY report_date DESC
RANGE offset..offset+limit-1

// JS 변환:
ReportSummary {
  id, reportDate, type,
  symbolCount: row.reported_symbols?.length ?? 0,
  leadingSectors: row.market_summary?.leadingSectors ?? [],
  phase2Ratio: row.market_summary?.phase2Ratio ?? 0,
}
```

### fetchReportByDate

```typescript
// 상세: 전체 컬럼 SELECT
SELECT id, report_date, type, reported_symbols, market_summary, full_content, metadata
FROM daily_reports
WHERE report_date = $date
LIMIT 1

// 없으면 null (PGRST116 에러 처리)
```

---

## 토론 아카이브와의 패턴 비교

| 항목 | 토론 (#122) | 리포트 (#121) |
|------|------------|--------------|
| 목록 아이템 미리보기 | VIX / Fear&Greed / Phase2 / Thesis수 | 타입(일간/주간) / 추천종목수 / Phase2비율 / 주도섹터 |
| 상세 구조 | 탭(Round1/Round2/종합) | 단일 페이지 (탭 없음) |
| 복잡한 파싱 | round_outputs JSON 파싱 필요 | reported_symbols/market_summary 직접 사용 (구조화됨) |
| 인터랙티브 요소 | 탭 전환 (Client Component) | 테이블 (Client Component) |
| 404 처리 | notFound() | notFound() |
| 페이지네이션 | 동일 패턴 | 동일 패턴 |

리포트 상세는 탭이 없어 토론 상세보다 단순하다.
`DebateDetailTabs`에 해당하는 Client Component가 불필요하고,
대신 `RecommendedStockTable`만 Client Component로 분리한다.

---

## 리스크 및 주의사항

| 항목 | 내용 | 대응 |
|------|------|------|
| reported_symbols 크기 | 건당 수십~수백 KB 가능성 | 목록에서 reported_symbols 전체 조회 중. 현재 데이터 규모(수십 건)에서는 허용. 대량화 시 Supabase RPC로 count만 조회하도록 개선 예정. |
| metadata null 케이스 | 기존 마이그레이션된 파일에 metadata가 없으면 null | `metadata?.tokensUsed ?? { input: 0, output: 0 }` 방어 처리 |
| full_content null | 현재 모든 레코드에 null | "리포트 원문이 없습니다" 문구로 graceful 처리 (섹션 자체를 조건부 렌더링) |
| Supabase RLS | daily_reports 테이블 RLS 정책 확인 필요 | middleware 인증 가드 존재. Supabase 대시보드에서 RLS 정책도 확인할 것. |
| Table 컴포넌트 | table.tsx가 shared/components/ui에 존재 확인됨 | 추가 설치 불필요 |
| 페이지네이션 서버 컴포넌트 | searchParams는 `Promise<{ page?: string }>` (Next.js 15+) | `await searchParams`로 처리. 토론 목록 패턴 그대로 적용. |

---

## 의사결정 필요

없음 — 바로 구현 가능.

다음 사항은 자율 판단:
- 목록에서 주도섹터 최대 표시 수: 3개 (`leadingSectors.slice(0, 3)`) — 카드 overflow 방지
- 상세 페이지 추천 종목 테이블 기본 정렬: RS 점수 내림차순
- MetadataSection 실행 시간 단위: ms → 초 변환 (`executionTime / 1000`), 소수점 1자리
- RecommendedStockTable `prevPhase` 표시: `prevPhase != null ? prevPhase : '-'`
