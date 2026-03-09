'use client'

import { useEffect, useState } from 'react'

import { createClient } from '@/features/auth/lib/supabase-browser'
import type { AuthUser } from '@/features/auth/types'

interface UseUserReturn {
  user: AuthUser | null
  isLoading: boolean
}

export function useUser(): UseUserReturn {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user != null) {
        setUser({
          id: session.user.id,
          email: session.user.email ?? '',
        })
      } else {
        setUser(null)
      }
      setIsLoading(false)
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  return { user, isLoading }
}
