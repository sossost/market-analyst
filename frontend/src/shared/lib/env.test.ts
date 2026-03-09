import { getSupabaseConfig } from './env'

describe('getSupabaseConfig', () => {
  it('returns url and anonKey from environment variables', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key')

    const config = getSupabaseConfig()

    expect(config.url).toBe('https://test.supabase.co')
    expect(config.anonKey).toBe('test-anon-key')

    vi.unstubAllEnvs()
  })

  it('throws when NEXT_PUBLIC_SUPABASE_URL is missing', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key')

    expect(() => getSupabaseConfig()).toThrow(
      'Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL',
    )

    vi.unstubAllEnvs()
  })

  it('throws when NEXT_PUBLIC_SUPABASE_ANON_KEY is missing', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')

    expect(() => getSupabaseConfig()).toThrow(
      'Missing required environment variable: NEXT_PUBLIC_SUPABASE_ANON_KEY',
    )

    vi.unstubAllEnvs()
  })

  it('throws when environment variable is undefined', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', undefined as unknown as string)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key')

    expect(() => getSupabaseConfig()).toThrow(
      'Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL',
    )

    vi.unstubAllEnvs()
  })
})
