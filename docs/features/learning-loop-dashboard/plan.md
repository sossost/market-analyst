# Plan: 학습 루프 현황 페이지 (agent_learnings hit rate)

## 문제 정의

`agent_learnings` 테이블에 시스템이 학습한 원칙들(hit/miss count, hit rate)이 쌓이고 있으나,
프론트엔드에서 확인할 방법이 없음. 운영 현황 파악을 위해 학습 원칙 목록 + 요약 통계 페이지 필요.

## Before → After

| | Before | After |
|---|--------|-------|
| 학습 원칙 확인 | DB 직접 조회 필요 | `/learnings` 페이지에서 목록 + 통계 확인 |
| 필터/정렬 | 수동 SQL | active/inactive 필터, category 분류, hit rate 정렬 |
| 요약 통계 | 없음 | 활성 원칙 수, 평균 hit rate, 최근 검증일 카드 |

## 골 정렬

**SUPPORT** — Phase 2 주도섹터/주도주 초입 포착 목표에 직접 기여하지는 않지만,
학습 루프의 건강도를 모니터링하여 분석 정확도 향상을 지원한다.

## 무효 판정

해당 없음. LLM 백테스트 등 무효 패턴 아님. 단순 데이터 조회 UI.

## 변경 사항

### 1. 새 feature 모듈: `frontend/src/features/learnings/`

- `types.ts` — AgentLearning 인터페이스, LearningCategory/VerificationPath 타입
- `constants.ts` — ITEMS_PER_PAGE, 카테고리/필터 라벨, 타입 가드
- `constants.test.ts` — 상수 및 타입 가드 테스트
- `lib/supabase-queries.ts` — fetchLearnings, fetchLearningSummary
- `lib/supabase-queries.test.ts` — 쿼리 매핑 로직 테스트
- `components/LearningsTable.tsx` — 원칙 목록 테이블 (서버 컴포넌트)
- `components/LearningsTableSkeleton.tsx` — 로딩 스켈레톤
- `components/LearningsSummaryCards.tsx` — 요약 통계 카드 3장
- `components/LearningsCategoryFilter.tsx` — active/category 필터 탭 (클라이언트)

### 2. 새 페이지 라우트: `frontend/src/app/(main)/learnings/page.tsx`

### 3. 네비게이션 추가: `nav-items.ts`에 학습 루프 항목

## 작업 계획

1. types.ts, constants.ts 작성
2. constants.test.ts 작성
3. supabase-queries.ts 작성
4. supabase-queries.test.ts 작성
5. 컴포넌트 4개 작성 (Table, Skeleton, SummaryCards, CategoryFilter)
6. 페이지 라우트 작성
7. nav-items.ts에 메뉴 추가
8. 빌드 확인 + 테스트 실행

## 리스크

- P3 이슈이므로 최소 구현. 과도한 기능 추가 없이 읽기 전용 목록만 제공.
- agent_learnings 테이블 데이터가 적을 수 있음 → 빈 상태 UI 필요.
