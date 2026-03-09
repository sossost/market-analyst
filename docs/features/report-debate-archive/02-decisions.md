# Decisions: 리포트/토론 아카이빙 대시보드

**Created:** 2026-03-09
**Issue:** #117

## Technical Decisions

### 1. 프로젝트 구조

| Option | Pros | Cons |
|--------|------|------|
| A: 모노레포 (/frontend) | DB 타입/스키마 공유 용이. 한 repo에서 관리 | 빌드 설정 복잡해질 수 있음 |
| B: 별도 레포 | 독립 배포/관리. 관심사 완전 분리 | 타입 공유 번거로움. 동기화 필요 |

**Chosen:** A: 모노레포
**Reason:** 기존 Drizzle 스키마와 타입을 직접 공유할 수 있어 생산성 극대화. 프론트가 백엔드 DB 스키마에 강하게 의존하므로 같은 repo가 자연스럽다.

---

### 2. UI 프레임워크

| Option | Pros | Cons |
|--------|------|------|
| A: shadcn/ui + Tailwind | 컴포넌트 복붙 방식으로 커스터마이징 자유. 번들 최소. 대시보드 컴포넌트 다수 | 초기 세팅 시간 |
| B: Chakra UI | 접근성 좋고 빠른 프로토타이핑 | 번들 사이즈 큼. 커스텀 제한적 |
| C: Tailwind only | 의존성 최소 | 컴포넌트 직접 구현 시간 많음 |

**Chosen:** A: shadcn/ui + Tailwind
**Reason:** 대시보드에 필요한 Table, Card, Tabs, Pagination 등이 이미 잘 만들어져 있고, 복붙 방식이라 불필요한 의존성 없이 필요한 것만 가져올 수 있다.

---

### 3. 리포트 데이터 접근 방식

| Option | Pros | Cons |
|--------|------|------|
| A: DB 마이그레이션 | 검색/필터/페이지네이션 자유. Supabase client로 직접 쿼리 | 마이그레이션 작업 필요. 기존 파일 저장 로직 변경 |
| B: API에서 파일 직접 읽기 | 현행 유지. 단순 | 검색/필터 제한. 서버 파일시스템 의존 |
| C: 빌드 타임 정적 생성 | 빠른 로딩 | 실시간성 없음. 빌드마다 재생성 |

**Chosen:** A: DB 마이그레이션
**Reason:** 아카이빙의 핵심은 과거 데이터 탐색. DB 없이는 날짜 범위 검색, 종목 검색 등이 불가능. 마이그레이션 스크립트로 기존 파일 일괄 이관 + 향후 에이전트가 DB에 직접 저장하도록 변경.

---

### 4. 토론 상세 뷰 형태

| Option | Pros | Cons |
|--------|------|------|
| A: 탭 분리 | 라운드별 집중 탐색. 깔끔한 UI | 전체 흐름 파악에 탭 전환 필요 |
| B: 타임라인 스크롤 | 대화 흐름 직관적 | 긴 토론 시 스크롤 과다 |
| C: 애널리스트 기준 분리 | 개인별 추적 용이 | 라운드 간 맥락 단절 |

**Chosen:** A: 탭 분리
**Reason:** 라운드별로 목적이 다르다 (R1: 개별 분석, R2: 반론/보완, 종합: 모더레이터 정리). 탭으로 분리하면 각 라운드의 역할이 명확하게 드러난다.

---

### 5. 인증 방식

| Option | Pros | Cons |
|--------|------|------|
| A: 이메일 Magic Link | 비밀번호 불필요. 초대 방식으로 접근 제어 | 이메일 확인 필요. 실시간성 떨어짐 |
| B: Google OAuth | 편리한 로그인 | 허용 도메인 제한 설정 필요. Google Cloud 설정 |
| C: 이메일/비밀번호 | 전통적 방식 | 비밀번호 관리 부담 |

**Chosen:** A: 이메일 Magic Link
**Reason:** 소수(2-5명) 사용자에게 최적. 비밀번호 관리 부담 없고, 등록된 이메일만 허용하면 자연스러운 접근 제어.

---

### 6. 배포 환경

| Option | Pros | Cons |
|--------|------|------|
| A: Vercel | Next.js 최적화. 무료 티어 충분. Supabase 연동 쉬움 | Vercel 종속 |
| B: 맥미니 셀프호스팅 | 비용 0. 기존 인프라 활용 | 도메인/SSL 설정. 가용성 보장 어려움 |
| C: Cloudflare Pages | 무료 + 빠른 CDN | Next.js 지원 불완전 |

**Chosen:** A: Vercel
**Reason:** Next.js 프로젝트에서 Vercel은 가장 마찰 없는 선택. 무료 티어로 개인/소수 사용자 충분히 커버.

---

### 7. v1 스코프

| Option | Pros | Cons |
|--------|------|------|
| A: 리포트 + 토론 아카이빙 | 기반 확립 + 즉시 활용 가능한 2개 뷰 | Thesis/성과 뷰는 v2로 |
| B: 4개 뷰 전부 | 한 번에 완성 | 규모 큼. 리스크 높음 |
| C: 리포트만 | 최소 범위 | 토론 데이터 활용 지연 |

**Chosen:** A: 리포트 + 토론 아카이빙
**Reason:** 프론트 초기 세팅 + 인증 + DB 마이그레이션이 포함되므로 2개 뷰만으로도 충분한 작업량. 기반이 잡히면 v2 확장은 빠르다.

---

## Architecture

### 디렉토리 구조: 피쳐 기반

```
frontend/src/
├── app/                          ← 라우트만. 로직 최소화
│   ├── layout.tsx
│   ├── page.tsx                  ← 홈 (최근 리포트/토론 요약)
│   ├── login/page.tsx
│   ├── reports/
│   │   ├── page.tsx              ← features/reports에서 import하여 렌더링만
│   │   └── [date]/page.tsx
│   ├── debates/
│   │   ├── page.tsx
│   │   └── [date]/page.tsx
│   ├── error.tsx
│   └── not-found.tsx
│
├── features/
│   ├── auth/
│   │   ├── components/           ← LoginForm
│   │   ├── lib/                  ← supabase client, server, middleware
│   │   └── types.ts
│   ├── reports/
│   │   ├── components/           ← ReportCard, ReportDetail, ReportList
│   │   ├── lib/                  ← 쿼리 함수, 데이터 변환
│   │   └── types.ts
│   └── debates/
│       ├── components/           ← DebateCard, RoundTab, ThesisBadge
│       ├── lib/                  ← 쿼리 함수, 라운드 파싱
│       └── types.ts
│
├── shared/
│   ├── components/
│   │   ├── ui/                   ← shadcn/ui (Button, Card, Table, Tabs, Pagination)
│   │   └── layout/               ← Sidebar, PageHeader
│   ├── lib/
│   │   └── utils.ts              ← cn(), formatDate() 등
│   └── types/                    ← 공통 타입
│
└── middleware.ts                  ← auth 미들웨어 (features/auth/lib 호출)
```

**원칙:**
- `app/`은 라우팅만 — 비즈니스 로직 없음. feature에서 import해서 조립
- `features/`는 자기 완결 — 각 피쳐가 components + lib + types를 갖고 독립 동작
- `shared/`는 2개 이상 피쳐에서 쓸 때만 — 섣불리 올리지 않음

### 스키마/타입 공유

- `tsconfig.json` paths로 백엔드 Drizzle 스키마 타입 직접 참조 (`@db/*` → `../src/db/*`)
- **타입만 import** (`InferSelectModel` 등). DB 클라이언트는 import하지 않음
- 프론트는 Supabase client로 독립적으로 쿼리

### 데이터 페칭

- **Server Components 중심** — Supabase 직접 쿼리 → HTML 렌더링
- React Query 미사용 (읽기 전용이므로 클라이언트 캐시 불필요)
- 페이지네이션/필터는 URL searchParams 기반 → Server Component 재렌더
- 클라이언트 인터랙션이 필요한 곳(탭 전환, 필터 UI)만 `"use client"`

---

## Tech Stack

### Core

| 카테고리 | 선택 | 버전 | 이유 |
|----------|------|------|------|
| 프레임워크 | Next.js | 15 | App Router, React 19, Turbopack |
| 언어 | TypeScript | 5.7+ | 기존 백엔드와 통일 |
| 런타임 | Node.js | 20+ | 기존 환경 유지 |
| 패키지 매니저 | yarn workspaces | 1.x (classic) | CEO 선호. 모노레포 전체 통일 |

### UI

| 카테고리 | 선택 | 이유 |
|----------|------|------|
| 컴포넌트 | shadcn/ui | 복붙 방식. Table, Card, Tabs, Pagination 내장 |
| 스타일 | Tailwind CSS v4 | shadcn/ui 기본. Next.js 15 공식 지원 |
| 아이콘 | lucide-react | shadcn/ui 기본 번들 |
| 토스트 | sonner | shadcn/ui 공식 toast 솔루션 |
| 다크모드 | v1 미지원 | v2에서 `next-themes` 추가 |

### 데이터 & 검증

| 카테고리 | 선택 | 이유 |
|----------|------|------|
| DB 클라이언트 | `@supabase/supabase-js` | 프론트 전용. Drizzle은 백엔드만 |
| 인증 | `@supabase/ssr` | Next.js App Router 쿠키 세션 공식 패키지 |
| 검증 | `zod` | Supabase 응답 파싱, searchParams 검증, 타입 안전 |
| URL 상태 | `nuqs` | searchParams 타입 세이프 관리 |
| 상태관리 | 없음 | Server Components + URL state로 충분 |

### 유틸

| 카테고리 | 선택 | 이유 |
|----------|------|------|
| 날짜 | `date-fns` | 트리쉐이킹 우수. 날짜 필터/포맷 |
| 마크다운 | `react-markdown` + `remark-gfm` | 리포트 본문 렌더링 |
| 클래스 병합 | `clsx` + `tailwind-merge` | shadcn/ui `cn()` 기본 의존성 |

### 품질

| 카테고리 | 선택 | 이유 |
|----------|------|------|
| 린트 | ESLint + `eslint-config-next` | Next.js 공식 규칙 |
| 포맷 | Prettier + `prettier-plugin-tailwindcss` | 클래스 자동 정렬 |
| 테스트 (단위) | Vitest + React Testing Library | 백엔드와 통일 |
| 테스트 (E2E) | Playwright | 로그인 → 리포트 열람 플로우 |
| 타입체크 | `tsc --noEmit` | CI에서 실행 |

### 명시적 제외

| 제외 대상 | 이유 |
|-----------|------|
| React Query / SWR | 읽기 전용 SSR. 클라이언트 캐시 불필요 |
| Zustand / Jotai | 글로벌 상태 없음 |
| React Hook Form | 로그인 폼 하나. 네이티브 form 충분 |
| CSS Modules | Tailwind 단일 전략 |
| `@tanstack/react-table` | shadcn Table로 충분. 정렬/필터 서버사이드 |
| i18n | 한글 단일 언어 |

### Dependencies 미리보기

```json
{
  "dependencies": {
    "next": "^15",
    "react": "^19",
    "react-dom": "^19",
    "@supabase/supabase-js": "^2",
    "@supabase/ssr": "^0.5",
    "zod": "^3",
    "nuqs": "^2",
    "date-fns": "^4",
    "react-markdown": "^9",
    "remark-gfm": "^4",
    "lucide-react": "latest",
    "clsx": "^2",
    "tailwind-merge": "^2",
    "sonner": "^1"
  },
  "devDependencies": {
    "typescript": "^5.7",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "tailwindcss": "^4",
    "@tailwindcss/postcss": "^4",
    "eslint": "^9",
    "eslint-config-next": "^15",
    "prettier": "^3",
    "prettier-plugin-tailwindcss": "^0.6",
    "vitest": "^3",
    "@testing-library/react": "^16",
    "@vitejs/plugin-react": "^4"
  }
}
```
