import { createBrowserClient } from '@supabase/ssr'

import { getSupabaseConfig } from '@/shared/lib/env'

export function createClient() {
  const { url, anonKey } = getSupabaseConfig()
  return createBrowserClient(url, anonKey)
}
