import { useCallback, useEffect, useRef, useState } from 'react'

import { ApiError } from '#/lib/api.ts'

export interface AsyncState<T> {
  data: T | null
  error: string | null
  loading: boolean
  /** True when the loader needs an admin session that isn't present. */
  unauthorized: boolean
  refetch: () => void
}

/**
 * Runs an async loader on mount (and whenever `deps` change), tracking
 * loading/error state and exposing a manual `refetch`. 401s are surfaced as
 * `unauthorized` so pages can prompt for sign-in.
 */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [unauthorized, setUnauthorized] = useState(false)
  const [tick, setTick] = useState(0)
  const loaderRef = useRef(loader)
  loaderRef.current = loader

  const refetch = useCallback(() => setTick((value) => value + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setUnauthorized(false)
    loaderRef
      .current()
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 401) setUnauthorized(true)
        setError(err instanceof Error ? err.message : 'Something went wrong.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps])

  return { data, error, loading, unauthorized, refetch }
}
