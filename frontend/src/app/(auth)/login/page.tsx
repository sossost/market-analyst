import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'

import { LoginForm } from '@/features/auth/components/LoginForm'

interface LoginPageProps {
  searchParams: Promise<{
    redirectTo?: string
    error?: string
  }>
}

const ERROR_MESSAGES: Record<string, string> = {
  auth_failed: '인증에 실패했습니다. 다시 시도해주세요.',
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { redirectTo, error } = await searchParams

  const errorMessage =
    error != null ? (ERROR_MESSAGES[error] ?? '알 수 없는 오류가 발생했습니다.') : null

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Market Analyst</CardTitle>
          <CardDescription>
            이메일로 로그인 링크를 받아보세요
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {errorMessage != null && (
            <div
              className="bg-destructive/10 text-destructive rounded-lg p-3 text-center text-sm"
              role="alert"
            >
              {errorMessage}
            </div>
          )}
          <LoginForm redirectTo={redirectTo} />
        </CardContent>
      </Card>
    </main>
  )
}
