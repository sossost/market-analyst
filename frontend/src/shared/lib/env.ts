function requireEnv(key: string): string {
  const value = process.env[key]
  if (value == null || value === '') {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value
}

export function getSupabaseConfig() {
  return {
    url: requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    anonKey: requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  } as const
}
