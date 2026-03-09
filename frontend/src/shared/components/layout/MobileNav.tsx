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

export function MobileNav() {
  const pathname = usePathname()

  return (
    <nav className="bg-background fixed right-0 bottom-0 left-0 z-50 border-t md:hidden">
      <div className="flex items-center justify-around py-2">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const isActive =
            href === '/' ? pathname === '/' : pathname.startsWith(href)

          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex flex-col items-center gap-1 px-3 py-1 text-xs transition-colors',
                isActive
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-5 w-5" />
              {label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
