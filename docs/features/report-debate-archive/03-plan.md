# Implementation Plan: 프론트엔드 초기 세팅 (이슈 #118)

**Created:** 2026-03-09
**Issue:** #118
**Scope:** Next.js 15 프론트엔드 스캐폴딩. 인증/데이터/배포는 별도 이슈.

---

## 전제 조건

- 루트 `package.json`에 `"workspaces": ["frontend"]` 추가 필요 (Phase 1 Step 0)
- Node.js 20+, npm 10+ 환경
- Supabase 프로젝트 URL + Anon Key 보유 (`.env.local`에 설정)

---

## Phase 1: 프로젝트 생성 및 기반 설정

의존 관계: 없음. 가장 먼저 실행.

### Step 1-0: 루트 워크스페이스 설정

**담당:** 실행팀
**예상 소요:** 5분

루트 `package.json`에 workspaces 필드를 추가한다.

```json
{
  "workspaces": ["frontend"]
}
```

**AC:**
- `cat package.json | grep -A2 workspaces` 결과에 `"frontend"` 포함
- 루트에서 `npm install` 실행 시 에러 없음

---

### Step 1-1: Next.js 15 프로젝트 생성

**담당:** 실행팀
**예상 소요:** 10분

`/Users/jang-yunsu/market-analyst/frontend` 위치에 Next.js 15 프로젝트를 생성한다.

실행 명령:
```bash
cd /Users/jang-yunsu/market-analyst
npx create-next-app@latest frontend \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --src-dir \
  --no-import-alias \
  --turbopack
```

`create-next-app` 인터랙티브 프롬프트가 뜰 경우 다음 옵션으로 응답:
- Would you like to use Tailwind CSS? → Yes
- Would you like your code inside a `src/` directory? → Yes
- Would you like to use Turbopack? → Yes

생성 후 `frontend/package.json`의 Next.js 버전이 `^15`인지 확인한다. 15 미만이면
`package.json`을 직접 수정 후 `npm install` 재실행.

**AC:**
- `frontend/` 디렉토리 존재
- `frontend/src/app/` 디렉토리 존재
- `frontend/package.json`에 `"next": "^15"` 포함
- `cd frontend && npm run build` 성공 (초기 빌드)

---

### Step 1-2: 불필요한 보일러플레이트 제거

**담당:** 실행팀
**예상 소요:** 5분

`create-next-app`이 생성한 기본 파일 중 이 프로젝트에서 사용하지 않는 것을 제거한다.

제거 대상:
- `frontend/src/app/page.tsx` 내용 → 빈 placeholder로 교체 (삭제 아님)
- `frontend/src/app/globals.css` → Tailwind directives만 남기고 나머지 제거
- `frontend/public/` 내 샘플 SVG 파일들

`frontend/src/app/globals.css` 최종 형태:
```css
@import "tailwindcss";
```

**AC:**
- `globals.css`에 Tailwind import만 존재
- `npm run dev` 후 `http://localhost:3000` 접근 시 빈 페이지 또는 placeholder 렌더링
- 콘솔 에러 없음

---

### Step 1-3: TypeScript 설정 강화

**담당:** 실행팀
**예상 소요:** 10분

`frontend/tsconfig.json`을 수정하여 엄격 모드와 백엔드 타입 경로 alias를 설정한다.

`frontend/tsconfig.json` 핵심 설정:
```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "paths": {
      "@/*": ["./src/*"],
      "@db/*": ["../src/db/*"]
    }
  }
}
```

`@db/*` alias는 백엔드 Drizzle 스키마 타입을 프론트에서 직접 참조하기 위함이다.
**타입만 import** — DB 클라이언트, 런타임 코드는 import하지 않는다.

**AC:**
- `npx tsc --noEmit` (frontend 디렉토리 내) 에러 없음
- `@/*` alias가 `src/` 하위 경로를 올바르게 resolve

---

### Step 1-4: ESLint + Prettier 설정

**담당:** 실행팀
**예상 소요:** 10분

`create-next-app`이 생성한 ESLint 설정을 유지하고 Prettier를 추가한다.

```bash
cd frontend
npm install --save-dev prettier prettier-plugin-tailwindcss
```

`frontend/.prettierrc` 파일 생성:
```json
{
  "semi": false,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "all",
  "plugins": ["prettier-plugin-tailwindcss"]
}
```

`frontend/.prettierignore` 파일 생성:
```
.next/
node_modules/
```

루트 `package.json`의 `scripts`에 프론트 lint/format 명령 추가:
```json
{
  "scripts": {
    "frontend:dev": "npm run dev --workspace=frontend",
    "frontend:build": "npm run build --workspace=frontend",
    "frontend:lint": "npm run lint --workspace=frontend",
    "frontend:typecheck": "tsc --noEmit --project frontend/tsconfig.json"
  }
}
```

**AC:**
- `cd frontend && npx prettier --check src/` 에러 없음 (또는 "All matched files use Prettier code style!")
- `cd frontend && npm run lint` 에러 없음
- `prettier-plugin-tailwindcss`가 Tailwind 클래스 자동 정렬

---

## Phase 2: shadcn/ui 설치 및 컴포넌트 추가

의존 관계: Phase 1 완료 후 실행.

### Step 2-1: shadcn/ui 초기화

**담당:** 실행팀
**예상 소요:** 10분

```bash
cd /Users/jang-yunsu/market-analyst/frontend
npx shadcn@latest init
```

인터랙티브 프롬프트 응답:
- Style → Default
- Base color → Slate
- CSS variables for colors → Yes

초기화가 완료되면 `frontend/src/shared/components/ui/` 디렉토리가 생성된다.

`shadcn/ui` 기본 설치 위치(`src/components/ui/`)와 이 프로젝트 구조(`src/shared/components/ui/`)가 다르다.
`components.json`의 `aliases.ui` 를 확인하고 `@/shared/components/ui`로 설정:

`frontend/components.json`:
```json
{
  "aliases": {
    "components": "@/shared/components",
    "ui": "@/shared/components/ui",
    "utils": "@/shared/lib/utils",
    "lib": "@/shared/lib",
    "hooks": "@/shared/hooks"
  }
}
```

**AC:**
- `frontend/components.json` 존재
- `frontend/src/shared/lib/utils.ts` 존재 (`cn()` 함수 포함)
- `frontend/src/app/globals.css`에 CSS 변수 추가됨

---

### Step 2-2: 기본 컴포넌트 설치

**담당:** 실행팀
**예상 소요:** 5분

이슈 #118 스코프에서 요구한 컴포넌트를 일괄 설치한다.

```bash
cd /Users/jang-yunsu/market-analyst/frontend
npx shadcn@latest add button card table tabs pagination badge separator skeleton
```

추가 설명:
- `badge`: 토론 상세에서 thesis 상태(ACTIVE/CONFIRMED/INVALIDATED/EXPIRED) 표시용
- `separator`: 레이아웃 구분선
- `skeleton`: 로딩 상태 표시용

**AC:**
- `frontend/src/shared/components/ui/` 하위에 `button.tsx`, `card.tsx`, `table.tsx`, `tabs.tsx`, `pagination.tsx`, `badge.tsx`, `separator.tsx`, `skeleton.tsx` 존재
- 각 파일이 정상 import/export되는지 `tsc --noEmit`으로 확인

---

## Phase 3: 디렉토리 구조 스캐폴딩

의존 관계: Phase 2 완료 후 실행.

### Step 3-1: 피쳐 디렉토리 생성

**담당:** 실행팀
**예상 소요:** 10분

`02-decisions.md`에 정의된 디렉토리 구조를 생성한다.
각 디렉토리에는 `index.ts` 또는 placeholder 파일을 배치하여 빈 디렉토리가 Git에 추적되도록 한다.

생성할 구조:
```
frontend/src/
├── features/
│   ├── auth/
│   │   ├── components/.gitkeep
│   │   ├── lib/.gitkeep
│   │   └── types.ts
│   ├── reports/
│   │   ├── components/.gitkeep
│   │   ├── lib/.gitkeep
│   │   └── types.ts
│   └── debates/
│       ├── components/.gitkeep
│       ├── lib/.gitkeep
│       └── types.ts
└── shared/
    ├── components/
    │   └── layout/.gitkeep
    ├── lib/
    │   └── utils.ts     ← shadcn init이 생성. 이미 존재하면 유지.
    └── types/
        └── index.ts
```

각 `types.ts`는 빈 파일이 아닌 해당 피쳐의 기본 타입 선언을 포함한다.

`frontend/src/features/auth/types.ts`:
```typescript
export interface AuthUser {
  id: string
  email: string
}
```

`frontend/src/features/reports/types.ts`:
```typescript
export interface Report {
  id: number
  reportDate: string
  type: 'daily' | 'weekly'
}
```

`frontend/src/features/debates/types.ts`:
```typescript
export type DebateRound = 'round1' | 'round2' | 'synthesis'

export interface DebateSession {
  id: number
  debateDate: string
}
```

`frontend/src/shared/types/index.ts`:
```typescript
export interface PaginationParams {
  page: number
  limit: number
}

export interface PaginatedResult<T> {
  data: T[]
  total: number
  page: number
  hasNextPage: boolean
}
```

**AC:**
- `ls frontend/src/features/` 결과에 `auth`, `reports`, `debates` 존재
- 모든 `types.ts` 파일이 TypeScript 에러 없이 컴파일

---

### Step 3-2: 레이아웃 컴포넌트 스캐폴딩

**담당:** 실행팀
**예상 소요:** 20분

사이드바(데스크탑) + 하단 탭바(모바일) 레이아웃을 구현한다.

`frontend/src/shared/components/layout/Sidebar.tsx`:
- 데스크탑(`md:` 이상)에서만 표시
- 네비게이션 항목: 홈(`/`), 리포트(`/reports`), 토론(`/debates`)
- lucide-react 아이콘: `Home`, `FileText`, `MessageSquare`
- 현재 경로 활성화 표시 (`usePathname` 사용 → `"use client"`)

`frontend/src/shared/components/layout/MobileNav.tsx`:
- 모바일(`md:` 미만)에서만 표시
- 화면 하단 고정 (`fixed bottom-0`)
- 동일 네비게이션 항목

`frontend/src/shared/components/layout/AppLayout.tsx`:
- `Sidebar` + `MobileNav` + children 조합
- 전체 레이아웃 래퍼

`frontend/src/app/layout.tsx`에 `AppLayout` 적용:
```tsx
import { AppLayout } from '@/shared/components/layout/AppLayout'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <AppLayout>{children}</AppLayout>
      </body>
    </html>
  )
}
```

단, `/login` 페이지는 `AppLayout`을 사용하지 않는다.
`frontend/src/app/login/layout.tsx`를 별도로 만들어 기본 body만 렌더링한다.

**AC:**
- `npm run dev` 후 `http://localhost:3000`에서 사이드바 렌더링 확인 (데스크탑)
- 모바일 뷰포트(`375px`)에서 하단 탭바 렌더링 확인
- `/login` 페이지에는 사이드바/탭바 미표시
- TypeScript 에러 없음

---

## Phase 4: 페이지 라우트 스캐폴딩

의존 관계: Phase 3 완료 후 실행.

### Step 4-1: 모든 라우트에 placeholder 페이지 생성

**담당:** 실행팀
**예상 소요:** 15분

이슈 #118에서 요구한 모든 라우트에 placeholder 페이지를 생성한다.
각 페이지는 향후 피쳐 구현 시 교체되므로 최소한의 내용만 포함한다.

**생성 파일 목록:**

`frontend/src/app/page.tsx` (홈 - 최근 리포트/토론 요약 자리):
```tsx
export default function HomePage() {
  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold">홈</h1>
      <p className="text-muted-foreground mt-2">최근 리포트/토론 요약이 여기에 표시됩니다.</p>
    </main>
  )
}
```

`frontend/src/app/reports/page.tsx`:
```tsx
export default function ReportsPage() {
  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold">리포트</h1>
      <p className="text-muted-foreground mt-2">리포트 목록이 여기에 표시됩니다.</p>
    </main>
  )
}
```

`frontend/src/app/reports/[date]/page.tsx`:
```tsx
interface Props {
  params: Promise<{ date: string }>
}

export default async function ReportDetailPage({ params }: Props) {
  const { date } = await params
  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold">리포트 상세</h1>
      <p className="text-muted-foreground mt-2">{date} 리포트가 여기에 표시됩니다.</p>
    </main>
  )
}
```

`frontend/src/app/debates/page.tsx`:
```tsx
export default function DebatesPage() {
  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold">토론</h1>
      <p className="text-muted-foreground mt-2">토론 목록이 여기에 표시됩니다.</p>
    </main>
  )
}
```

`frontend/src/app/debates/[date]/page.tsx`:
```tsx
interface Props {
  params: Promise<{ date: string }>
}

export default async function DebateDetailPage({ params }: Props) {
  const { date } = await params
  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold">토론 상세</h1>
      <p className="text-muted-foreground mt-2">{date} 토론이 여기에 표시됩니다.</p>
    </main>
  )
}
```

`frontend/src/app/login/page.tsx`:
```tsx
export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm p-6">
        <h1 className="text-2xl font-bold">로그인</h1>
        <p className="text-muted-foreground mt-2">Magic Link 로그인 폼이 여기에 표시됩니다.</p>
      </div>
    </main>
  )
}
```

**에러/낫파운드 페이지:**

`frontend/src/app/error.tsx`:
```tsx
'use client'

interface Props {
  error: Error
  reset: () => void
}

export default function ErrorPage({ error, reset }: Props) {
  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold text-destructive">오류가 발생했습니다</h1>
      <p className="text-muted-foreground mt-2">{error.message}</p>
      <button onClick={reset} className="mt-4 text-sm underline">
        다시 시도
      </button>
    </main>
  )
}
```

`frontend/src/app/not-found.tsx`:
```tsx
export default function NotFoundPage() {
  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold">페이지를 찾을 수 없습니다</h1>
      <p className="text-muted-foreground mt-2">요청한 페이지가 존재하지 않습니다.</p>
    </main>
  )
}
```

**AC:**
- `npm run dev` 실행 후 다음 URL이 모두 200 응답:
  - `http://localhost:3000/`
  - `http://localhost:3000/reports`
  - `http://localhost:3000/reports/2026-03-09`
  - `http://localhost:3000/debates`
  - `http://localhost:3000/debates/2026-03-09`
  - `http://localhost:3000/login`
- 존재하지 않는 라우트(`/unknown`) 접근 시 not-found 페이지 렌더링
- TypeScript 에러 없음 (`tsc --noEmit`)

---

## Phase 5: Supabase 클라이언트 설정

의존 관계: Phase 4 완료 후 실행. (환경변수 준비 필요)

### Step 5-1: Supabase 패키지 설치

**담당:** 실행팀
**예상 소요:** 5분

```bash
cd /Users/jang-yunsu/market-analyst/frontend
npm install @supabase/supabase-js @supabase/ssr
```

**AC:**
- `frontend/package.json`에 `@supabase/supabase-js` 및 `@supabase/ssr` 포함
- `npm install` 에러 없음

---

### Step 5-2: 환경변수 파일 생성

**담당:** 실행팀
**예상 소요:** 5분

`frontend/.env.local` (gitignore 대상, 실제 값 입력 필요):
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

`frontend/.env.local.example` (커밋 대상, 가이드용):
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

`frontend/.gitignore`에 `.env.local` 포함 여부 확인. `create-next-app`이 기본 포함하지만
명시적으로 확인:
```
.env.local
```

**AC:**
- `frontend/.env.local.example` 존재
- `frontend/.gitignore`에 `.env.local` 포함
- `frontend/.env.local`이 Git에 추적되지 않음 (`git status` 확인)

---

### Step 5-3: Supabase 클라이언트 모듈 생성

**담당:** 실행팀
**예상 소요:** 15분

`@supabase/ssr` 공식 패턴에 따라 3개 클라이언트를 생성한다.

`frontend/src/features/auth/lib/supabase-browser.ts` (클라이언트 컴포넌트용):
```typescript
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
```

`frontend/src/features/auth/lib/supabase-server.ts` (Server Component/Server Action용):
```typescript
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Server Component에서 set 불가 — 무시
          }
        },
      },
    },
  )
}
```

`frontend/src/middleware.ts` (인증 미들웨어 stub):
```typescript
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  // 인증 미들웨어 구현은 #119 (인증 이슈)에서 완성
  // 현재는 세션 갱신만 처리
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  await supabase.auth.getUser()

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

**중요:** 미들웨어에서 인증 리다이렉트는 구현하지 않는다. 인증 로직은 #119에서 담당.
이 step의 목적은 Supabase 클라이언트 모듈 구조 확립만이다.

**AC:**
- `frontend/src/features/auth/lib/supabase-browser.ts` 존재
- `frontend/src/features/auth/lib/supabase-server.ts` 존재
- `frontend/src/middleware.ts` 존재
- `tsc --noEmit` 에러 없음
- `npm run dev` 실행 시 콘솔에 Supabase 관련 에러 없음 (환경변수가 올바른 경우)

---

## Phase 6: 추가 의존성 설치 및 검증

의존 관계: Phase 5 완료 후 실행.

### Step 6-1: 나머지 의존성 설치

**담당:** 실행팀
**예상 소요:** 5분

```bash
cd /Users/jang-yunsu/market-analyst/frontend
npm install zod nuqs date-fns react-markdown remark-gfm sonner
```

**AC:**
- `frontend/package.json` dependencies에 위 패키지 모두 포함
- `npm install` 에러 없음

---

### Step 6-2: Vitest + React Testing Library 설정

**담당:** 실행팀
**예상 소요:** 15분

```bash
cd /Users/jang-yunsu/market-analyst/frontend
npm install --save-dev @vitejs/plugin-react @testing-library/react @testing-library/user-event jsdom
```

`frontend/vitest.config.ts`:
```typescript
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
})
```

`frontend/src/test/setup.ts`:
```typescript
import '@testing-library/jest-dom'
```

`frontend/package.json` scripts 추가:
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

smoke test 파일 생성 `frontend/src/test/smoke.test.ts`:
```typescript
import { describe, expect, it } from 'vitest'

describe('smoke test', () => {
  it('test environment works', () => {
    expect(true).toBe(true)
  })
})
```

**AC:**
- `cd frontend && npm test` 실행 시 smoke test 통과
- `vite-tsconfig-paths`가 `@/*` alias를 테스트 환경에서도 정상 resolve

---

### Step 6-3: 최종 검증

**담당:** 실행팀
**예상 소요:** 10분

모든 Phase 완료 후 다음 체크리스트를 순서대로 실행하여 이슈 #118의 AC를 최종 확인한다.

```bash
# 1. 타입 체크
cd /Users/jang-yunsu/market-analyst/frontend
npx tsc --noEmit

# 2. 린트
npm run lint

# 3. 테스트
npm test

# 4. 개발 서버 실행
npm run dev
```

개발 서버 실행 후 브라우저에서 수동 확인:
- [ ] `http://localhost:3000/` → placeholder 홈 페이지
- [ ] `http://localhost:3000/reports` → placeholder 리포트 목록
- [ ] `http://localhost:3000/reports/2026-03-09` → placeholder 리포트 상세
- [ ] `http://localhost:3000/debates` → placeholder 토론 목록
- [ ] `http://localhost:3000/debates/2026-03-09` → placeholder 토론 상세
- [ ] `http://localhost:3000/login` → placeholder 로그인 (사이드바 없음)
- [ ] `http://localhost:3000/nonexistent` → not-found 페이지
- [ ] 데스크탑 뷰: 좌측 사이드바 표시
- [ ] 모바일 뷰(375px): 하단 탭바 표시, 사이드바 미표시
- [ ] shadcn/ui Button 컴포넌트 import 후 렌더링 확인

**AC (이슈 #118 최종):**
- `cd frontend && npm run dev`로 로컬 실행 가능
- 모든 라우트에 placeholder 페이지 렌더링 (에러 없음)
- shadcn/ui 컴포넌트 (Button, Card, Table, Tabs, Pagination) 정상 import 및 렌더링
- TypeScript strict 모드 에러 없음
- ESLint 에러 없음
- `npm test` 통과

---

## 의존 관계 요약

```
Phase 1 (기반)
├── Step 1-0: 워크스페이스 설정
├── Step 1-1: Next.js 생성         ← 1-0 완료 후
├── Step 1-2: 보일러플레이트 제거   ← 1-1 완료 후
├── Step 1-3: TypeScript 설정      ← 1-1 완료 후 (1-2와 병렬 가능)
└── Step 1-4: ESLint/Prettier      ← 1-1 완료 후 (1-2, 1-3과 병렬 가능)

Phase 2 (UI 기반)                  ← Phase 1 전체 완료 후
├── Step 2-1: shadcn 초기화
└── Step 2-2: 컴포넌트 설치         ← 2-1 완료 후

Phase 3 (구조)                     ← Phase 2 전체 완료 후
├── Step 3-1: 피쳐 디렉토리
└── Step 3-2: 레이아웃 컴포넌트     ← 3-1 완료 후

Phase 4 (라우트)                   ← Phase 3 전체 완료 후
└── Step 4-1: 모든 페이지 생성

Phase 5 (Supabase)                 ← Phase 4 완료 후
├── Step 5-1: 패키지 설치
├── Step 5-2: 환경변수              ← 5-1과 병렬 가능
└── Step 5-3: 클라이언트 모듈       ← 5-1, 5-2 완료 후

Phase 6 (마무리)                   ← Phase 5 완료 후
├── Step 6-1: 나머지 의존성
├── Step 6-2: Vitest 설정          ← 6-1과 병렬 가능
└── Step 6-3: 최종 검증            ← 6-1, 6-2 완료 후
```

---

## 스코프 경계

이 플랜(이슈 #118)에서 **하지 않는 것**:

| 항목 | 담당 이슈 |
|------|-----------|
| Supabase Auth 미들웨어 인증 리다이렉트 | #119 (인증 이슈) |
| Magic Link 로그인 폼 구현 | #119 |
| `daily_reports` DB 마이그레이션 | 별도 이슈 |
| 리포트/토론 실제 데이터 쿼리 | 별도 이슈 |
| Vercel 배포 설정 | 별도 이슈 |
| E2E 테스트 (Playwright) | 별도 이슈 |

---

## 예상 총 소요 시간

| Phase | Steps | 예상 시간 |
|-------|-------|-----------|
| Phase 1 | 5 steps | 40분 |
| Phase 2 | 2 steps | 15분 |
| Phase 3 | 2 steps | 30분 |
| Phase 4 | 1 step | 15분 |
| Phase 5 | 3 steps | 25분 |
| Phase 6 | 3 steps | 30분 |
| **합계** | **16 steps** | **~2.5시간** |
