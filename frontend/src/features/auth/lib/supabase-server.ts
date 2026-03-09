import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

import { getSupabaseConfig } from '@/shared/lib/env'

export async function createClient() {
  const cookieStore = await cookies()
  const { url, anonKey } = getSupabaseConfig()

  return createServerClient(url, anonKey, {
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
  })
}
