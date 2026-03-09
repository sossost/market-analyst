'use client'

import { Mail } from 'lucide-react'
import { type FormEvent, useState } from 'react'

import { Button } from '@/shared/components/ui/button'

import { createClient } from '../lib/supabase-browser'

const SAFE_REDIRECT_PATTERN = /^\/[^/]/

type FormState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'success'; email: string }
  | { status: 'error'; message: string }

interface LoginFormProps {
  redirectTo?: string
}

export function LoginForm({ redirectTo }: LoginFormProps) {
  const [formState, setFormState] = useState<FormState>({ status: 'idle' })
  const [email, setEmail] = useState('')

  if (formState.status === 'success') {
    return (
      <div className="space-y-3 text-center">
        <div className="bg-primary/10 text-primary mx-auto flex size-12 items-center justify-center rounded-full">
          <Mail className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-semibold">이메일을 확인해주세요</h2>
        <p className="text-muted-foreground text-sm">
          <span className="text-foreground font-medium">{formState.email}</span>
          로 로그인 링크를 보냈습니다.
        </p>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-4 transition-colors"
          onClick={() => {
            setFormState({ status: 'idle' })
            setEmail('')
          }}
        >
          다른 이메일로 시도
        </button>
      </div>
    )
  }

  const isSubmitting = formState.status === 'submitting'
  const errorMessage =
    formState.status === 'error' ? formState.message : null

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmedEmail = email.trim()
    if (trimmedEmail === '') {
      setFormState({ status: 'error', message: '이메일을 입력해주세요.' })
      return
    }

    setFormState({ status: 'submitting' })

    try {
      const supabase = createClient()
      // 전제: Supabase 대시보드 > Authentication > URL Configuration > Redirect URLs에
      // 이 origin이 허용 목록으로 등록되어 있어야 함. 누락 시 Magic Link 클릭 후 에러 발생.
      const safePath = (redirectTo != null && SAFE_REDIRECT_PATTERN.test(redirectTo))
        ? redirectTo
        : '/'
      const callbackPath = safePath !== '/'
        ? `/auth/callback?redirectTo=${encodeURIComponent(safePath)}`
        : '/auth/callback'
      const emailRedirectTo = `${window.location.origin}${callbackPath}`

      const { error } = await supabase.auth.signInWithOtp({
        email: trimmedEmail,
        options: { emailRedirectTo },
      })

      if (error != null) {
        setFormState({ status: 'error', message: error.message })
        return
      }

      setFormState({ status: 'success', email: trimmedEmail })
    } catch {
      setFormState({
        status: 'error',
        message: '알 수 없는 오류가 발생했습니다. 다시 시도해주세요.',
      })
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <label
          htmlFor="login-email"
          className="text-sm font-medium leading-none"
        >
          이메일
        </label>
        <input
          id="login-email"
          type="email"
          autoComplete="email"
          placeholder="name@example.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            if (formState.status === 'error') {
              setFormState({ status: 'idle' })
            }
          }}
          disabled={isSubmitting}
          aria-invalid={errorMessage != null}
          aria-describedby={errorMessage != null ? 'login-error' : undefined}
          className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring/50 focus-visible:border-ring flex h-9 w-full rounded-lg border px-3 py-1 text-sm shadow-xs transition-colors focus-visible:ring-3 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive"
        />
      </div>

      {errorMessage != null && (
        <p id="login-error" className="text-destructive text-sm" role="alert">
          {errorMessage}
        </p>
      )}

      <Button
        type="submit"
        disabled={isSubmitting}
        className="w-full"
        size="lg"
      >
        {isSubmitting ? '전송 중...' : 'Magic Link로 로그인'}
      </Button>
    </form>
  )
}

