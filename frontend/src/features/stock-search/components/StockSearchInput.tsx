'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import { cn } from '@/shared/lib/utils'

import type { StockSearchResult } from '../types'

const DEBOUNCE_MS = 300
const MIN_QUERY_LENGTH = 1
const KEYBOARD_NONE = -1

interface SearchState {
  query: string
  results: StockSearchResult[]
  isOpen: boolean
  activeIndex: number
  isLoading: boolean
}

const INITIAL_STATE: SearchState = {
  query: '',
  results: [],
  isOpen: false,
  activeIndex: KEYBOARD_NONE,
  isLoading: false,
}

async function fetchSearchResults(query: string): Promise<StockSearchResult[]> {
  const res = await fetch(`/api/stocks/search?q=${encodeURIComponent(query)}`)
  if (!res.ok) {
    throw new Error('검색 요청 실패')
  }
  const json = await res.json() as { results: StockSearchResult[] }
  return json.results
}

interface StockSearchInputProps {
  placeholder?: string
  className?: string
}

export function StockSearchInput({
  placeholder = 'Ticker 또는 종목명 검색 (예: AAPL)',
  className,
}: StockSearchInputProps) {
  const router = useRouter()
  const [state, setState] = useState<SearchState>(INITIAL_STATE)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const navigate = useCallback(
    (symbol: string) => {
      setState(INITIAL_STATE)
      router.push(`/stocks/${symbol}`)
    },
    [router],
  )

  const handleQueryChange = useCallback((query: string) => {
    setState((prev) => ({ ...prev, query, activeIndex: KEYBOARD_NONE }))

    if (debounceRef.current != null) {
      clearTimeout(debounceRef.current)
    }

    if (query.length < MIN_QUERY_LENGTH) {
      setState((prev) => ({ ...prev, results: [], isOpen: false, isLoading: false }))
      return
    }

    setState((prev) => ({ ...prev, isLoading: true }))

    debounceRef.current = setTimeout(async () => {
      try {
        const results = await fetchSearchResults(query)
        setState((prev) => ({
          ...prev,
          results,
          isOpen: results.length > 0,
          isLoading: false,
        }))
      } catch {
        setState((prev) => ({ ...prev, results: [], isOpen: false, isLoading: false }))
      }
    }, DEBOUNCE_MS)
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!state.isOpen) {
        return
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setState((prev) => ({
          ...prev,
          activeIndex: Math.min(prev.activeIndex + 1, prev.results.length - 1),
        }))
        return
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setState((prev) => ({
          ...prev,
          activeIndex: Math.max(prev.activeIndex - 1, KEYBOARD_NONE),
        }))
        return
      }

      if (e.key === 'Enter') {
        e.preventDefault()
        const selectedResult = state.results[state.activeIndex]
        if (state.activeIndex >= 0 && selectedResult != null) {
          navigate(selectedResult.symbol)
        } else if (state.query.trim() !== '') {
          navigate(state.query.trim().toUpperCase())
        }
        return
      }

      if (e.key === 'Escape') {
        setState((prev) => ({ ...prev, isOpen: false, activeIndex: KEYBOARD_NONE }))
      }
    },
    [state.isOpen, state.activeIndex, state.results, state.query, navigate],
  )

  // 외부 클릭 시 닫기
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current != null &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setState((prev) => ({ ...prev, isOpen: false, activeIndex: KEYBOARD_NONE }))
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current != null) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [])

  return (
    <div ref={containerRef} className={cn('relative w-full max-w-lg', className)}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={state.query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (state.results.length > 0) {
              setState((prev) => ({ ...prev, isOpen: true }))
            }
          }}
          placeholder={placeholder}
          className="w-full rounded-md border bg-background px-4 py-2.5 text-sm shadow-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
          aria-label="종목 검색"
          aria-autocomplete="list"
          aria-expanded={state.isOpen}
          aria-controls="stock-search-listbox"
          role="combobox"
          autoComplete="off"
        />
        {state.isLoading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-foreground" />
          </div>
        )}
      </div>

      {state.isOpen && state.results.length > 0 && (
        <ul
          id="stock-search-listbox"
          role="listbox"
          className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md"
        >
          {state.results.map((result, idx) => {
            const isActive = idx === state.activeIndex

            return (
              <li
                key={result.symbol}
                role="option"
                aria-selected={isActive}
                onMouseDown={(e) => {
                  e.preventDefault()
                  navigate(result.symbol)
                }}
                onMouseEnter={() =>
                  setState((prev) => ({ ...prev, activeIndex: idx }))
                }
                className={`flex cursor-pointer items-center justify-between px-4 py-2.5 text-sm transition-colors ${
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-accent hover:text-accent-foreground'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono font-semibold">{result.symbol}</span>
                  <span className="text-muted-foreground">{result.companyName}</span>
                </div>
                {result.sector != null && (
                  <span className="text-xs text-muted-foreground">{result.sector}</span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
