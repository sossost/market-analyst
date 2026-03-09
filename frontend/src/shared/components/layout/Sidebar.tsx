'use client'

import { FileText, Home, MessageSquare } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { cn } from '@/shared/lib/utils'

const NAV_ITEMS = [
  { href: '/', label: '홈', icon: Home },
  { href: '/reports', label: '리포트', icon: FileText },
  { href: '/debates', label: '토론', icon: MessageSquare },
] as const

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="bg-background hidden h-screen w-60 shrink-0 border-r md:block">
      <div className="p-4">
        <h2 className="text-lg font-bold">Market Analyst</h2>
      </div>
      <nav className="flex flex-col gap-1 px-2">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const isActive =
            href === '/' ? pathname === '/' : pathname.startsWith(href)

          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
