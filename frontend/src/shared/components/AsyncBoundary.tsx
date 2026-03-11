'use client'

import { Suspense, type ReactNode } from 'react'

import { ErrorBoundary } from './ErrorBoundary'

interface AsyncBoundaryProps {
  children: ReactNode
  pendingFallback: ReactNode
  errorFallback: ReactNode
}

export function AsyncBoundary({
  children,
  pendingFallback,
  errorFallback,
}: AsyncBoundaryProps) {
  return (
    <ErrorBoundary fallback={errorFallback}>
      <Suspense fallback={pendingFallback}>{children}</Suspense>
    </ErrorBoundary>
  )
}
