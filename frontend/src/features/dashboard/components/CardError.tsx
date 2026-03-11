import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'

interface CardErrorProps {
  title: string
}

export function CardError({ title }: CardErrorProps) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex-1">
        <p className="py-4 text-center text-sm text-destructive">
          데이터를 불러올 수 없습니다
        </p>
      </CardContent>
    </Card>
  )
}
