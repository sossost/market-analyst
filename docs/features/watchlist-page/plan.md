# Plan: 관심종목 페이지 — watchlistStocks 90일 Phase 궤적 시각화

## 문제 정의

`watchlistStocks` 테이블이 #390에서 생성되었으나 프론트엔드에 이를 확인할 수 있는 페이지가 없음.
현재 DB 직접 쿼리만 가능 — 거래일 데이터 쌓이면 시각적 확인 수단 필요.

## Before → After

| | Before | After |
|---|--------|-------|
| 관심종목 확인 | DB 직접 쿼리 | `/watchlist` 페이지에서 목록+상세 확인 |
| Phase 궤적 | jsonb 원시 데이터 | 90일 궤적 차트로 시각화 |
| 5중 교집합 근거 | 코드 리딩 필요 | 카드 UI에 명시 |

## 골 정렬

**SUPPORT** — Phase 2 주도섹터/주도주 초입 포착 시스템의 운영 가시성 제공.
직접적으로 포착 로직을 개선하는 것은 아니지만, 포착된 종목의 궤적을 시각화하여
시스템 성능을 모니터링하고 개선 방향을 판단하는 데 필수적인 지원 기능.

## 무효 판정

해당 없음. LLM 백테스트나 무효 패턴에 해당하지 않음.
순수 프론트엔드 시각화 작업.

## 변경 사항

### 1. 새 파일 생성

**Feature 모듈** (`frontend/src/features/watchlist/`):
- `types.ts` — WatchlistStock, WatchlistStockDetail, PhaseTrajectoryPoint 타입
- `constants.ts` — 상태 라벨, SEPA 등급 라벨, 유효성 검사 함수
- `lib/supabase-queries.ts` — fetchWatchlistStocks, fetchWatchlistStockById
- `components/WatchlistTable.tsx` — 목록 테이블 (서버 컴포넌트)
- `components/WatchlistTableSkeleton.tsx` — 로딩 스켈레톤
- `components/WatchlistStatusFilterTabs.tsx` — ACTIVE/EXITED 필터 (클라이언트)
- `components/WatchlistStatusBadge.tsx` — 상태 배지
- `components/WatchlistDetail.tsx` — 상세 정보 카드
- `components/PhaseTrajectoryChart.tsx` — 90일 궤적 차트 (클라이언트, SVG)
- `components/EntryFactorCard.tsx` — 5중 교집합 근거 카드

**페이지** (`frontend/src/app/(main)/watchlist/`):
- `page.tsx` — 목록 페이지
- `[id]/page.tsx` — 상세 페이지

**테스트**:
- `constants.test.ts` — 상수 및 유효성 검사 함수 테스트
- `components/PhaseTrajectoryChart.test.tsx` — 차트 컴포넌트 테스트

### 2. 기존 파일 수정

- `frontend/src/shared/components/layout/nav-items.ts` — 관심종목 네비게이션 추가

## 차트 구현 전략

외부 차트 라이브러리를 추가하지 않고, SVG 기반으로 직접 구현.
이유:
- phaseTrajectory 데이터가 단순 구조 (`{date, phase, rsScore}[]`)
- Phase는 1~5 정수 — step chart로 충분
- 번들 사이즈 증가 방지

## 작업 계획

1. types.ts, constants.ts 생성 + 테스트
2. supabase-queries.ts 생성
3. 목록 페이지 컴포넌트 (Table, Skeleton, FilterTabs, Badge)
4. 목록 라우트 페이지
5. 상세 페이지 컴포넌트 (Detail, PhaseTrajectoryChart, EntryFactorCard)
6. 상세 라우트 페이지
7. nav-items.ts에 관심종목 추가
8. 테스트 작성 및 검증

## 리스크

- **데이터 없음**: empty state 처리 필수 (이슈에서도 언급)
- **phaseTrajectory null**: jsonb 필드가 null일 수 있음 — 차트 미표시 처리
- **번들 사이즈**: SVG 직접 구현으로 외부 의존성 없음, 리스크 낮음
