import { NextRequest, NextResponse } from 'next/server'

import { createClient } from '@/features/auth/lib/supabase-server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl

  const code = searchParams.get('code')
  if (code == null) {
    return NextResponse.redirect(new URL('/login?error=auth_failed', origin))
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error != null) {
    return NextResponse.redirect(new URL('/login?error=auth_failed', origin))
  }

  const raw = searchParams.get('next') ?? searchParams.get('redirectTo') ?? '/'
  const redirectTo = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/'
  return NextResponse.redirect(new URL(redirectTo, origin))
}
