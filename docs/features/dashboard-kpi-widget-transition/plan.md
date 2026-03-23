# Plan: 대시보드 KPI 위젯 전환 — thesis 적중률 + 포착 선행성

## 문제 정의

#390 인사이트 브리핑 전환으로 KPI가 변경됨:
- 기존: 추천 승률 (수익 실현률) — `RecommendationCard`
- 변경: **thesis 적중률** + **포착 선행성**

현재 대시보드의 `RecommendationCard`가 구 KPI 기준(추천 승률, 평균 수익률 등)으로 되어 있어 교체 필요.

## 골 정렬

- **판정: ALIGNED**
- Phase 2 주도섹터/주도주 초입 포착 목표의 핵심 KPI 2개(thesis 적중률, 포착 선행성)를 대시보드에 가시화
- ROADMAP.md "성공의 정의" 섹션에 명시된 KPI와 직접 대응

## 무효 판정

- **판정: 해당 없음**
- LLM 백테스트 등 무효 패턴에 해당하지 않음. 순수 프론트엔드 UI 교체.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| 4번째 대시보드 섹션 | `RecommendationCard` (추천 승률/수익률) | `ThesisHitRateCard` (thesis 적중률 + 포착 선행성) |
| ActiveThesesCard | ACTIVE thesis 목록만 표시 | ACTIVE 목록 + 상단에 적중/무효 비율 요약 |

## 변경 사항

### 1. 새 쿼리 함수 (`supabase-queries.ts`)

- `fetchThesisStats()`: theses 테이블에서 CONFIRMED/INVALIDATED 건수 조회
  - 반환: `{ confirmedCount, invalidatedCount, activeCount, expiredCount }`
- `fetchCaptureLeadStats()`: watchlist_stocks 테이블에서 EXITED 종목의 포착 선행성 계산
  - 반환: `{ totalResolved, avgLeadDays, measurable }`
  - measurable = totalResolved >= 10

### 2. 새 타입 (`types.ts`)

```typescript
interface ThesisStats {
  confirmedCount: number
  invalidatedCount: number
  activeCount: number
  expiredCount: number
}

interface CaptureLeadStats {
  totalResolved: number
  avgLeadDays: number | null
  measurable: boolean
}
```

### 3. 새 컴포넌트: `ThesisHitRateCard`

- `RecommendationCard`를 교체
- 표시 항목:
  - Thesis 적중률: CONFIRMED / (CONFIRMED + INVALIDATED), 목표 50%+
  - 포착 선행성: 측정 가능 시 평균 선행일수, 아니면 "측정 중 (N/10건)"
  - 전체 thesis 현황: ACTIVE / CONFIRMED / INVALIDATED / EXPIRED 건수

### 4. `ActiveThesesCard` 보강

- 카드 상단에 적중/무효 비율 요약 추가 (예: "적중 5 / 무효 3 — 62.5%")
- 기존 ACTIVE 목록은 유지

### 5. 대시보드 페이지 (`page.tsx`)

- `RecommendationCard` → `ThesisHitRateCard`로 교체
- 섹션 타이틀: "추천 성과 현황" → "Thesis KPI"

## 작업 계획

1. `types.ts`에 `ThesisStats`, `CaptureLeadStats` 타입 추가
2. `supabase-queries.ts`에 `fetchThesisStats()`, `fetchCaptureLeadStats()` 추가
3. `ThesisHitRateCard.tsx` 컴포넌트 생성
4. `ActiveThesesCard.tsx`에 적중/무효 요약 추가
5. `page.tsx` 대시보드 섹션 교체
6. 테스트 작성: `ThesisHitRateCard.test.tsx`, `ActiveThesesCard.test.tsx` 업데이트
7. 기존 `RecommendationCard` 관련 코드는 삭제하지 않음 (향후 필요 시 복원 가능)

## 리스크

- **데이터 부족**: 초기에는 CONFIRMED/INVALIDATED 건수가 0일 수 있음 → "데이터 수집 중" 상태 표시로 대응
- **포착 선행성 계산**: watchlist_stocks에 EXITED 데이터가 10건 미만이면 측정 불가 → 진행 상태 표시
- **기존 RecommendationCard 제거 범위**: 이슈에서 "교체/추가"로 명시 → RecommendationCard를 ThesisHitRateCard로 대체, 기존 파일은 유지
