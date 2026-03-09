'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { LogoutButton } from '@/features/auth/components/LogoutButton'
import { useUser } from '@/features/auth/hooks/useUser'
import { Separator } from '@/shared/components/ui/separator'
import { cn } from '@/shared/lib/utils'

import { NAV_ITEMS } from './nav-items'

export function Sidebar() {
  const pathname = usePathname()
  const { user, isLoading } = useUser()

  return (
    <aside className="bg-background hidden h-screen w-60 shrink-0 border-r md:flex md:flex-col">
      <div className="p-4">
        <h2 className="text-lg font-bold">Market Analyst</h2>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-2">
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
      {!isLoading && user != null && (
        <div className="px-2 pb-4">
          <Separator className="mb-3" />
          <p className="text-muted-foreground truncate px-3 pb-1 text-xs">
            {user.email}
          </p>
          <LogoutButton />
        </div>
      )}
    </aside>
  )
}
