'use client'

import { LogOut } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { createClient } from '@/features/auth/lib/supabase-browser'
import { Button } from '@/shared/components/ui/button'

export function LogoutButton() {
  const router = useRouter()
  const [isSigningOut, setIsSigningOut] = useState(false)

  async function handleSignOut() {
    setIsSigningOut(true)

    const supabase = createClient()
    const { error } = await supabase.auth.signOut()

    if (error != null) {
      setIsSigningOut(false)
      return
    }

    router.push('/login')
    router.refresh()
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={isSigningOut}
      onClick={() => void handleSignOut()}
      className="text-muted-foreground hover:text-foreground w-full justify-start gap-2"
    >
      <LogOut className="h-4 w-4" />
      {isSigningOut ? '로그아웃 중...' : '로그아웃'}
    </Button>
  )
}
