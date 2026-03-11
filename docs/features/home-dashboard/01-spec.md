# Home Dashboard

## 선행 맥락

- 현재 홈페이지(`/`)는 스켈레톤 상태 (텍스트 2줄만 존재)
- 프론트엔드 대시보드(F8)는 리포트/토론 아카이브까지 완성 — 홈은 미구현
- 기존 피처에서 재활용 가능한 컴포넌트: `RegimeBadge`, `MarketSummaryCard`, `ThesisBadge`, `ThesisList`
- 기존 Supabase 쿼리 패턴이 `features/reports/lib/supabase-queries.ts`, `features/debates/lib/supabase-queries.ts`에 확립됨

## 골 정렬

**SUPPORT** — CEO가 시스템 분석 결과를 빠르게 소비하여 의사결정 속도를 높이는 인프라.
주도섹터/주도주 포착 자체는 아니지만, 포착 결과의 소비 효율을 직접 개선한다.

## 문제

앱을 열면 빈 페이지. CEO가 현재 시장 상황과 시스템 분석 결과를 파악하려면 리포트/토론/추천 페이지를 각각 방문해야 한다.

## Before -> After

| 항목 | Before | After |
|------|--------|-------|
| 홈페이지 | 스켈레톤 (텍스트 2줄) | 4개 섹션 대시보드 |
| 최신 리포트 확인 | /reports에서 목록 클릭 | 홈에서 핵심 요약 즉시 확인 |
| ACTIVE thesis 파악 | /debates에서 날짜별 탐색 | 홈에서 전체 ACTIVE 목록 확인 |
| 추천 성과 파악 | DB 직접 조회 필요 | 홈에서 승률/평균 수익률 요약 |
| 시장 레짐 확인 | /debates 상세에서 개별 확인 | 홈에서 배지 + 최근 추이 확인 |

## 섹션 구성

### 1. 오늘의 리포트 요약

최신 일간 리포트의 핵심 정보를 카드 형태로 표시.

- **데이터 소스**: `daily_reports` 테이블 (type='daily', 최신 1건)
- **표시 항목**:
  - 리포트 날짜
  - Phase 2 비율
  - 주도 섹터 (Badge 목록)
  - 총 분석 종목 수
  - 추천 종목 수 (reportedSymbols 배열 길이)
- **링크**: "상세 보기" -> `/reports/{date}`

### 2. 최근 토론 Thesis

ACTIVE 상태인 thesis 전체 목록.

- **데이터 소스**: `theses` 테이블 (status='ACTIVE')
- **표시 항목**:
  - thesis 본문
  - confidence (low/medium/high)
  - timeframe_days
  - agent_persona
  - category
  - consensus_level
- **정렬**: confidence DESC, 생성일 DESC
- **제한**: 최대 10건 (ACTIVE가 그 이상이면 "더보기" 링크)
- **링크**: "전체 보기" -> `/debates`

### 3. 추천 성과 현황

진행 중인(ACTIVE) 추천 종목의 집계 요약.

- **데이터 소스**: `recommendations` 테이블 (status='ACTIVE')
- **표시 항목**:
  - 활성 추천 종목 수
  - 승률 (pnl_percent > 0인 비율)
  - 평균 수익률 (pnl_percent 평균)
  - 최대 수익률 (max_pnl_percent 최대값)
  - 평균 보유 일수
- **개별 종목 요약**: 상위 5개 (수익률 순) 종목명 + 수익률 표시
- **색상 코딩**: 양수 green, 음수 red

### 4. 시장 레짐

현재 레짐 + 최근 7일 변화 추이.

- **데이터 소스**: `market_regimes` 테이블 (최근 7건)
- **표시 항목**:
  - 최신 레짐 배지 (RegimeBadge 재활용)
  - confidence
  - rationale (2~4줄)
  - 최근 7일 레짐 변화 타임라인 (날짜 + 배지 나열)
- **링크**: "토론 보기" -> `/debates/{latest-date}`

## 데이터 쿼리 설계

### fetchLatestDailyReport

```sql
SELECT id, report_date, type, reported_symbols, market_summary
FROM daily_reports
WHERE type = 'daily'
ORDER BY report_date DESC
LIMIT 1
```

### fetchActiveTheses

```sql
SELECT id, agent_persona, thesis, timeframe_days, confidence,
       consensus_level, category, status, next_bottleneck, dissent_reason
FROM theses
WHERE status = 'ACTIVE'
ORDER BY
  CASE confidence WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
  id DESC
LIMIT 10
```

### fetchRecommendationSummary

```sql
SELECT symbol, pnl_percent, max_pnl_percent, days_held, current_phase, sector
FROM recommendations
WHERE status = 'ACTIVE'
ORDER BY pnl_percent DESC
```

집계는 서버 사이드에서 계산 (총 건수, 승률, 평균 수익률, 최대 수익률, 평균 보유일).

### fetchRecentRegimes

```sql
SELECT regime_date, regime, rationale, confidence
FROM market_regimes
ORDER BY regime_date DESC
LIMIT 7
```

## 컴포넌트 구조

```
frontend/src/features/dashboard/
├── lib/
│   └── supabase-queries.ts      # 4개 쿼리 함수
├── types.ts                      # 대시보드 전용 타입
├── components/
│   ├── DailyReportCard.tsx       # 섹션 1
│   ├── ActiveThesesCard.tsx      # 섹션 2
│   ├── RecommendationCard.tsx    # 섹션 3
│   ├── MarketRegimeCard.tsx      # 섹션 4
│   ├── RegimeTimeline.tsx        # 레짐 7일 타임라인
│   ├── DashboardSkeleton.tsx     # 로딩 스켈레톤
│   └── MetricItem.tsx            # 지표 표시 공용 컴포넌트
└── index.ts                      # barrel export
```

홈페이지 (`app/(main)/page.tsx`)는 Server Component로 유지. 4개 쿼리를 병렬 호출하여 각 카드에 데이터 전달.

## 재활용 컴포넌트

| 기존 컴포넌트 | 위치 | 대시보드 용도 |
|--------------|------|-------------|
| `RegimeBadge` | `features/debates/components/` | 섹션 4 레짐 배지 |
| `ThesisBadge` | `features/debates/components/` | 섹션 2 thesis 상태 배지 |
| `Badge` | `shared/components/ui/` | 섹터 배지, confidence 배지 |
| `Card` 계열 | `shared/components/ui/` | 모든 섹션 카드 |
| `Skeleton` | `shared/components/ui/` | 로딩 상태 |

`RegimeBadge`와 `ThesisBadge`는 현재 debates 피처에 위치하므로, 대시보드에서 직접 import한다 (공용화는 향후 과제).

## 비기능 요구사항

- **성능**: 4개 쿼리 병렬 실행. 전체 페이지 LCP < 2s
- **반응형**: 모바일(1열) / 태블릿(2열) / 데스크탑(2열) 그리드
- **에러 처리**: 섹션별 독립 에러 바운더리. 한 섹션 실패가 다른 섹션 차단하지 않음
- **빈 상태**: 데이터 없는 섹션은 "데이터 없음" 메시지 표시

## 스코프 외 (Out of Scope)

- 차트/그래프 시각화
- 실시간 데이터 업데이트 (WebSocket/SSE)
- 섹션 커스터마이징 (순서 변경, 표시/숨김)
- 추천 종목 개별 상세 페이지
- 추천 종목 히스토리 (과거 CLOSED 종목)
