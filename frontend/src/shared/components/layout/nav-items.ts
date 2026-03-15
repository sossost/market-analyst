import { FileText, Home, MessageSquare, Search, type LucideIcon } from 'lucide-react'

export interface NavItem {
  href: string
  label: string
  icon: LucideIcon
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/', label: '홈', icon: Home },
  { href: '/reports', label: '리포트', icon: FileText },
  { href: '/debates', label: '토론', icon: MessageSquare },
  { href: '/stocks', label: '종목 검색', icon: Search },
]
