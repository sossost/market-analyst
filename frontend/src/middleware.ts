import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

import { getSupabaseConfig } from '@/shared/lib/env'

const EXACT_PUBLIC_PATHS = new Set(['/login'])
const PREFIX_PUBLIC_PATHS = ['/auth/callback']

function isPublicPath(pathname: string): boolean {
  return (
    EXACT_PUBLIC_PATHS.has(pathname) ||
    PREFIX_PUBLIC_PATHS.some((path) => pathname.startsWith(path))
  )
}

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })
  const { url, anonKey } = getSupabaseConfig()

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        )
        supabaseResponse = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        )
      },
    },
  })

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // 로그인 상태 + /login 접근 → 홈으로 리다이렉트 (이중 로그인 방지)
  if (user != null && pathname === '/login') {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/'
    redirectUrl.search = ''
    return NextResponse.redirect(redirectUrl)
  }

  // 비로그인 + 보호 경로 접근 → /login?redirectTo={현재경로} 리다이렉트
  if (user == null && !isPublicPath(pathname)) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/login'
    redirectUrl.searchParams.set('redirectTo', pathname)
    return NextResponse.redirect(redirectUrl)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
