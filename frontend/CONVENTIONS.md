# Frontend Conventions — Next.js App Router 특화

일반 코딩 규칙은 `~/.claude/rules/coding-style.md` 참조.
이 문서는 Next.js App Router 맥락의 프론트엔드 패턴만 다룬다.

**에이전트는 구현 전 이 문서를 반드시 읽는다.**

---

## 1. 비동기 데이터 — AsyncBoundary 패턴

- async Server Component는 **반드시 `AsyncBoundary`로 감싼다**
- 에러는 throw → ErrorBoundary가 잡는다. **try-catch로 삼키지 않는다**
- "데이터 없음"(null)과 "에러"(throw)는 반드시 구분
- **페이지 컴포넌트는 fetch하지 않는다 — 조립만**

```tsx
// page.tsx — 조립만
<AsyncBoundary
  pendingFallback={<Skeleton />}
  errorFallback={<ErrorCard />}
>
  <DataCard />  {/* async Server Component, 자기 데이터 직접 fetch */}
</AsyncBoundary>
```

---

## 2. 3가지 상태 구분

| 상태 | 처리 | UI |
|------|------|-----|
| 로딩 | Suspense (via AsyncBoundary) | CardSkeleton |
| 에러 | ErrorBoundary (via AsyncBoundary) | CardError |
| 빈 상태 | 컴포넌트 내부 null 체크 | "데이터가 없습니다" |

---

## 3. 데이터 fetch

- 쿼리 함수: `features/{feature}/lib/supabase-queries.ts`
- 에러 → `throw new Error()`, null → 데이터 없음
- DB snake_case → camelCase 변환은 쿼리 함수에서

---

## 4. 카드 레이아웃

- `Card className="flex h-full flex-col"` + `CardContent className="flex-1"` → 푸터 하단 고정
- 반응형: `grid-cols-1 md:grid-cols-2`

---

## 5. loading.tsx

- AsyncBoundary로 섹션별 Suspense가 있으면 **loading.tsx 불필요**
- 페이지 전체가 단일 async 작업인 경우에만 사용

---

## 6. 공유 컴포넌트 (shared/)

| 컴포넌트 | 역할 |
|----------|------|
| `AsyncBoundary` | ErrorBoundary + Suspense 통합 |
| `ErrorBoundary` | 클래스 컴포넌트 (React API 요구) |
| `MarkdownContent` | react-markdown + remark-gfm 래퍼 |
| shadcn/ui | Card, Badge, Button 등 |

---

## 7. 테스트

- Vitest + React Testing Library
- 쿼리 함수: Supabase mock 단위 테스트
- 컴포넌트: `vi.mock`으로 쿼리 mock → 정상/빈 상태/에러 throw 3종
- 팩토리 함수 패턴 (`createReport()`, `createThesis()`)
