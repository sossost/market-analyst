# 추천 종목 디테일 페이지

## 선행 맥락
- `recommendations` 테이블은 F4(Tracking System)에서 완성됨. 진입가 검증 + 중복 방지 패치(PR #260)까지 완료.
- `recommendation_factors` 테이블도 존재하나 "저장만" 상태 (Phase C 분석용). 이번 스코프에서는 제외.
- 프론트엔드 F8 대시보드는 `/reports`, `/debates`, `/stocks` 3개 페이지가 동일 패턴으로 운영 중.

## 골 정렬
**ALIGNED** — 추천 종목 성과를 한눈에 확인함으로써 Phase 2 초입 포착 품질을 직접 평가할 수 있다. 어떤 종목이 언제 추천됐고, 현재 어떻게 흘러가는지 추적하는 것은 알파 검증의 핵심 피드백 루프다.

## 문제
`recommendations` 테이블에 진입가, 목표가, 손절가, 수익률, 상태 데이터가 매일 업데이트되고 있지만 프론트엔드에서 이를 확인할 수 있는 전용 페이지가 없다. 현재는 DB를 직접 조회하거나 리포트 페이지의 추천 종목 스냅샷만 볼 수 있다.

## Before → After

**Before**: DB 직접 조회 없이는 추천 종목 성과를 확인 불가. 리포트 페이지의 `RecommendedStockTable`은 리포트 생성 시점 스냅샷만 보여줌 (실시간 PnL 없음).

**After**: `/recommendations` 페이지에서 전체 추천 종목 목록(상태 필터 포함)을 확인하고, 각 추천의 디테일(진입 정보, 현재 상태, 수익률 추이)을 `/recommendations/[id]` 또는 `/recommendations/[symbol]/[date]`에서 조회 가능.

## 변경 사항

### 1. 신규 페이지 (App Router)
```
frontend/src/app/(main)/recommendations/
├── page.tsx                    # 목록 페이지 (상태 필터 + 테이블)
└── [id]/
    └── page.tsx                # 디테일 페이지
```

### 2. 신규 Feature 모듈
```
frontend/src/features/recommendations/
├── components/
│   ├── RecommendationTable.tsx         # 목록 테이블 (서버 컴포넌트)
│   ├── RecommendationTableSkeleton.tsx # 로딩 스켈레톤
│   ├── RecommendationStatusBadge.tsx   # ACTIVE/CLOSED/STOPPED 배지
│   ├── PnlCell.tsx                     # 수익률 셀 (양수 초록/음수 빨강)
│   └── RecommendationDetail.tsx        # 디테일 카드 묶음
├── lib/
│   └── supabase-queries.ts             # fetchRecommendations, fetchRecommendationById
└── types.ts                            # RecommendationRow, RecommendationDetail 타입
```

### 3. 네비게이션 추가
`AppLayout` 또는 `Sidebar` 컴포넌트에 `/recommendations` 링크 추가.

---

## 데이터 요구사항

### `recommendations` 테이블 컬럼 매핑

| 화면 필드 | DB 컬럼 | 비고 |
|-----------|---------|------|
| 종목 | `symbol` | |
| 추천일 | `recommendation_date` | |
| 진입가 | `entry_price` | numeric |
| 진입 Phase | `entry_phase` → `entry_prev_phase` | `{prev}→{curr}` 포맷 |
| 진입 RS | `entry_rs_score` | |
| 현재가 | `current_price` | ETL 업데이트 |
| 현재 Phase | `current_phase` | |
| 수익률 | `pnl_percent` | 색상 강조 |
| 최대 수익률 | `max_pnl_percent` | |
| 보유일 | `days_held` | |
| 상태 | `status` | ACTIVE / CLOSED / STOPPED |
| 종료일 | `close_date` | CLOSED일 때만 |
| 종료 사유 | `close_reason` | |
| 레짐 | `market_regime` | 추천 시점 레짐 |
| 섹터 | `sector` | |
| 추천 사유 | `reason` | 디테일에서만 표시 |

### API 패턴 (Supabase SSR — 기존 패턴 동일)
```typescript
// 목록: 상태 필터 + 날짜 역순 정렬 + 페이지네이션
supabase
  .from('recommendations')
  .select('id, symbol, recommendation_date, entry_price, entry_phase, entry_prev_phase, entry_rs_score, current_price, current_phase, pnl_percent, max_pnl_percent, days_held, status, close_date, sector, market_regime', { count: 'exact' })
  .eq('status', statusFilter)   // 없으면 전체
  .order('recommendation_date', { ascending: false })
  .range(offset, offset + ITEMS_PER_PAGE - 1)

// 디테일: id로 단건
supabase
  .from('recommendations')
  .select('*')
  .eq('id', id)
  .single()
```

---

## 페이지 구조 상세

### `/recommendations` — 목록 페이지
```
<main>
  <h1>추천 종목</h1>
  <p className="text-muted-foreground">주간 에이전트 추천 종목 성과 트래킹</p>

  <!-- 상태 필터 탭: 전체 / ACTIVE / CLOSED -->
  <StatusFilterTabs />  ← searchParams 기반, URL 상태 유지

  <AsyncBoundary>
    <RecommendationTable />  ← 서버 컴포넌트, searchParams 수신
  </AsyncBoundary>
</main>
```

**테이블 컬럼 (목록):**
| 종목 | 추천일 | 진입가 | Phase 전환 | RS | 현재가 | 수익률 | 최대수익률 | 보유일 | 상태 |

- 종목 셀: 디테일 페이지 링크
- 수익률: 양수=초록, 음수=빨강, ACTIVE만 표시 (CLOSED는 최종값)
- Phase 전환: `1→2` 형식

### `/recommendations/[id]` — 디테일 페이지
```
<main>
  <Link href="/recommendations">← 추천 목록</Link>
  <h1>{symbol} — {recommendationDate} 추천</h1>
  <StatusBadge status={status} />

  <div className="grid grid-cols-2 gap-6">
    <EntryInfoCard />       # 진입 정보 (진입가, Phase, RS, 레짐, 섹터)
    <CurrentStatusCard />   # 현재 상태 (현재가, Phase, PnL, Max PnL, 보유일)
  </div>

  {status !== 'ACTIVE' && <CloseInfoCard />}  # 종료일, 종료 사유

  <ReasonCard reason={reason} />  # 추천 사유 (text 전체)
</main>
```

---

## 작업 계획

### Step 1 — 타입 + 쿼리 (백엔드 레이어)
- **담당**: 구현 에이전트
- `frontend/src/features/recommendations/types.ts` 작성
  - `RecommendationSummary`, `RecommendationDetail` 인터페이스
  - `RecommendationStatus = 'ACTIVE' | 'CLOSED' | 'STOPPED'` 타입
- `frontend/src/features/recommendations/lib/supabase-queries.ts` 작성
  - `fetchRecommendations(page, status?)` — 목록
  - `fetchRecommendationById(id)` — 단건
- **완료 기준**: TypeScript 에러 없음. 쿼리 함수가 올바른 타입 반환.

### Step 2 — 목록 컴포넌트
- **담당**: 구현 에이전트
- `RecommendationStatusBadge.tsx` — ACTIVE(파랑)/CLOSED(회색)/STOPPED(빨강)
- `PnlCell.tsx` — 수익률 포맷 + 색상
- `RecommendationTableSkeleton.tsx` — 로딩 스켈레톤 (기존 `ReportListSkeleton` 패턴)
- `RecommendationTable.tsx` — 서버 컴포넌트, `searchParams` 수신하여 필터+페이지 적용
- **완료 기준**: 목록 렌더링, 페이지네이션 작동, 스켈레톤 노출.

### Step 3 — 목록 페이지
- **담당**: 구현 에이전트
- `frontend/src/app/(main)/recommendations/page.tsx`
  - `AsyncBoundary` + `RecommendationTable` 조합
  - `searchParams`로 `status`, `page` 수신
- **완료 기준**: `/recommendations` 접근 시 목록 표시, 필터 전환 시 URL 반영.

### Step 4 — 디테일 컴포넌트 + 페이지
- **담당**: 구현 에이전트
- `RecommendationDetail.tsx` — 진입정보/현재상태/종료정보 카드
- `frontend/src/app/(main)/recommendations/[id]/page.tsx`
  - `fetchRecommendationById` 호출, `notFound()` 처리
- **완료 기준**: `/recommendations/[id]` 접근 시 디테일 표시, 없는 id는 404.

### Step 5 — 네비게이션 추가
- **담당**: 구현 에이전트
- `AppLayout` 또는 `Sidebar`에 추천 종목 메뉴 항목 추가
- **완료 기준**: 사이드바에서 `/recommendations` 링크 클릭 이동.

### Step 6 — 단위 테스트
- **담당**: 구현 에이전트
- `RecommendationStatusBadge.test.tsx` — 각 상태별 색상/레이블 검증
- `PnlCell.test.tsx` — 양수/음수/null 케이스
- `supabase-queries.test.ts` — mock 기반 쿼리 결과 매핑 검증
- **완료 기준**: 커버리지 80% 이상.

---

## 리스크

- **`recommendation_factors` 제외**: 팩터 데이터(`rsScore`, `phase2Ratio` 등)는 이번 스코프 밖. 필요 시 추후 디테일 페이지에 탭 추가로 확장 가능.
- **`reason` 컬럼 길이**: LLM 생성 텍스트라 길 수 있음. 목록에서는 생략하고 디테일에서만 표시. 필요 시 `line-clamp` 처리.
- **Supabase 타입 자동생성**: `supabase gen types` 미실행 환경이라면 raw 타입 캐스팅 필요 (기존 패턴과 동일하게 수동 매핑으로 처리).
- **`max_pnl_percent` 없는 레코드**: 오래된 레코드는 NULL 가능. UI에서 `-` fallback 처리.

## 의사결정 필요
없음 — 바로 구현 가능
