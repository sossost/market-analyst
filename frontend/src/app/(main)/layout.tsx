import { AppLayout } from '@/shared/components/layout/AppLayout'

export default function MainLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <AppLayout>{children}</AppLayout>
}
