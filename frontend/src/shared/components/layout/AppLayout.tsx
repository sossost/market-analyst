import { MobileNav } from './MobileNav'
import { Sidebar } from './Sidebar'

interface Props {
  children: React.ReactNode
}

export function AppLayout({ children }: Props) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 pb-16 md:pb-0">{children}</div>
      <MobileNav />
    </div>
  )
}
