# Supabase Auth — Magic Link 인증

**Issue:** #119
**Parent:** #117 리포트/토론 아카이빙 대시보드
**Created:** 2026-03-09

---

## 선행 맥락

- PR #123 (이슈 #118)으로 프론트엔드 초기 세팅 완료. `main` 브랜치 대기 중.
- `frontend/src/features/auth/lib/supabase-browser.ts` — 브라우저 클라이언트 구현 완료
- `frontend/src/features/auth/lib/supabase-server.ts` — 서버 클라이언트 구현 완료
- `frontend/src/middleware.ts` — 세션 갱신만 처리하는 stub 존재. 인증 리다이렉트 미구현.
- `frontend/src/app/(auth)/login/page.tsx` — placeholder 로그인 페이지 존재 (폼 없음)
- `frontend/src/features/auth/types.ts` — `AuthUser { id, email }` 타입 정의 완료
- `(auth)` 라우트 그룹과 `(main)` 라우트 그룹이 이미 분리되어 있어 레이아웃 분기가 된 상태
- 기존 결정: Magic Link 방식 채택 (02-decisions.md §5). 이 기획서는 그 결정을 구체화한다.

## 골 정렬

**SUPPORT** — 직접 알파 창출 기능은 아니나, 대시보드 접근 보호를 통해 분석 자산을 보호하는 필수 인프라. F8 (아카이빙 대시보드)의 블로커 이슈이며, F8 없이는 리포트/토론 데이터를 웹에서 활용할 수 없다. 우선순위: P1 (high).

## 문제

`/reports`, `/debates` 등 보호 페이지에 인증 없이 접근 가능한 상태다. PR #123의 미들웨어는 세션 갱신만 하고 리다이렉트는 하지 않는다. 또한 로그인 페이지에 실제 폼이 없다. Magic Link 발송 → 콜백 처리 → 세션 확립의 전체 플로우가 미구현이다.

## Before → After

**Before:**
- 모든 페이지가 비로그인 상태로 접근 가능
- `/login` 페이지에 placeholder 텍스트만 있음
- 미들웨어가 세션 갱신만 처리

**After:**
- 비로그인 사용자가 보호 페이지 접근 시 `/login`으로 리다이렉트
- 로그인 페이지에서 이메일 입력 → Magic Link 발송 → 수신 후 클릭 → 자동 로그인
- 미등록 이메일로 요청 시 "접근 권한이 없습니다" 표시
- 로그인 후 세션 유지 (Supabase refresh token 자동 갱신)
- 로그아웃 버튼으로 세션 종료

## 변경 사항

### 1. 이메일 허용 목록 (Allowlist) 구현
**결정: Supabase 대시보드 초대 방식 채택 (환경변수 allowlist 방식 대신)**

이유: 2-5명 소규모 사용자. 코드 변경 없이 대시보드에서 초대/제거 가능. Supabase Auth 기본 기능 활용.

구체적으로:
- Supabase 프로젝트 → Authentication → Users에서 사용자를 수동 초대
- 초대받지 않은 이메일로 Magic Link 요청 시 → Supabase가 메일을 보내지 않거나, 보내더라도 콜백에서 사용자 조회 실패
- 클라이언트 측에서 `getUser()` 후 null이면 "접근 권한이 없습니다" 처리

**대안 검토 (기각):**
- 환경변수 `ALLOWED_EMAILS` allowlist: 코드 레벨 검증. 이메일 추가 시 재배포 필요. 소규모 운영에 오버엔지니어링.
- RLS 정책 기반 차단: DB 레벨 접근 제어. Auth 단계와 중복. 과잉.

### 2. 미들웨어 인증 리다이렉트
파일: `frontend/src/middleware.ts`

현재 stub에서 다음 로직을 추가한다:
- `supabase.auth.getUser()` 호출로 세션 검증
- 비로그인 + 보호 경로 접근 → `/login?redirectTo={현재경로}` 리다이렉트
- 로그인 상태 + `/login` 접근 → `/` 리다이렉트 (이중 로그인 방지)
- 공개 경로: `/login`, `/auth/callback`

### 3. LoginForm 컴포넌트
파일: `frontend/src/features/auth/components/LoginForm.tsx`

- `"use client"` 컴포넌트
- 이메일 input + 제출 버튼
- 제출 시 `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo } })` 호출
- 성공: "이메일을 확인해주세요" 확인 화면으로 전환 (동일 페이지, 상태 변경)
- 실패: 에러 메시지 인라인 표시
- `emailRedirectTo`: `{origin}/auth/callback`

### 4. `/login` 페이지 완성
파일: `frontend/src/app/(auth)/login/page.tsx`

현재 placeholder를 실제 `LoginForm`으로 교체.
`redirectTo` searchParam을 읽어 `LoginForm`에 전달 (콜백 후 원래 페이지로 복귀).

### 5. Auth 콜백 라우트
파일: `frontend/src/app/auth/callback/route.ts` (Route Handler)

Magic Link 클릭 후 Supabase가 이 URL로 리다이렉트한다.
- URL의 `code` 파라미터로 `exchangeCodeForSession()` 호출
- 성공: `redirectTo` 파라미터 또는 `/`로 리다이렉트
- 실패: `/login?error=auth_failed`로 리다이렉트

**결정: `/auth/callback`을 Route Handler로 구현 (Server Action 대신)**

이유: Magic Link 콜백은 Supabase가 GET 요청으로 호출한다. Route Handler가 자연스럽다.

### 6. 로그아웃 기능
파일: `frontend/src/features/auth/components/LogoutButton.tsx`

- `"use client"` 컴포넌트
- 클릭 시 `supabase.auth.signOut()` + `router.push('/login')`
- Sidebar에 배치

### 7. useUser 훅
파일: `frontend/src/features/auth/hooks/useUser.ts`

- `"use client"` 훅
- `supabase.auth.getUser()` 래핑
- Sidebar의 로그아웃 버튼, 현재 사용자 표시에 사용

## 작업 계획

### Step 1: 미들웨어 완성 (독립)
**담당:** 실행팀
**완료 기준:**
- 비로그인 상태에서 `/reports` 접근 시 `/login?redirectTo=/reports` 리다이렉트
- 로그인 상태에서 `/login` 접근 시 `/` 리다이렉트
- `tsc --noEmit` 에러 없음

### Step 2: Auth 콜백 Route Handler (독립)
**담당:** 실행팀
**완료 기준:**
- `GET /auth/callback?code=xxx` 요청 시 `exchangeCodeForSession()` 정상 호출
- 성공 시 `/` 또는 `redirectTo` 경로로 리다이렉트
- 실패 시 `/login?error=auth_failed`로 리다이렉트
- 단위 테스트 (mock Supabase): 성공/실패 케이스 각 1개

### Step 3: LoginForm + 로그인 페이지 (Step 2 완료 후)
**담당:** 실행팀
**완료 기준:**
- 이메일 입력 → 제출 → "이메일을 확인해주세요" 화면 전환
- 빈 이메일 제출 시 인라인 에러 표시
- 잘못된 형식 이메일 시 인라인 에러 표시
- "접근 권한이 없습니다" 에러 케이스 처리 (Supabase 에러 코드 파싱)
- 단위 테스트: 폼 제출, 에러 상태, 성공 상태

### Step 4: LogoutButton + useUser 훅 (Step 1 완료 후)
**담당:** 실행팀
**완료 기준:**
- Sidebar에 로그아웃 버튼 표시
- 클릭 시 세션 종료 + `/login` 리다이렉트
- useUser 훅이 현재 사용자 정보 반환
- 단위 테스트: signOut 호출 검증

### Step 5: E2E 테스트 (Step 1~4 완료 후)
**담당:** 실행팀
**완료 기준:**
- 비로그인 → `/reports` 접근 → `/login` 리다이렉트 확인
- (로컬에서 Magic Link 실제 발송은 테스트하지 않음 — Supabase 외부 서비스)
- 로그인 후 보호 페이지 접근 가능 (세션 mock 또는 실제 테스트 계정)

## 리스크

| 리스크 | 대응 |
|--------|------|
| Magic Link 이메일이 스팸함으로 분류 | Supabase 커스텀 SMTP 설정 (SendGrid 등). v1은 기본 SMTP 허용 후 문제 시 전환. |
| Supabase `signInWithOtp`가 미등록 이메일에도 성공 응답 반환 (보안 설계상) | UI에서 "이메일을 확인해주세요"만 표시. 미등록자는 링크 클릭해도 콜백에서 세션 미생성 → `/login?error=auth_failed` 처리. "접근 권한 없음" 메시지는 콜백 실패 시 표시. |
| 세션 만료 후 API 호출 실패 | 미들웨어의 `setAll`이 refresh token을 쿠키에 갱신. Supabase SSR 표준 패턴으로 처리됨. |
| PR #123 아직 미머지 상태 | 이 브랜치는 #123 PR 머지 후 `main`에서 분기해야 함. #123 머지 전까지 대기. |

## 의사결정 필요

없음 — 바로 구현 가능

모든 결정 사항 (Magic Link 방식, Supabase 초대 기반 allowlist, Route Handler 콜백)은 위 "변경 사항" 섹션에 근거와 함께 기록되었다.
