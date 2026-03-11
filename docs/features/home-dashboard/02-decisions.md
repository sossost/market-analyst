# Decisions: Home Dashboard

## Decision 1: Server Component vs Client Component

**Date:** 2026-03-11
**Status:** accepted

### Context
홈페이지가 서버에서 데이터를 가져와 렌더링해야 한다. Client Component로 만들면 useEffect/useState가 필요하고, Server Component로 만들면 async/await로 직접 데이터를 가져올 수 있다.

### Options

| Option | Pros | Cons |
|--------|------|------|
| A. Server Component (async page) | SSR로 SEO/LCP 우수, Supabase 서버 클라이언트 재활용, 코드 단순 | 실시간 업데이트 불가 (스코프 외이므로 문제 없음) |
| B. Client Component + fetch | 클라이언트 인터랙션 자유 | 불필요한 복잡도, 워터폴 위험, 로딩 상태 관리 필요 |

### Decision
**Option A** — Server Component. 기존 reports/debates 페이지와 동일한 패턴. 대시보드에 클라이언트 인터랙션이 필요한 요소가 없다.

## Decision 2: 피처 디렉토리 구조

**Date:** 2026-03-11
**Status:** accepted

### Context
대시보드는 여러 도메인(리포트, 토론, 추천, 레짐)의 데이터를 소비한다. 기존 피처 폴더에 넣을 수도, 독립 피처로 만들 수도 있다.

### Decision
`features/dashboard/` 독립 피처로 생성. 이유:
1. 여러 도메인의 데이터를 집계하는 "읽기 전용 뷰"이므로 특정 도메인에 속하지 않음
2. 대시보드 전용 쿼리(집계/요약)는 기존 피처의 쿼리와 목적이 다름
3. 기존 피처의 컴포넌트는 import로 재활용 (복사 아님)

## Decision 3: RegimeBadge/ThesisBadge 공용화 여부

**Date:** 2026-03-11
**Status:** accepted

### Context
`RegimeBadge`와 `ThesisBadge`는 debates 피처에 있지만 대시보드에서도 필요하다.

### Options

| Option | Pros | Cons |
|--------|------|------|
| A. shared/로 이동 | 정석. 피처 간 의존 없음 | 기존 debates 코드 import 변경 필요, 이 PR 스코프 초과 |
| B. debates에서 직접 import | 변경 최소. 즉시 사용 가능 | 피처 간 직접 의존 발생 |
| C. 대시보드에 복제 | 의존 없음 | DRY 위반 |

### Decision
**Option B** — debates에서 직접 import. 공용화는 별도 이슈로 분리. 현재 2개 피처에서만 사용하므로 Rule of Three에 도달하지 않았다.

## Decision 4: 추천 성과 집계 위치

**Date:** 2026-03-11
**Status:** accepted

### Context
추천 종목 승률/평균 수익률 등 집계를 DB에서 할지, 서버 사이드 코드에서 할지.

### Decision
서버 사이드(TypeScript)에서 집계. 이유:
1. ACTIVE 추천 종목은 보통 10~30건 수준 — 전량 조회해도 부담 없음
2. Supabase JS 클라이언트에서 복잡한 집계 쿼리보다 코드 집계가 가독성 우수
3. 향후 집계 로직 변경 시 마이그레이션 없이 코드만 수정

## Decision 5: 에러 격리 전략

**Date:** 2026-03-11
**Status:** accepted

### Context
4개 섹션 중 하나의 DB 쿼리가 실패하면 전체 페이지를 차단할지, 해당 섹션만 에러 표시할지.

### Decision
`Promise.allSettled`로 4개 쿼리를 병렬 실행. 각 섹션은 자체 데이터가 없으면 "데이터를 불러올 수 없습니다" 표시. 나머지 섹션은 정상 렌더링. 이유:
1. 대시보드는 "전부 아니면 없음"이 아니라 "가능한 만큼 보여주기"가 적합
2. 섹션별 데이터 소스가 독립적이므로 한 테이블 장애가 전체를 차단하면 안 됨

## Decision 6: 그리드 레이아웃

**Date:** 2026-03-11
**Status:** accepted

### Decision
2x2 그리드 (데스크탑/태블릿), 1열 스택 (모바일).
- 상단: 리포트 요약 | 시장 레짐
- 하단: ACTIVE Thesis | 추천 성과

이유: 리포트 요약과 시장 레짐은 "현재 상태" 파악용이므로 상단. Thesis와 추천은 "진행 중인 항목" 목록이므로 하단.
